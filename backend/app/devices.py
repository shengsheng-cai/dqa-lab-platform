import asyncio
import datetime
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .models import SessionLocal, DeviceData, ErrorLog, SopExecution, DeviceBlockedPeriod
from .line import push_message
from .utils import (
    _now_utc, _now_utc_naive, _parse_conditions, parse_iso_utc, device_free_at,
)
from .auth import require_admin, current_user
from .audit_log import log_audit
from .schedule_service import list_running_schedules

logger = logging.getLogger("app")

router = APIRouter(tags=["devices"])


# ── Helper 函數 ─────────────────────────────────────────────────────────────


def _bucket_by_minute(rows):
    buckets: dict = {}
    for row in rows:
        key = row.timestamp.strftime("%Y-%m-%d %H:%M")
        if key not in buckets:
            buckets[key] = {"temps": [], "humis": []}
        if row.temperature is not None:
            buckets[key]["temps"].append(row.temperature)
        if row.humidity is not None:
            buckets[key]["humis"].append(row.humidity)
    return buckets


def _calc_control_limits(vals):
    if len(vals) < 5:
        return None, None, None
    mean = sum(vals) / len(vals)
    sigma = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
    return round(mean, 2), round(mean + 3 * sigma, 2), round(mean - 3 * sigma, 2)


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
    """設備卡顯示用：占用結束時間轉成 ISO 字串。估算本身與排程器共用 device_free_at。"""
    end = device_free_at(item, _now_utc())
    return end.isoformat() if end else None


# ── Response Schemas ────────────────────────────────────────────────────────

DeviceStatus = Literal["IDLE", "RUNNING", "PAUSED", "FINISHING", "EMERGENCY", "OFFLINE"]
SimPhase = Literal[
    "idle", "ramp_to_low", "ramp_to_high", "dwell_high",
    "ramp_to_low2", "dwell_low", "ramp_to_ambient", "stabilize",
]


class DeviceOut(BaseModel):
    status: DeviceStatus
    temperature: float
    humidity: float
    running_sop_name: str
    description: str
    timestamp: str
    device_id: str
    active_sop_json: Optional[str] = None
    completed_steps: int
    total_steps: int
    started_at: Optional[str] = None
    estimated_end_at: Optional[str] = None
    sim_cycle: int
    sim_phase: SimPhase
    dwell_half_fired: bool
    # 有值代表這台身上有還沒結案的排程。純粹是顯示用的說明，不得拿來擋操作——
    # 會擋啟動的只有 maintenance_blocked。
    running_schedule_note: Optional[str] = None
    maintenance_blocked: bool
    maintenance_reason: Optional[str] = None
    maintenance_end_at: Optional[str] = None


class DeviceHistoryPoint(BaseModel):
    time: str
    full_time: str
    temperature: Optional[float] = None
    humidity: Optional[float] = None


class SensorDataPoint(BaseModel):
    time: str
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    temp_anomaly: bool = False
    humi_anomaly: bool = False


class SensorStatsOut(BaseModel):
    data: list[SensorDataPoint]
    temp_mean: Optional[float] = None
    temp_ucl: Optional[float] = None
    temp_lcl: Optional[float] = None
    humi_mean: Optional[float] = None
    humi_ucl: Optional[float] = None
    humi_lcl: Optional[float] = None
    anomaly_count: int = 0
    hours: int = 24


# ── 路由 ────────────────────────────────────────────────────────────────────


def build_device_list(cache: dict) -> list:
    now_dt = _now_utc()
    now = now_dt.strftime("%Y-%m-%dT%H:%M:%S")

    with SessionLocal() as db:
        active_blocks = db.query(DeviceBlockedPeriod).filter(
            DeviceBlockedPeriod.start_time <= now_dt,
            # 到結束時刻就解除封鎖（用 > 不用 >=），與啟動判斷 device_blocked_reason_now 一致，
            # 否則列表在結束那一瞬還顯示「不可用」、啟動卻已放行，兩邊對不上。
            DeviceBlockedPeriod.end_time > now_dt,
        ).all()
        running_schedules = list_running_schedules(db)
    # 同一台設備可能有重疊的不可用時段。即時狀態要顯示「最後才解除」的那一段，
    # 不能依資料庫剛好回傳的順序挑第一筆，否則畫面會提早宣稱設備已可用。
    maintenance_by_device = {}
    for block in active_blocks:
        current = maintenance_by_device.get(block.device_id)
        if current is None or block.end_time > current.end_time:
            maintenance_by_device[block.device_id] = block

    # 維護時段與「身上有排程」是兩件事，分開送：維護會擋啟動，排程掛著不會（後端只認
    # 維護時段，見 utils.device_blocked_reason_now）。以前兩者合成同一個旗標，畫面就只能
    # 猜這台到底是壞了還是有人在用。
    schedule_notes: dict[str, str] = {}
    for s in running_schedules:
        if s.device_id:
            total = len(_parse_conditions(s.conditions))
            idx = (s.current_condition_index or 0) + 1
            schedule_notes[s.device_id] = f"排程進行中（第 {idx}/{total} 條件）"

    result = []
    for device_id, item in cache.items():
        maintenance = maintenance_by_device.get(device_id)
        result.append({
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
            "dwell_half_fired": item.get("dwell_half_fired", False),
            "running_schedule_note": schedule_notes.get(device_id),
            "maintenance_blocked": maintenance is not None,
            "maintenance_reason": maintenance.reason if maintenance else None,
            "maintenance_end_at": maintenance.end_time.isoformat() if maintenance else None,
        })
    return result


@router.get("/api/devices", response_model=list[DeviceOut])
def get_all_devices(request: Request):
    return build_device_list(request.app.state.AICM_CACHE)


@router.get("/api/devices/{device_id}/history", response_model=list[DeviceHistoryPoint])
def get_device_history(device_id: str, request: Request):
    device = _get_device(request.app.state.AICM_CACHE, device_id)

    started_at = device.get("started_at")
    if not started_at:
        return []

    if isinstance(started_at, str):
        started_dt = parse_iso_utc(started_at)
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

    buckets = _bucket_by_minute(rows)
    result = []
    for key, data in sorted(buckets.items()):
        avg_temp = round(sum(data["temps"]) / len(data["temps"]), 2) if data["temps"] else None
        avg_humi = round(sum(data["humis"]) / len(data["humis"]), 2) if data["humis"] else None
        result.append({"time": key[11:], "full_time": key, "temperature": avg_temp, "humidity": avg_humi})

    return result


@router.get("/api/devices/{device_id}/sensor-stats", response_model=SensorStatsOut)
def get_sensor_stats(device_id: str, request: Request, hours: int = 24):
    """以每分鐘平均值建立控制界線，並計算異常分鐘數。

    圖表點、平均值、上下控制界線與 anomaly_count 都使用相同的分鐘粒度；
    anomaly_count 不是超界原始樣本數，避免取樣頻率改變時扭曲異常程度。
    """
    _get_device(request.app.state.AICM_CACHE, device_id)
    cutoff = _now_utc_naive() - datetime.timedelta(hours=hours)

    with SessionLocal() as db:
        rows = (
            db.query(DeviceData)
            .filter(DeviceData.device_id == device_id, DeviceData.timestamp >= cutoff)
            .order_by(DeviceData.timestamp.asc())
            .all()
        )

    if not rows:
        return SensorStatsOut(data=[], anomaly_count=0, hours=hours)

    buckets = _bucket_by_minute(rows)
    points = []
    for key in sorted(buckets):
        d = buckets[key]
        avg_t = round(sum(d["temps"]) / len(d["temps"]), 2) if d["temps"] else None
        avg_h = round(sum(d["humis"]) / len(d["humis"]), 2) if d["humis"] else None
        points.append({"time": key[11:], "temperature": avg_t, "humidity": avg_h})

    temps = [p["temperature"] for p in points if p["temperature"] is not None]
    humis = [p["humidity"] for p in points if p["humidity"] is not None]
    temp_mean, temp_ucl, temp_lcl = _calc_control_limits(temps)
    humi_mean, humi_ucl, humi_lcl = _calc_control_limits(humis)

    data = []
    anomaly_count = 0
    for p in points:
        t_anom = (
            temp_ucl is not None
            and p["temperature"] is not None
            and (p["temperature"] > temp_ucl or p["temperature"] < temp_lcl)
        )
        h_anom = (
            humi_ucl is not None
            and p["humidity"] is not None
            and (p["humidity"] > humi_ucl or p["humidity"] < humi_lcl)
        )
        if t_anom or h_anom:
            anomaly_count += 1
        data.append(SensorDataPoint(
            time=p["time"],
            temperature=p["temperature"],
            humidity=p["humidity"],
            temp_anomaly=t_anom,
            humi_anomaly=h_anom,
        ))

    return SensorStatsOut(
        data=data,
        temp_mean=temp_mean,
        temp_ucl=temp_ucl,
        temp_lcl=temp_lcl,
        humi_mean=humi_mean,
        humi_ucl=humi_ucl,
        humi_lcl=humi_lcl,
        anomaly_count=anomaly_count,
        hours=hours,
    )


def _record_emergency_stop(db, device_id: str, device: dict, user_id, role):
    operator = device.get("operator", "") or "未填寫"
    sop_name = device.get("running_sop_name", "") or "未知測試"
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
            created_at=_now_utc_naive(),
        )
    )
    execution = db.query(SopExecution).filter(
        SopExecution.device_id == device_id,
        SopExecution.test_ended_at.is_(None),
        SopExecution.test_started_at.isnot(None)
    ).first()
    if execution:
        execution.test_ended_at = _now_utc_naive()
    log_audit(db, str(user_id or "unknown"), role, "EMERGENCY_STOP", "device", device_id,
              f"操作人員：{operator}，測試：{sop_name}")


@router.post("/api/stop/{device_id}/emergency")
async def emergency_stop(device_id: str, request: Request, _: None = Depends(require_admin)):
    states = request.app.state.DEVICE_STATE
    _get_device(states, device_id)
    kson = getattr(request.app.state, "KSON_DEVICES", {}).get(device_id)

    async def stop_hardware() -> None:
        stopped = await kson.stop()
        if not stopped:
            logger.warning(f"[{device_id}] kson.stop() 未收到 ACK，仍繼續更新狀態")

    u = current_user(request)

    def record_emergency(db, device):
        _record_emergency_stop(db, device_id, device, u.user_id, u.role)

    result = await states.emergency(
        device_id,
        stop=stop_hardware if kson else None,
        record=record_emergency,
    )
    if result.reason == "already_emergency":
        return {
            "status": "already_emergency",
            "message": f"{device_id} 已在緊急停止狀態",
        }
    device = result.before
    operator = device.get("operator", "") or "未填寫"
    sop_name = device.get("running_sop_name", "") or "未知測試"

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


@router.post("/api/devices/{device_id}/set-phase", include_in_schema=False)
async def set_phase(device_id: str, payload: SetPhasePayload, request: Request, _: None = Depends(require_admin)):
    """管理員手動跳相位（用於 demo / 手動接管）"""
    states = request.app.state.DEVICE_STATE
    _get_device(states, device_id)
    if payload.phase not in _VALID_PHASES:
        raise HTTPException(status_code=400, detail=f"無效的 phase：{payload.phase}")
    result = await states.advance(
        device_id,
        sim_phase=payload.phase,
        expected_statuses=("RUNNING", "PAUSED"),
        checkpoint=True,
    )
    if result.reason == "stale_status":
        raise HTTPException(status_code=400, detail="設備未在執行中")
    return {"status": "success", "sim_phase": payload.phase}


@router.post("/api/devices/{device_id}/progress", include_in_schema=False)
async def update_progress(device_id: str, payload: ProgressPayload, request: Request, _: None = Depends(require_admin)):
    states = request.app.state.DEVICE_STATE
    _get_device(states, device_id)
    await states.advance(
        device_id,
        completed_steps=payload.completed,
        checkpoint=True,
    )
    return {"status": "success", "completed_steps": payload.completed}


@router.post("/api/stop/{device_id}/pause")
async def pause_test(device_id: str, request: Request, _: None = Depends(require_admin)):
    states = request.app.state.DEVICE_STATE
    _get_device(states, device_id)
    result = await states.pause(device_id)
    if not result.changed:
        raise HTTPException(status_code=400, detail=f"{device_id} 非執行中狀態，無法暫停／繼續")
    return {"status": "success"}


@router.post("/api/stop/{device_id}/normal")
async def normal_stop(device_id: str, request: Request, skip_push: bool = False, _: None = Depends(require_admin)):
    states = request.app.state.DEVICE_STATE
    _get_device(states, device_id)
    result = await states.finish(device_id, notify=not skip_push)
    if not result.changed:
        raise HTTPException(status_code=400, detail=f"{device_id} 非執行中狀態，無法停止")
    return {"status": "success"}
