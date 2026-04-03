import asyncio
import datetime
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .models import SessionLocal, DeviceData, ErrorLog, SopExecution
from .line import push_message
from .utils import _now_utc, _save_device_state
from .auth import _require_admin

logger = logging.getLogger("app")

router = APIRouter()


# ── Helper 函數 ─────────────────────────────────────────────────────────────


def _get_device(cache: dict, device_id: str) -> dict:
    device = cache.get(device_id)
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

    # ISO 17025 常溫穩定時間（測試後需要 30 分鐘常溫環境穩定）
    STABILIZATION_HOURS = 0.5
    total_seconds = (total_min + STABILIZATION_HOURS * 60) * 60.0

    if isinstance(started_at, str):
        started_dt = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    else:
        started_dt = started_at
    if started_dt.tzinfo is None:
        started_dt = started_dt.replace(tzinfo=datetime.timezone.utc)

    estimated_end = started_dt + datetime.timedelta(seconds=total_seconds)
    return estimated_end.isoformat()


# ── 路由 ────────────────────────────────────────────────────────────────────


@router.get("/api/devices")
async def get_all_devices(request: Request):
    cache = request.app.state.AICM_CACHE
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
        for device_id, item in cache.items()
    ]


@router.get("/api/devices/{device_id}/history")
async def get_device_history(device_id: str, request: Request):
    device = _get_device(request.app.state.AICM_CACHE, device_id)

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


@router.get("/api/latest")
async def get_latest(request: Request):
    cache = request.app.state.AICM_CACHE
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


@router.post("/api/stop/{device_id}/emergency")
async def emergency_stop(device_id: str, request: Request):
    _require_admin(request)
    cache = request.app.state.AICM_CACHE
    locks = request.app.state.DEVICE_LOCKS
    device = _get_device(cache, device_id)

    async with locks[device_id]:
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
        push_message(
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


@router.post("/api/devices/{device_id}/set-phase")
async def set_phase(device_id: str, payload: SetPhasePayload, request: Request):
    """管理員手動跳相位（用於 demo / 手動接管）"""
    _require_admin(request)
    cache = request.app.state.AICM_CACHE
    locks = request.app.state.DEVICE_LOCKS
    device = _get_device(cache, device_id)
    if payload.phase not in _VALID_PHASES:
        raise HTTPException(status_code=400, detail=f"無效的 phase：{payload.phase}")
    async with locks[device_id]:
        if device.get("status") not in ("RUNNING", "PAUSED"):
            raise HTTPException(status_code=400, detail="設備未在執行中")
        device["sim_phase"] = payload.phase
        _save_device_state(device_id, device)
    return {"status": "success", "sim_phase": payload.phase}


@router.post("/api/devices/{device_id}/progress")
async def update_progress(device_id: str, payload: ProgressPayload, request: Request):
    _require_admin(request)
    cache = request.app.state.AICM_CACHE
    locks = request.app.state.DEVICE_LOCKS
    device = _get_device(cache, device_id)
    async with locks[device_id]:
        device["completed_steps"] = payload.completed
        _save_device_state(device_id, device)
    return {"status": "success", "completed_steps": payload.completed}


@router.post("/api/stop/{device_id}/pause")
async def pause_test(device_id: str, request: Request):
    _require_admin(request)
    cache = request.app.state.AICM_CACHE
    locks = request.app.state.DEVICE_LOCKS
    device = _get_device(cache, device_id)
    async with locks[device_id]:
        if device["status"] not in ("RUNNING", "PAUSED"):
            raise HTTPException(status_code=400, detail=f"{device_id} 非執行中狀態，無法暫停／繼續")
        if device["status"] == "RUNNING":
            device["status"] = "PAUSED"
        else:
            device["status"] = "RUNNING"
        _save_device_state(device_id, device)
    return {"status": "success"}


@router.post("/api/stop/{device_id}/normal")
async def normal_stop(device_id: str, request: Request):
    _require_admin(request)
    cache = request.app.state.AICM_CACHE
    locks = request.app.state.DEVICE_LOCKS
    device = _get_device(cache, device_id)
    async with locks[device_id]:
        if device["status"] not in ("RUNNING", "PAUSED", "EMERGENCY"):
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
