from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

import asyncio
import datetime
import json
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from .sop import router as sop_router, execution_router, DEVICE_IDS
from .reports import router as reports_router
from .errors import router as errors_router
from .ai import router as ai_router
from .rag import warmup_rag
from .line import router as line_router, push_message
from .models import SessionLocal, DeviceData, ErrorLog, DeviceState
from .standards import get_ramp_rate, get_standard
from .utils import _now_utc, _save_device_state

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
                # fix #6: 恢復時也要還原 cycle 狀態
                "sim_phase": "running",
                "sim_cycle": 0,
            }
            print(f"🔄 [{device_id}] 恢復狀態：{s.status}，溫度：{s.temperature}°C")
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
                "sim_phase": "idle",
                "sim_cycle": 0,
            }

    app.state.AICM_CACHE = cache

    sim_task = asyncio.create_task(data_simulator())
    background_tasks.add(sim_task)
    sim_task.add_done_callback(background_tasks.discard)
    print(f"✅ System initialized with {len(DEVICE_IDS)} devices: {DEVICE_IDS}")

    task = asyncio.create_task(warmup_rag())
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
    yield


app = FastAPI(title="KSON AICM Digital Twin Server", lifespan=lifespan)

app.include_router(sop_router, prefix="/api/sop", tags=["sop"])
app.include_router(execution_router)
app.include_router(reports_router)
app.include_router(errors_router)
app.include_router(ai_router)
app.include_router(line_router)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

from .auth import auth_middleware
from starlette.middleware.base import BaseHTTPMiddleware

app.add_middleware(BaseHTTPMiddleware, dispatch=auth_middleware)
# ============================================================
# 工具函式
# ============================================================


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
    """
    fix #5: 低溫邏輯與前端 generateSP 對齊。
    路徑：
      有 low_temp 且 low_temp < ambient（低溫測試）：
        ambient → low → (high → dwell → low → dwell) × cycles → ambient
      有 low_temp 且 low_temp >= ambient（雙溫循環）：
        ambient → high → (dwell → low → dwell → high) × cycles → ambient
      無 low_temp（單溫段）：
        ambient → target → dwell → ambient
    """
    status = item.get("status")
    if status not in ("RUNNING", "PAUSED"):
        return None

    started_at = item.get("started_at")
    active_sop_json = item.get("active_sop_json")
    if not started_at or not active_sop_json:
        return None

    try:
        sop = json.loads(active_sop_json)
    except Exception:
        return None

    ramp_rate = sop.get("ramp_rate") or 1.0
    dwell_hours = sop.get("dwell_time_hours") or 0.0
    dwell_min = dwell_hours * 60.0
    cycles = sop.get("cycles") or 1
    high_temp = sop.get("high_temperature") or sop.get("target_temperature") or 25.0
    low_temp = sop.get("low_temperature")
    ambient = 25.0

    if low_temp is not None and low_temp < ambient:
        # 低溫測試：ambient→low, (low→high→dwell→low→dwell)×cycles, low→ambient
        ramp_ambient_to_low = abs(ambient - low_temp) / ramp_rate
        ramp_low_to_high = abs(high_temp - low_temp) / ramp_rate
        one_cycle_min = ramp_low_to_high + dwell_min + ramp_low_to_high + dwell_min
        total_min = ramp_ambient_to_low + one_cycle_min * cycles + ramp_ambient_to_low
    elif low_temp is not None:
        # 雙溫循環（low >= ambient）：ambient→high, (dwell→low→dwell→high)×cycles, →ambient
        ramp_up = abs(high_temp - ambient) / ramp_rate
        ramp_hl = abs(high_temp - low_temp) / ramp_rate
        one_cycle_min = dwell_min + ramp_hl + dwell_min + ramp_hl
        total_min = (
            ramp_up + one_cycle_min * cycles + abs(low_temp - ambient) / ramp_rate
        )
    else:
        # 單溫段
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


# ============================================================
# 設備狀態 API
# ============================================================


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
    if not cache or "KSON_CH01" not in cache:
        return {
            "status": "OFFLINE",
            "temperature": 0.0,
            "humidity": 0.0,
            "running_sop_name": "未連線",
            "description": "等待模擬器啟動...",
            "timestamp": _now_utc().strftime("%H:%M:%S"),
        }
    data = cache["KSON_CH01"]
    status = data.get("status", "OFFLINE")
    return {
        "status": status,
        "temperature": data.get("temperature", 0.0),
        "humidity": data.get("humidity", 0.0),
        "running_sop_name": data.get("running_sop_name", "STANDBY"),
        "description": _make_description(status, data.get("running_sop_name", "")),
        "timestamp": _now_utc().strftime("%H:%M:%S"),
    }


# ============================================================
# 各設備獨立控制 API
# ============================================================


@app.post("/api/stop/{device_id}/emergency")
async def emergency_stop(device_id: str):
    device = _get_device(device_id)

    # fix #3: 已是 EMERGENCY 直接 return，避免重複寫入 ErrorLog
    if device.get("status") == "EMERGENCY":
        return {
            "status": "already_emergency",
            "message": f"{device_id} 已在緊急停止狀態",
        }

    with SessionLocal() as db:
        db.add(
            ErrorLog(
                device_id=device_id,
                error_type="EMERGENCY",
                sop_id=device.get("running_sop_id"),
                sop_name=device.get("running_sop_name"),
                temperature=device.get("temperature"),
                humidity=device.get("humidity"),
                note="操作人員觸發緊急停止",
                # fix #9: 記錄當下步驟進度
                completed_steps=device.get("completed_steps", 0),
                total_steps=device.get("total_steps", 0),
                created_at=_now_utc(),
            )
        )
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
            "sim_phase": "idle",
            "sim_cycle": 0,
        }
    )
    _save_device_state(device_id, device)
    print(f"🚨 [{device_id}] EMERGENCY STOP")

    asyncio.create_task(
        push_message(
            f"🚨 [{device_id}] 緊急停止已觸發\n溫度：{device.get('temperature', 0.0):.1f}°C"
        )
    )
    return {"status": "success", "message": f"{device_id} 緊急停止已觸發"}


class ProgressPayload(BaseModel):
    completed: int = 0


@app.post("/api/devices/{device_id}/progress")
async def update_progress(device_id: str, payload: ProgressPayload):
    device = _get_device(device_id)
    device["completed_steps"] = payload.completed
    _save_device_state(device_id, device)
    return {"status": "success", "completed_steps": payload.completed}


@app.post("/api/stop/{device_id}/pause")
async def pause_test(device_id: str):
    device = _get_device(device_id)
    if device["status"] == "RUNNING":
        device["status"] = "PAUSED"
    elif device["status"] == "PAUSED":
        device["status"] = "RUNNING"
    _save_device_state(device_id, device)
    return {"status": "success"}


@app.post("/api/stop/{device_id}/normal")
async def normal_stop(device_id: str):
    device = _get_device(device_id)
    device.update(
        {
            "status": "FINISHING",
            "running_sop_name": "系統自動降溫收尾中...",
            "active_sop_json": None,
            "completed_steps": 0,
            "started_at": None,
            # fix #11: 同步清除 standard_id，避免 IDLE 後讀到舊值
            "standard_id": None,
            "sim_phase": "idle",
            "sim_cycle": 0,
        }
    )
    _save_device_state(device_id, device)
    return {"status": "success"}


# ============================================================
# 物理模擬引擎
# ============================================================


async def data_simulator():
    """
    物理模擬器 — 5 台各自獨立運作，每 10 秒寫一次資料庫。

    fix #6: 完整 cycle 邏輯，使用 sim_phase 追蹤當前階段：
      - "ramp_to_low"   : 降至低溫目標（低溫測試第一段）
      - "ramp_to_high"  : 升至高溫目標
      - "dwell_high"    : 高溫停留
      - "ramp_to_low2"  : 降至低溫（cycle 中間段）
      - "dwell_low"     : 低溫停留
      - "ramp_to_ambient": 回到 ambient

    fix #10: 濕度從上次值為基礎抖動，RUNNING 時追蹤 SOP 設定值。
    """
    write_counters: dict = {}
    # 每個設備的停留計時器（秒）
    dwell_counters: dict = {}

    while True:
        cache = app.state.AICM_CACHE
        now = _now_utc()

        for device_id, item in cache.items():
            status = item.get("status", "OFFLINE")
            current_temp = item.get("temperature", 25.0)
            current_humi = item.get("humidity", 55.0)

            if device_id not in write_counters:
                write_counters[device_id] = 0
            if device_id not in dwell_counters:
                dwell_counters[device_id] = 0

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

                # fix #6: 初始化 sim_phase（剛啟動時）
                if not sim_phase or sim_phase == "idle":
                    if low_temp is not None and low_temp < ambient:
                        item["sim_phase"] = "ramp_to_low"
                    else:
                        item["sim_phase"] = "ramp_to_high"
                    item["sim_cycle"] = 0
                    sim_phase = item["sim_phase"]
                    dwell_counters[device_id] = 0

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
                        item["sim_phase"] = "ramp_to_high"

                elif sim_phase == "ramp_to_high":
                    new_temp = move_toward(current_temp, high_temp)
                    if abs(new_temp - high_temp) <= 0.1:
                        new_temp = high_temp
                        item["sim_phase"] = "dwell_high"
                        dwell_counters[device_id] = 0

                elif sim_phase == "dwell_high":
                    new_temp = high_temp
                    dwell_counters[device_id] += 1
                    if dwell_counters[device_id] >= dwell_seconds:
                        dwell_counters[device_id] = 0
                        if low_temp is not None and cycles > 1:
                            item["sim_phase"] = "ramp_to_low2"
                        else:
                            item["sim_phase"] = "ramp_to_ambient"

                elif sim_phase == "ramp_to_low2":
                    new_temp = move_toward(current_temp, low_temp)
                    if abs(new_temp - low_temp) <= 0.1:
                        new_temp = low_temp
                        item["sim_phase"] = "dwell_low"
                        dwell_counters[device_id] = 0

                elif sim_phase == "dwell_low":
                    new_temp = low_temp
                    dwell_counters[device_id] += 1
                    if dwell_counters[device_id] >= dwell_seconds:
                        dwell_counters[device_id] = 0
                        item["sim_cycle"] = sim_cycle + 1
                        if item["sim_cycle"] < cycles:
                            item["sim_phase"] = "ramp_to_high"
                        else:
                            item["sim_phase"] = "ramp_to_ambient"

                elif sim_phase == "ramp_to_ambient":
                    new_temp = move_toward(current_temp, ambient)
                    if abs(new_temp - ambient) <= 0.1:
                        new_temp = ambient

                item["temperature"] = round(new_temp + random.uniform(-0.1, 0.1), 2)

                # fix #10: 濕度追蹤 SOP 設定值，從上次值為基礎抖動
                if target_humi is not None and new_temp >= 0:
                    # 往目標值緩慢追蹤（每秒最多變化 0.3%RH）
                    humi_diff = target_humi - current_humi
                    humi_change = min(abs(humi_diff), 0.3)
                    tracked_humi = current_humi + (
                        humi_change if humi_diff > 0 else -humi_change
                    )
                    item["humidity"] = round(
                        tracked_humi + random.uniform(-0.2, 0.2), 1
                    )
                elif new_temp < 0:
                    # 低溫段：濕度緩慢下降至接近 0（結霜效果）
                    item["humidity"] = round(
                        max(0.0, current_humi - 0.1 + random.uniform(-0.05, 0.05)), 1
                    )
                else:
                    # 無濕度控制：在現有值附近小幅抖動
                    item["humidity"] = round(
                        max(0.0, min(100.0, current_humi + random.uniform(-0.3, 0.3))),
                        1,
                    )

            elif status == "FINISHING":
                diff = 25.0 - current_temp
                if abs(diff) > 0.5:
                    item["temperature"] = round(
                        current_temp + (0.4 if diff > 0 else -0.4), 2
                    )
                else:
                    item["temperature"] = 25.0
                    item.update(
                        {
                            "status": "IDLE",
                            "running_sop_name": "STANDBY",
                            "running_sop_id": None,
                            "standard_id": None,
                            "sim_phase": "idle",
                            "sim_cycle": 0,
                        }
                    )
                    _save_device_state(device_id, item)
                    print(f"✅ [{device_id}] 降溫完成，回待機。")
                    asyncio.create_task(
                        push_message(f"✅ [{device_id}] 測試完成，已回到待機狀態。")
                    )
                # fix #10: FINISHING 時濕度也小幅抖動
                item["humidity"] = round(
                    max(0.0, min(100.0, current_humi + random.uniform(-0.2, 0.2))), 1
                )

            elif status == "EMERGENCY":
                item["temperature"] = round(
                    current_temp + random.uniform(-0.05, 0.05), 2
                )
                # fix #10: EMERGENCY 時濕度也小幅抖動
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
                        print(f"[{device_id}] DB write error: {e}")
                    write_counters[device_id] = 0
            else:
                write_counters[device_id] = 0

        await asyncio.sleep(1)
