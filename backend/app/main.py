from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

import asyncio
import datetime
import json
import os
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from .sop import router as sop_router, execution_router, DEVICE_IDS
from .reports import router as reports_router
from .errors import router as errors_router
from .ai import router as ai_router
from .rag import warmup_rag
from .line import router as line_router, push_message, push_to_user, push_sop_notification
from .auth import router as auth_router
from .fixtures import router as fixtures_router
from .fixture_notifications import scan_overdue_loans, notify_monthly_inventory, scan_replacement_reminders
from .purchase_orders import router as purchase_orders_router
from .schedules import router as schedules_router, blocked_router as device_blocked_router, auto_advance_schedules
from .notification_failures import router as notif_failures_router
from .models import SessionLocal, DeviceData, ErrorLog, DeviceState, SopExecution
from .standards import get_ramp_rate, get_standard
from .utils import _now_utc, _save_device_state
import httpx as _httpx
import logging

logger = logging.getLogger("app")
background_tasks = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .models import init_db

    init_db()

    with SessionLocal() as db:
        saved_states = {s.device_id: s for s in db.query(DeviceState).all()}

    cache = {}
    for device_id in DEVICE_IDS:
        s = saved_states.get(device_id)
        if s:
            started_at = s.started_at
            if started_at is not None and started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=datetime.timezone.utc)
            cache[device_id] = {
                "temperature": s.temperature,
                "humidity": s.humidity,
                "status": s.status,
                "running_sop_name": s.running_sop_name or "STANDBY",
                "running_sop_id": s.running_sop_id,
                "standard_id": s.standard_id,
                "active_sop_json": s.active_sop_json,
                "completed_steps": s.completed_steps or 0,
                "started_at": started_at,
                "operator": "",
                "operator_user_id": None,
                "sim_phase": s.sim_phase or "idle",
                "sim_cycle": s.sim_cycle or 0,
            }
            logger.info(f"[{device_id}] 恢復狀態：{s.status}，溫度：{s.temperature}°C")
        else:
            cache[device_id] = {
                "temperature": round(25.0 + random.uniform(-1.0, 1.0), 2),
                "humidity": round(55.0 + random.uniform(-2.0, 2.0), 1),
                "status": "IDLE",
                "running_sop_name": "STANDBY",
                "running_sop_id": None,
                "standard_id": None,
                "active_sop_json": None,
                "completed_steps": 0,
                "started_at": None,
                "operator": "",
                "operator_user_id": None,
                "sim_phase": "idle",
                "sim_cycle": 0,
            }

    app.state.AICM_CACHE = cache
    app.state.DEVICE_LOCKS = {device_id: asyncio.Lock() for device_id in DEVICE_IDS}

    sim_task = asyncio.create_task(data_simulator())
    background_tasks.add(sim_task)
    sim_task.add_done_callback(background_tasks.discard)
    logger.info(f"System initialized with {len(DEVICE_IDS)} devices: {DEVICE_IDS}")

    task = asyncio.create_task(warmup_rag())
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
    app.state.http_client = _httpx.AsyncClient(timeout=10.0)

    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    scheduler = AsyncIOScheduler(timezone="Asia/Taipei")
    scheduler.add_job(scan_overdue_loans, "cron", hour=8, minute=0)
    scheduler.add_job(notify_monthly_inventory, "cron", day=1, hour=8, minute=0)
    scheduler.add_job(scan_replacement_reminders, "cron", day_of_week="mon", hour=8, minute=0)
    scheduler.add_job(auto_advance_schedules, "interval", minutes=5)
    scheduler.start()
    logger.info("APScheduler 已啟動（每日 08:00 掃描逾期治具，每月 1 日月盤點提醒，每週一 08:00 汰換提醒，每 5 分鐘推進排程狀態）")

    yield
    scheduler.shutdown()
    await app.state.http_client.aclose()


app = FastAPI(title="DQA Lab Digital Twin", lifespan=lifespan)

app.include_router(sop_router, prefix="/api/sop", tags=["sop"])
app.include_router(execution_router)
app.include_router(reports_router)
app.include_router(errors_router)
app.include_router(ai_router)
app.include_router(line_router)
app.include_router(auth_router)
app.include_router(fixtures_router)
app.include_router(purchase_orders_router)
app.include_router(schedules_router)
app.include_router(device_blocked_router)
app.include_router(notif_failures_router)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .auth import auth_middleware
from starlette.middleware.base import BaseHTTPMiddleware

app.add_middleware(BaseHTTPMiddleware, dispatch=auth_middleware)


@app.get("/health")
async def health():
    return {"status": "ok"}


def _get_device(device_id: str) -> dict:
    device = app.state.AICM_CACHE.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"設備 {device_id} 不存在")
    return device


def _make_description(status: str, sop_name: str) -> str:
    return {
        "RUNNING": f"正在執行：{sop_name}。溫度按標準速率變化。",
        "PAUSED": f"已暫停：{sop_name}。點擊暫停切換可繼續。",
        "EMERGENCY": "⚠️ 緊急停止已觸發，請確認設備安全後按正常停止。",
        "FINISHING": "測試已結束，正在自動降溫到 25°C，請稍候...",
        "IDLE": "系統待機中，請選擇 SOP 後點擊啟動。",
    }.get(status, "等待連線...")


def _calc_estimated_end_at(item: dict) -> Optional[str]:
    status = item.get("status")
    if status not in ("RUNNING", "PAUSED"):
        return None

    started_at = item.get("started_at")
    active_sop_json = item.get("active_sop_json")
    if not started_at or not active_sop_json:
        return None

    try:
        sop = json.loads(active_sop_json)
    except Exception as e:
        logger.warning(f"[_calc_estimated_end_at] active_sop_json 解析失敗：{e}")
        return None

    ramp_rate = sop.get("ramp_rate") or 1.0
    dwell_hours = sop.get("dwell_time_hours") or 0.0
    dwell_min = dwell_hours * 60.0
    cycles = sop.get("cycles") or 1
    high_temp = sop.get("high_temperature") or sop.get("target_temperature") or 25.0
    low_temp = sop.get("low_temperature")
    ambient = 25.0

    if low_temp is not None and low_temp < ambient and abs(high_temp - low_temp) <= 0.1:
        # 單溫冷測（high_temp == low_temp，如 Test Ab/Ad）：只有一段 dwell
        ramp_ambient_to_low = abs(ambient - low_temp) / ramp_rate
        total_min = ramp_ambient_to_low + dwell_min + ramp_ambient_to_low
    elif low_temp is not None and low_temp < ambient:
        ramp_ambient_to_low = abs(ambient - low_temp) / ramp_rate
        ramp_low_to_high = abs(high_temp - low_temp) / ramp_rate
        one_cycle_min = ramp_low_to_high + dwell_min + ramp_low_to_high + dwell_min
        total_min = ramp_ambient_to_low + one_cycle_min * cycles + ramp_ambient_to_low
    elif low_temp is not None:
        ramp_up = abs(high_temp - ambient) / ramp_rate
        ramp_hl = abs(high_temp - low_temp) / ramp_rate
        ramp_down = abs(low_temp - ambient) / ramp_rate
        full_cycle = dwell_min * 2 + ramp_hl * 2
        last_cycle = dwell_min * 2 + ramp_hl
        total_min = ramp_up + full_cycle * (cycles - 1) + last_cycle + ramp_down
    else:
        ramp_up = abs(high_temp - ambient) / ramp_rate
        total_min = ramp_up + dwell_min + ramp_up

    total_seconds = total_min * 60.0

    if isinstance(started_at, str):
        started_dt = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    else:
        started_dt = started_at
    if started_dt.tzinfo is None:
        started_dt = started_dt.replace(tzinfo=datetime.timezone.utc)

    estimated_end = started_dt + datetime.timedelta(seconds=total_seconds)
    return estimated_end.isoformat()


@app.get("/api/devices")
async def get_all_devices():
    now = _now_utc().strftime("%H:%M:%S")
    return [
        {
            "device_id": device_id,
            "status": item.get("status", "OFFLINE"),
            "temperature": item.get("temperature", 0.0),
            "humidity": item.get("humidity", 0.0),
            "running_sop_name": item.get("running_sop_name", "STANDBY"),
            "description": _make_description(
                item.get("status", "OFFLINE"), item.get("running_sop_name", "")
            ),
            "timestamp": now,
            "active_sop_json": item.get("active_sop_json"),
            "completed_steps": item.get("completed_steps", 0),
            "total_steps": item.get("total_steps", 0),
            "started_at": item.get("started_at").isoformat()
            if item.get("started_at")
            else None,
            "estimated_end_at": _calc_estimated_end_at(item),
            "sim_cycle": item.get("sim_cycle", 0),
            "sim_phase": item.get("sim_phase", "idle"),
        }
        for device_id, item in app.state.AICM_CACHE.items()
    ]


@app.get("/api/devices/{device_id}/history")
async def get_device_history(device_id: str):
    device = app.state.AICM_CACHE.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"設備 {device_id} 不存在")

    started_at = device.get("started_at")
    if not started_at:
        return []

    if isinstance(started_at, str):
        started_dt = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    else:
        started_dt = started_at

    if started_dt.tzinfo is not None:
        started_dt = started_dt.replace(tzinfo=None)

    with SessionLocal() as db:
        rows = (
            db.query(DeviceData)
            .filter(
                DeviceData.device_id == device_id,
                DeviceData.timestamp >= started_dt,
            )
            .order_by(DeviceData.timestamp.asc())
            .all()
        )

    if not rows:
        return []

    buckets: dict = {}
    for row in rows:
        minute_key = row.timestamp.strftime("%Y-%m-%d %H:%M")
        if minute_key not in buckets:
            buckets[minute_key] = {"temps": [], "humis": []}
        if row.temperature is not None:
            buckets[minute_key]["temps"].append(row.temperature)
        if row.humidity is not None:
            buckets[minute_key]["humis"].append(row.humidity)

    result = []
    for minute_key, data in sorted(buckets.items()):
        avg_temp = (
            round(sum(data["temps"]) / len(data["temps"]), 2) if data["temps"] else None
        )
        avg_humi = (
            round(sum(data["humis"]) / len(data["humis"]), 2) if data["humis"] else None
        )
        result.append(
            {
                "time": minute_key[11:],
                "full_time": minute_key,
                "temperature": avg_temp,
                "humidity": avg_humi,
            }
        )

    return result


@app.get("/api/latest")
async def get_latest():
    cache = app.state.AICM_CACHE
    if not cache or "CH-01" not in cache:
        return {
            "status": "OFFLINE",
            "temperature": 0.0,
            "humidity": 0.0,
            "running_sop_name": "未連線",
            "description": "等待模擬器啟動...",
            "timestamp": _now_utc().strftime("%H:%M:%S"),
        }
    data = cache["CH-01"]
    status = data.get("status", "OFFLINE")
    return {
        "status": status,
        "temperature": data.get("temperature", 0.0),
        "humidity": data.get("humidity", 0.0),
        "running_sop_name": data.get("running_sop_name", "STANDBY"),
        "description": _make_description(status, data.get("running_sop_name", "")),
        "timestamp": _now_utc().strftime("%H:%M:%S"),
    }


@app.post("/api/stop/{device_id}/emergency")
async def emergency_stop(device_id: str, request: Request):
    device = _get_device(device_id)

    async with app.state.DEVICE_LOCKS[device_id]:
        if device.get("status") == "EMERGENCY":
            return {
                "status": "already_emergency",
                "message": f"{device_id} 已在緊急停止狀態",
            }

        operator = device.get("operator", "") or "未填寫"
        operator_user_id = device.get("operator_user_id")
        sop_name = device.get("running_sop_name", "") or "未知測試"

        with SessionLocal() as db:
            # 記錄緊急停止事件
            db.add(
                ErrorLog(
                    device_id=device_id,
                    error_type="EMERGENCY",
                    sop_id=device.get("running_sop_id"),
                    sop_name=device.get("running_sop_name"),
                    temperature=device.get("temperature"),
                    humidity=device.get("humidity"),
                    note=f"操作人員觸發緊急停止（{operator}）",
                    completed_steps=device.get("completed_steps", 0),
                    total_steps=device.get("total_steps", 0),
                    created_at=_now_utc(),
                )
            )

            # 更新對應的 SopExecution 記錄，設定 test_ended_at
            execution = db.query(SopExecution).filter(
                SopExecution.device_id == device_id,
                SopExecution.test_ended_at == None,
                SopExecution.test_started_at != None
            ).first()
            if execution:
                execution.test_ended_at = _now_utc()

            db.commit()

        device.update(
            {
                "status": "EMERGENCY",
                "running_sop_id": None,
                "running_sop_name": "🚨 緊急停止中 - 待確認安全",
                "active_sop_json": None,
                "completed_steps": 0,
                "started_at": None,
                "total_steps": 0,
                "operator": "",
                "operator_user_id": None,
                "sim_phase": "idle",
                "sim_cycle": 0,
            }
        )
        _save_device_state(device_id, device)

    logger.warning(f"[{device_id}] EMERGENCY STOP by {operator}")
    asyncio.create_task(
        push_sop_notification(
            operator_user_id,
            f"🚨 [{device_id}] 緊急停止已觸發\n"
            f"測試：{sop_name}\n"
            f"操作人員：{operator}\n"
            f"溫度：{device.get('temperature', 0.0):.1f}°C"
        )
    )
    return {"status": "success", "message": f"{device_id} 緊急停止已觸發"}


class ProgressPayload(BaseModel):
    completed: int = 0


class SetPhasePayload(BaseModel):
    phase: str


_VALID_PHASES = {
    "ramp_to_low", "ramp_to_high", "dwell_high",
    "ramp_to_low2", "dwell_low", "ramp_to_ambient",
}


@app.post("/api/devices/{device_id}/set-phase")
async def set_phase(device_id: str, payload: SetPhasePayload):
    """管理員手動跳相位（用於 demo / 手動接管）"""
    device = _get_device(device_id)
    if payload.phase not in _VALID_PHASES:
        raise HTTPException(status_code=400, detail=f"無效的 phase：{payload.phase}")
    async with app.state.DEVICE_LOCKS[device_id]:
        if device.get("status") not in ("RUNNING", "PAUSED"):
            raise HTTPException(status_code=400, detail="設備未在執行中")
        device["sim_phase"] = payload.phase
        _save_device_state(device_id, device)
    return {"status": "success", "sim_phase": payload.phase}


@app.post("/api/devices/{device_id}/progress")
async def update_progress(device_id: str, payload: ProgressPayload):
    device = _get_device(device_id)
    async with app.state.DEVICE_LOCKS[device_id]:
        device["completed_steps"] = payload.completed
        _save_device_state(device_id, device)
    return {"status": "success", "completed_steps": payload.completed}


@app.post("/api/stop/{device_id}/pause")
async def pause_test(device_id: str):
    device = _get_device(device_id)
    async with app.state.DEVICE_LOCKS[device_id]:
        if device["status"] not in ("RUNNING", "PAUSED"):
            raise HTTPException(status_code=400, detail=f"{device_id} 非執行中狀態，無法暫停／繼續")
        if device["status"] == "RUNNING":
            device["status"] = "PAUSED"
        else:
            device["status"] = "RUNNING"
        _save_device_state(device_id, device)
    return {"status": "success"}


@app.post("/api/stop/{device_id}/normal")
async def normal_stop(device_id: str):
    device = _get_device(device_id)
    async with app.state.DEVICE_LOCKS[device_id]:
        if device["status"] not in ("RUNNING", "PAUSED"):
            raise HTTPException(status_code=400, detail=f"{device_id} 非執行中狀態，無法停止")
        device.update(
            {
                "status": "FINISHING",
                "running_sop_name": "系統自動降溫收尾中...",
                "active_sop_json": None,
                "completed_steps": 0,
                "started_at": None,
                "standard_id": None,
                "operator": "",
                "sim_phase": "ramp_to_ambient",
                "sim_cycle": 0,
            }
        )
        _save_device_state(device_id, device)
    return {"status": "success"}




async def data_simulator():
    write_counters: dict = {}
    dwell_start_times: dict = {}
    sop_notif_sent: dict = {}  # {device_id: set[str]} 每次 SOP 啟動時重置

    while True:
        cache = app.state.AICM_CACHE
        now = _now_utc()

        for device_id, item in cache.items():
            status = item.get("status", "OFFLINE")

            # B8 fix: IDLE 設備跳過，不做無謂迭代
            if status == "IDLE":
                write_counters[device_id] = 0
                continue

            current_temp = item.get("temperature", 25.0)
            current_humi = item.get("humidity", 55.0)

            if device_id not in write_counters:
                write_counters[device_id] = 0

            if status == "RUNNING":
                standard_id = item.get("standard_id")
                standard = get_standard(standard_id) if standard_id else None
                max_ramp_rate = get_ramp_rate(standard_id) if standard_id else 1.0

                high_temp = 25.0
                low_temp = None
                dwell_seconds = 3600.0
                cycles = 1
                target_humi = None

                if standard:
                    high_temp = standard.get("high_temperature") or standard.get(
                        "target_temperature", 25.0
                    )
                    low_temp = standard.get("low_temperature")
                    dwell_seconds = (standard.get("dwell_time_hours") or 1.0) * 3600.0
                    cycles = standard.get("cycles") or 1
                    target_humi = standard.get("humidity_rh_percent")

                ambient = 25.0
                sim_phase = item.get("sim_phase", "")
                sim_cycle = item.get("sim_cycle", 0)
                sim_phase_before = sim_phase  # Phase 9-4：記錄轉換前 phase

                if not sim_phase or sim_phase == "idle":
                    if low_temp is not None and low_temp < ambient:
                        item["sim_phase"] = "ramp_to_low"
                    else:
                        item["sim_phase"] = "ramp_to_high"
                    item["sim_cycle"] = 0
                    sim_phase = item["sim_phase"]
                    dwell_start_times.pop(device_id, None)
                    sop_notif_sent[device_id] = set()  # 新測試開始，重置通知紀錄

                max_change = max_ramp_rate / 60.0

                def move_toward(current, target):
                    diff = target - current
                    if abs(diff) <= 0.1:
                        return target
                    change = min(abs(diff), max_change)
                    return current + (change if diff > 0 else -change)

                new_temp = current_temp

                if sim_phase == "ramp_to_low":
                    new_temp = move_toward(current_temp, low_temp)
                    if abs(new_temp - low_temp) <= 0.1:
                        new_temp = low_temp
                        if abs(high_temp - low_temp) <= 0.1:
                            # 單溫冷測（high_temp == low_temp）：直接進入 dwell，跳過 ramp_to_high
                            item["sim_phase"] = "dwell_high"
                            dwell_start_times[f"{device_id}_high"] = now
                        else:
                            item["sim_phase"] = "ramp_to_high"

                elif sim_phase == "ramp_to_high":
                    new_temp = move_toward(current_temp, high_temp)
                    if abs(new_temp - high_temp) <= 0.1:
                        new_temp = high_temp
                        item["sim_phase"] = "dwell_high"
                        dwell_start_times[f"{device_id}_high"] = now

                elif sim_phase == "dwell_high":
                    new_temp = high_temp
                    dwell_key = f"{device_id}_high"
                    dwell_start = dwell_start_times.get(dwell_key, now)
                    elapsed = (now - dwell_start).total_seconds()
                    if elapsed >= dwell_seconds:
                        dwell_start_times.pop(dwell_key, None)
                        if low_temp is not None and abs(high_temp - low_temp) > 0.1:
                            # 兩溫循環測試：需要再降溫到 low_temp 停留
                            item["sim_phase"] = "ramp_to_low2"
                        else:
                            # 單溫測試（含冷測）：直接回常溫
                            item["sim_phase"] = "ramp_to_ambient"

                elif sim_phase == "ramp_to_low2":
                    new_temp = move_toward(current_temp, low_temp)
                    if abs(new_temp - low_temp) <= 0.1:
                        new_temp = low_temp
                        item["sim_phase"] = "dwell_low"
                        dwell_start_times[f"{device_id}_low"] = now

                elif sim_phase == "dwell_low":
                    new_temp = low_temp
                    dwell_key = f"{device_id}_low"
                    dwell_start = dwell_start_times.get(dwell_key, now)
                    elapsed = (now - dwell_start).total_seconds()
                    if elapsed >= dwell_seconds:
                        dwell_start_times.pop(dwell_key, None)
                        item["sim_cycle"] = sim_cycle + 1
                        if item["sim_cycle"] < cycles:
                            item["sim_phase"] = "ramp_to_high"
                        else:
                            item["sim_phase"] = "ramp_to_ambient"

                elif sim_phase == "ramp_to_ambient":
                    new_temp = move_toward(current_temp, ambient)
                    if abs(new_temp - ambient) <= 0.1:
                        new_temp = ambient

                # Phase 9-4：偵測 sim_phase 轉換並推播通知
                sim_phase_after = item.get("sim_phase", "")
                if sim_phase_after != sim_phase_before:
                    notif_set = sop_notif_sent.setdefault(device_id, set())
                    op_user_id = item.get("operator_user_id")
                    sop_name_for_notif = item.get("running_sop_name", "測試")

                    if sim_phase_after == "dwell_high" and "dwell_high" not in notif_set:
                        notif_set.add("dwell_high")
                        notif_text = (
                            f"🌡️ [{device_id}] 已達目標溫度 {high_temp:.0f}°C\n"
                            f"測試：{sop_name_for_notif}\n"
                            f"進入恆溫停留，計時開始"
                        )
                        asyncio.create_task(push_sop_notification(op_user_id, notif_text))

                    elif sim_phase_after == "ramp_to_ambient" and "ramp_to_ambient" not in notif_set:
                        notif_set.add("ramp_to_ambient")
                        notif_text = (
                            f"✅ [{device_id}] 測試完成：{sop_name_for_notif}\n"
                            f"報告已自動存檔，回常溫中\n"
                            f"請補充結束照片 📷"
                        )
                        asyncio.create_task(push_sop_notification(op_user_id, notif_text))

                item["temperature"] = round(new_temp + random.uniform(-0.1, 0.1), 2)

                if target_humi is not None and new_temp >= 0:
                    humi_diff = target_humi - current_humi
                    humi_change = min(abs(humi_diff), 0.3)
                    tracked_humi = current_humi + (
                        humi_change if humi_diff > 0 else -humi_change
                    )
                    item["humidity"] = round(
                        tracked_humi + random.uniform(-0.2, 0.2), 1
                    )
                elif new_temp < 0:
                    item["humidity"] = round(
                        max(0.0, current_humi - 0.1 + random.uniform(-0.05, 0.05)), 1
                    )
                else:
                    item["humidity"] = round(
                        max(0.0, min(100.0, current_humi + random.uniform(-0.3, 0.3))),
                        1,
                    )

            elif status == "FINISHING":
                finishing_sop_json = item.get("active_sop_json")
                if finishing_sop_json:
                    try:
                        finishing_sop = json.loads(finishing_sop_json)
                        finishing_ramp = (finishing_sop.get("ramp_rate") or 1.0) / 60.0
                    except Exception as e:
                        logger.warning(f"[{device_id}] finishing_sop_json 解析失敗，使用預設 ramp：{e}")
                        finishing_ramp = 1.0 / 60.0
                else:
                    finishing_ramp = 1.0 / 60.0

                diff = 25.0 - current_temp
                if abs(diff) > 0.5:
                    item["temperature"] = round(
                        current_temp
                        + (finishing_ramp if diff > 0 else -finishing_ramp),
                        2,
                    )
                else:
                    item["temperature"] = 25.0
                    finishing_op_user_id = item.get("operator_user_id")
                    async with app.state.DEVICE_LOCKS[device_id]:
                        item.update(
                            {
                                "status": "IDLE",
                                "running_sop_name": "STANDBY",
                                "running_sop_id": None,
                                "standard_id": None,
                                "operator": "",
                                "operator_user_id": None,
                                "sim_phase": "idle",
                                "sim_cycle": 0,
                            }
                        )
                        _save_device_state(device_id, item)
                    logger.info(f"[{device_id}] 降溫完成，回待機。")
                    asyncio.create_task(
                        push_sop_notification(
                            finishing_op_user_id,
                            f"✅ [{device_id}] 測試完成，已回到待機狀態。"
                        )
                    )
                item["humidity"] = round(
                    max(0.0, min(100.0, current_humi + random.uniform(-0.2, 0.2))), 1
                )

            elif status == "EMERGENCY":
                item["temperature"] = round(
                    current_temp + random.uniform(-0.05, 0.05), 2
                )
                item["humidity"] = round(
                    max(0.0, min(100.0, current_humi + random.uniform(-0.1, 0.1))), 1
                )

            if status in ["RUNNING", "FINISHING", "EMERGENCY"]:
                write_counters[device_id] += 1
                if write_counters[device_id] >= 10:
                    try:
                        with SessionLocal() as db:
                            db.add(
                                DeviceData(
                                    device_id=device_id,
                                    temperature=item["temperature"],
                                    humidity=item.get("humidity", 55.0),
                                    timestamp=now,
                                )
                            )
                            db.commit()
                        _save_device_state(device_id, item)
                    except Exception as e:
                        logger.error(f"[{device_id}] DB write error: {e}")
                    write_counters[device_id] = 0
            else:
                write_counters[device_id] = 0

        await asyncio.sleep(1)
