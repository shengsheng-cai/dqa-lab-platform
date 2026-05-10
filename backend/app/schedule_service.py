"""
排程業務邏輯層（service layer）

從 schedules.py 拆出的私有函式，供 schedules.py routes、main.py APScheduler、
simulator.py 共同使用。所有函式均不依賴 FastAPI context，可直接 pytest 測試。
"""
import asyncio
import datetime
import json
import logging
from typing import Optional, List

from .models import (
    SessionLocal, Schedule, ScheduleStatus, DeviceBlockedPeriod,
    ScheduleFixture, Fixture, FixtureLoan,
)
from .standards import get_standard
from .sop import DEVICE_IDS
from .utils import _now_utc, _now_utc_naive, _save_device_state, _parse_conditions, parse_iso_utc
from .audit import log_audit

logger = logging.getLogger("schedule_service")

INTER_CONDITION_BUFFER_HOURS = 0.5
ACTIVE_STATUSES = [ScheduleStatus.PENDING, ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]
STABILIZATION_HOURS = 0.5


# ── 排程完成 ─────────────────────────────────────────────────────────────────


def _complete_schedule(db, schedule, now: datetime.datetime) -> None:
    """排程標為已完成，並將借出治具改為已歸還（不 commit，由呼叫方負責）"""
    schedule.status = ScheduleStatus.DONE
    schedule.updated_at = now
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == schedule.id,
        FixtureLoan.status == "loaned",
    ).update(
        {"status": "returned", "return_date": now},
        synchronize_session=False,
    )


# ── 時長計算 ──────────────────────────────────────────────────────────────────


def _calc_ramp_minutes(
    ramp_rate: float, dwell_min: float, cycles: int,
    high_temp: float, low_temp: Optional[float], ambient: float = 25.0,
) -> float:
    """溫度曲線總分鐘數（不含常溫穩定段），三分支：低↔高循環 / 高+低同側 / 純高溫"""
    if low_temp is not None and low_temp < ambient:
        r_lo = abs(ambient - low_temp) / ramp_rate
        r_hl = abs(high_temp - low_temp) / ramp_rate
        if r_hl < 0.01:
            return r_lo + dwell_min * cycles + r_lo
        return r_lo + (r_hl + dwell_min) * 2 * cycles + r_lo
    if low_temp is not None:
        r_up = abs(high_temp - ambient) / ramp_rate
        r_hl = abs(high_temp - low_temp) / ramp_rate
        r_dn = abs(low_temp - ambient) / ramp_rate
        return r_up + (dwell_min * 2 + r_hl * 2) * (cycles - 1) + (dwell_min * 2 + r_hl) + r_dn
    r_up = abs(high_temp - ambient) / ramp_rate
    return r_up + dwell_min + r_up


def _calc_condition_hours(sop_id: str) -> float:
    """計算單一測試條件的完整時長（含回常溫 + 30min 常溫穩定），單位：小時"""
    std = get_standard(sop_id)
    if not std:
        return 1.0

    ramp_rate = float(std.get("ramp_rate", 1.0))
    if ramp_rate <= 0:
        ramp_rate = 1.0
    dwell_min = float(std.get("dwell_time_hours", 1.0)) * 60.0
    cycles = int(std.get("cycles", 1))
    high_temp = float(std.get("high_temperature") or std.get("target_temperature") or 25.0)
    raw_low = std.get("low_temperature")
    low_temp = float(raw_low) if raw_low is not None else None

    return _calc_ramp_minutes(ramp_rate, dwell_min, cycles, high_temp, low_temp) / 60.0 + STABILIZATION_HOURS


def _calc_total_hours(conditions: List[str]) -> float:
    if not conditions:
        return 0.0
    total = sum(_calc_condition_hours(c) for c in conditions)
    total += INTER_CONDITION_BUFFER_HOURS * (len(conditions) - 1)
    return round(total, 2)


# ── 設備狀態工具 ──────────────────────────────────────────────────────────────


def _est_end_from_device(device: dict) -> Optional[datetime.datetime]:
    """從 AICM_CACHE 設備 dict 估算測試結束時間（UTC）；設備不在執行中則回傳 None"""
    if device.get("status") not in ("RUNNING", "PAUSED", "FINISHING"):
        return None

    cached_end = device.get("estimated_end_at")
    if cached_end:
        try:
            if isinstance(cached_end, str):
                dt = parse_iso_utc(cached_end)
            else:
                dt = cached_end
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return dt
        except Exception:
            pass

    started_at = device.get("started_at")
    active_sop_json = device.get("active_sop_json")
    if not started_at or not active_sop_json:
        return None
    try:
        sop = json.loads(active_sop_json) if isinstance(active_sop_json, str) else active_sop_json
    except Exception:
        return None

    ramp_rate = float(sop.get("ramp_rate") or 1.0)
    if ramp_rate <= 0:
        ramp_rate = 1.0
    dwell_min = float(sop.get("dwell_time_hours") or 0.0) * 60.0
    cycles = int(sop.get("cycles") or 1)
    high_temp = float(sop.get("high_temperature") or sop.get("target_temperature") or 25.0)
    raw_low = sop.get("low_temperature")
    low_temp = float(raw_low) if raw_low is not None else None

    total_min = _calc_ramp_minutes(ramp_rate, dwell_min, cycles, high_temp, low_temp)

    if isinstance(started_at, str):
        started_dt = parse_iso_utc(started_at)
    else:
        started_dt = started_at
    if started_dt.tzinfo is None:
        started_dt = started_dt.replace(tzinfo=datetime.timezone.utc)
    return started_dt + datetime.timedelta(minutes=total_min)


def _build_running_until(cache: dict) -> dict:
    """從 AICM_CACHE 建立 {device_id: estimated_end} dict，只含正在執行的設備"""
    result = {}
    for did, dev in cache.items():
        est = _est_end_from_device(dev)
        if est:
            result[did] = est
    return result


def _get_stuck_devices(cache: dict) -> set:
    """回傳超時超過 1 小時的設備 ID（估算結束時間已過，可能卡住，排除自動選機）"""
    now = _now_utc()
    return {
        did for did, dev in cache.items()
        if (est := _est_end_from_device(dev)) and (now - est).total_seconds() > 3600
    }


def _get_emergency_devices(cache: dict) -> set:
    """回傳狀態為 EMERGENCY 的設備 ID（不可排程）"""
    return {did for did, dev in cache.items() if dev.get("status") == "EMERGENCY"}


# ── 條件工具 ──────────────────────────────────────────────────────────────────


def _get_condition_names(conditions: List[str]) -> List[str]:
    names = []
    for sop_id in conditions:
        std = get_standard(sop_id)
        names.append(std.get("name", sop_id) if std else sop_id)
    return names


# ── DB 查詢工具 ───────────────────────────────────────────────────────────────


def _get_schedule_fixtures(schedule_id: int, db) -> list:
    return _build_schedule_fixtures_map(db, [schedule_id]).get(schedule_id, [])


def _build_schedule_fixtures_map(db, schedule_ids: list) -> dict:
    """一次取回所有排程的治具資料，回傳 {schedule_id: [fixture dicts]}"""
    if not schedule_ids:
        return {}
    sfs = db.query(ScheduleFixture).filter(ScheduleFixture.schedule_id.in_(schedule_ids)).all()
    if not sfs:
        return {}
    fixture_map = {
        f.id: f
        for f in db.query(Fixture).filter(Fixture.id.in_([sf.fixture_id for sf in sfs])).all()
    }
    result: dict = {}
    for sf in sfs:
        f = fixture_map.get(sf.fixture_id)
        result.setdefault(sf.schedule_id, []).append({
            "fixture_id": sf.fixture_id,
            "quantity": sf.quantity,
            "interface_type": f.interface_type if f else "",
            "form_factor": f.form_factor if f else "",
        })
    return result


def _enrich(s: Schedule, db=None, fixtures_map=None) -> dict:
    """Schedule ORM → dict，附加計算欄位"""
    conditions = _parse_conditions(s.conditions)
    return {
        "id": s.id,
        "project_number": s.project_number,
        "sample_name": s.sample_name,
        "applicant_name": s.applicant_name,
        "applicant_user_id": s.applicant_user_id,
        "device_id": s.device_id,
        "standard": s.standard,
        "conditions": conditions,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "status": s.status,
        "current_condition_index": s.current_condition_index,
        "note": s.note,
        "rejection_note": s.rejection_note,
        "created_by": s.created_by,
        "confirmed_by": s.confirmed_by,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
        "total_hours": _calc_total_hours(conditions),
        "condition_names": _get_condition_names(conditions),
        "fixtures": fixtures_map.get(s.id, []) if fixtures_map is not None else (
            _get_schedule_fixtures(s.id, db) if db is not None else []
        ),
    }


# ── 自動排程邏輯 ──────────────────────────────────────────────────────────────


def _find_earliest_slot(
    device_id: str,
    total_hours: float,
    db,
    running_until: Optional[dict] = None,
) -> datetime.datetime:
    """找出指定設備的最早可用開始時間（aware UTC）"""
    now = datetime.datetime.now(datetime.timezone.utc)

    candidate_start = now
    if running_until and device_id in running_until:
        live_end = running_until[device_id]
        if live_end and live_end > candidate_start:
            candidate_start = live_end

    existing = (
        db.query(Schedule)
        .filter(
            Schedule.device_id == device_id,
            Schedule.status.in_(ACTIVE_STATUSES),
            Schedule.end_time.isnot(None),
        )
        .all()
    )

    for s in existing:
        end = s.end_time
        if end.tzinfo is None:
            end = end.replace(tzinfo=datetime.timezone.utc)
        if end > candidate_start:
            candidate_start = end

    for _ in range(30):
        candidate_end = candidate_start + datetime.timedelta(hours=total_hours)
        blocked = (
            db.query(DeviceBlockedPeriod)
            .filter(
                DeviceBlockedPeriod.device_id == device_id,
                DeviceBlockedPeriod.end_time > candidate_start,
                DeviceBlockedPeriod.start_time < candidate_end,
            )
            .order_by(DeviceBlockedPeriod.start_time)
            .first()
        )
        if not blocked:
            break
        b_end = blocked.end_time
        if b_end.tzinfo is None:
            b_end = b_end.replace(tzinfo=datetime.timezone.utc)
        candidate_start = b_end

    return candidate_start


def _auto_assign(
    conditions: List[str],
    db,
    running_until: Optional[dict] = None,
    cache: Optional[dict] = None,
) -> tuple[str, datetime.datetime, datetime.datetime]:
    """自動選最早可用設備，回傳 (device_id, start_time, end_time)。
    超時卡機設備與 EMERGENCY 設備跳過；若所有設備皆排除則退回全選。"""
    stuck = _get_stuck_devices(cache) if cache is not None else set()
    emergency = _get_emergency_devices(cache) if cache is not None else set()
    total_hours = _calc_total_hours(conditions)
    best_device = None
    best_start = None

    candidates = [d for d in DEVICE_IDS if d not in stuck and d not in emergency]
    if not candidates:
        candidates = DEVICE_IDS

    for device_id in candidates:
        start = _find_earliest_slot(device_id, total_hours, db, running_until)
        if best_start is None or start < best_start:
            best_start = start
            best_device = device_id

    end_time = best_start + datetime.timedelta(hours=total_hours)
    return best_device, best_start, end_time


# ── 排程狀態自動推進 ──────────────────────────────────────────────────────────


async def _force_normal_stop(device_id: str, cache: dict, locks: dict):
    """取消/刪除排程時，若設備正在執行，改為正常收尾（不觸發 LINE 推播或錯誤記錄）。"""
    device = cache.get(device_id)
    if not device or device.get("status") not in ("RUNNING", "PAUSED"):
        return
    lock = locks.get(device_id)
    if not lock:
        return
    async with lock:
        if device.get("status") not in ("RUNNING", "PAUSED"):
            return
        device.update({
            "status": "FINISHING",
            "running_sop_name": "排程取消，降溫收尾中...",
            "sim_phase": "ramp_to_ambient",
            "sim_cycle": 0,
        })
        _save_device_state(device_id, device)


async def _start_schedule_by_id(schedule_id: int, cache: dict, locks: dict):
    """排程到達 start_time 時由 APScheduler date job 精確觸發。"""
    from .sop import auto_start_sop
    now = _now_utc_naive()
    with SessionLocal() as db:
        s = db.query(Schedule).filter(
            Schedule.id == schedule_id,
            Schedule.status == ScheduleStatus.CONFIRMED,
        ).first()
        if not s:
            return
        s.status = ScheduleStatus.RUNNING
        s.updated_at = now
        log_audit(db, "system:scheduler", None, "AUTO_START", "schedule", schedule_id,
                  f"{s.project_number} / {s.sample_name}")
        db.commit()
        conditions = json.loads(s.conditions) if s.conditions else []
        device_id = s.device_id

    if conditions and device_id:
        await auto_start_sop(device_id, conditions[0], cache, locks)


async def auto_advance_schedules(cache: dict = None, locks: dict = None):
    """Fallback：每 5 分鐘掃一次，補抓任何漏掉的已確認排程（如重啟後 date job 遺失）。"""
    from .sop import auto_start_sop
    now = _now_utc_naive()
    with SessionLocal() as db:
        to_running = (
            db.query(Schedule)
            .filter(Schedule.status == ScheduleStatus.CONFIRMED, Schedule.start_time <= now)
            .all()
        )
        for s in to_running:
            s.status = ScheduleStatus.RUNNING
            s.updated_at = now

        if to_running:
            db.commit()
            logger.info(f"[scheduler] fallback 推進：{len(to_running)} 筆→進行中")

        start_info = []
        for s in to_running:
            conditions = json.loads(s.conditions) if s.conditions else []
            if conditions and s.device_id:
                start_info.append((s.device_id, conditions[0]))

    if cache is not None and locks is not None and start_info:
        tasks = [auto_start_sop(dev, cond, cache, locks) for dev, cond in start_info]
        if tasks:
            await asyncio.gather(*tasks)
