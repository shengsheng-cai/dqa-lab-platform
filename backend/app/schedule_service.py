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
from .constants import DEVICE_IDS
from .utils import (
    _now_utc, _now_utc_naive, _save_device_state, _parse_conditions,
    parse_iso_utc, _to_naive_utc, device_blocked_reason_now,
)
from .audit import log_audit

logger = logging.getLogger("schedule_service")

INTER_CONDITION_BUFFER_HOURS = 0.5
ACTIVE_STATUSES = [ScheduleStatus.PENDING, ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]
STABILIZATION_HOURS = 0.5


# ── 排程完成 ─────────────────────────────────────────────────────────────────


def _return_loaned_fixtures(db, schedule_id: int, now: datetime.datetime) -> None:
    """把該排程「借出中」的治具標為已歸還並記下歸還時間（不 commit，由呼叫方負責）。

    完成與取消都會歸還治具，寫的欄位必須一樣——分開寫過就發生過「取消還回來的治具
    查不到歸還時間」。歸還要寫什麼只定義在這裡一處。
    """
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == schedule_id,
        FixtureLoan.status == "loaned",
    ).update(
        {"status": "returned", "return_date": now},
        synchronize_session=False,
    )


def _complete_schedule(db, schedule, now: datetime.datetime) -> None:
    """排程標為已完成，並將借出治具改為已歸還（不 commit，由呼叫方負責）"""
    schedule.status = ScheduleStatus.DONE
    schedule.updated_at = now
    _return_loaned_fixtures(db, schedule.id, now)


def _release_schedule_fixtures(
    db, schedule_id: int, now: datetime.datetime, *, return_loaned: bool = False,
) -> None:
    """排程走到終止狀態（取消／異常）時釋放它占用的治具（不 commit，由呼叫方負責）。

    取消和異常曾經各寫各的，漏掉一邊就會讓治具永遠卡住、可借量收不回來。收成同一支
    避免日後再漂：還沒真正借出的「預約」一律刪掉；return_loaned=True 時，連已經借出的
    也一併歸還（只有取消進行中排程需要，異常只會從已確認進來、不會有借出中的）。
    """
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == schedule_id,
        FixtureLoan.status == "reserved",
    ).delete(synchronize_session=False)
    if return_loaned:
        _return_loaned_fixtures(db, schedule_id, now)


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


def find_overlapping_schedule(
    db, schedule_id: Optional[int], device_id: Optional[str], start, end,
) -> Optional[Schedule]:
    """同一設備上與 [start, end) 重疊的有效排程（不含自己）；無則 None。

    這是 _find_earliest_slot 的另一面：那邊「找出不重疊的時段」，這邊「驗證時段不重疊」。
    兩者共用 ACTIVE_STATUSES，規則必須一致。
    """
    if not device_id or not start or not end:
        return None
    return (
        db.query(Schedule)
        .filter(
            Schedule.device_id == device_id,
            Schedule.id != schedule_id,
            Schedule.status.in_(ACTIVE_STATUSES),
            Schedule.start_time < end,
            Schedule.end_time > start,
        )
        .first()
    )


def _find_earliest_slot(
    device_id: str,
    total_hours: float,
    db,
    running_until: Optional[dict] = None,
) -> datetime.datetime:
    """找出指定設備的最早可用開始時間（naive UTC，供 DB 寫入）。"""
    now = _now_utc_naive()

    candidate_start = now
    if running_until and device_id in running_until:
        live_end = _to_naive_utc(running_until[device_id])
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
        end = _to_naive_utc(s.end_time)
        if end is None:
            continue
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
        b_end = _to_naive_utc(blocked.end_time)
        if b_end is None:
            continue
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
            "skip_push": True,
        })
        _save_device_state(device_id, device)


def _confirmed_schedules_db(schedule_id: Optional[int] = None) -> list[tuple]:
    """待啟動的已確認排程 → [(id, device_id, conditions)]。
    指定 schedule_id 取該筆；否則取所有已到開始時間的。"""
    with SessionLocal() as db:
        q = db.query(Schedule).filter(Schedule.status == ScheduleStatus.CONFIRMED)
        if schedule_id is not None:
            q = q.filter(Schedule.id == schedule_id)
        else:
            q = q.filter(Schedule.start_time <= _now_utc_naive())
        return [(s.id, s.device_id, _parse_conditions(s.conditions)) for s in q.all()]


def _activate_schedule_db(
    schedule_id: int, *,
    actor: str = "system:scheduler", role: Optional[str] = None, action: str = "AUTO_START",
) -> bool:
    """設備確實啟動後：排程轉進行中 + 預約治具轉借出 + 寫 audit（單一 transaction）。

    三件事必須同進同退——若分開 commit，中間失敗會讓排程已是進行中、治具卻永遠
    卡在「已預約」（_complete_schedule 只歸還 loaned，reserved 不會被回收）。

    自動（APScheduler）與手動（start_sop）兩條啟動路徑共用這一支，只有 audit 的
    操作者不同：自動預設記 system:scheduler／AUTO_START，手動由呼叫端傳入 admin／START。
    只在排程仍是「已確認」時動作；回傳是否真的啟動了（找不到或已非已確認回 False）。
    """
    now = _now_utc_naive()
    with SessionLocal() as db:
        s = db.query(Schedule).filter(
            Schedule.id == schedule_id,
            Schedule.status == ScheduleStatus.CONFIRMED,
        ).first()
        if not s:
            return False
        s.status = ScheduleStatus.RUNNING
        s.updated_at = now
        db.query(FixtureLoan).filter(
            FixtureLoan.schedule_id == schedule_id,
            FixtureLoan.status == "reserved",
        ).update(
            {"status": "loaned", "loan_date": now},
            synchronize_session=False,
        )
        log_audit(db, actor, role, action, "schedule", schedule_id,
                  f"{s.project_number} / {s.sample_name}")
        db.commit()
        return True


def _mark_schedule_error_db(schedule_id: int, reason: str) -> None:
    """壞排程收斂：已確認但缺設備/條件、永遠無法啟動 → 轉「異常」並停止重試。

    不同於「設備忙碌」（暫時性、應留 CONFIRMED 重試），缺設備/條件是資料層面的
    永久缺陷，每 5 分鐘重試也不會好。轉為終止狀態 ERROR（退出 ACTIVE_STATUSES，
    釋放設備時段占用），寫 audit 讓管理者在紀錄與排程頁看得到、可手動修復。
    """
    now = _now_utc_naive()
    with SessionLocal() as db:
        s = db.query(Schedule).filter(
            Schedule.id == schedule_id,
            Schedule.status == ScheduleStatus.CONFIRMED,
        ).first()
        if not s:
            return
        s.status = ScheduleStatus.ERROR
        s.updated_at = now
        # 轉「異常」＝排程永遠不會啟動，把它占用的治具放回去（比照「取消」），否則可借量卡死。
        _release_schedule_fixtures(db, schedule_id, now)
        log_audit(db, "system:scheduler", None, "ERROR", "schedule", schedule_id,
                  f"{s.project_number} / {s.sample_name}：{reason}")
        db.commit()


def _earliest_confirmed_schedule_id(device_id: str) -> Optional[int]:
    """該設備上最該先跑的「已確認」排程 id；沒有就回 None。

    同一台設備上可能排了多筆已確認，手動啟動 SOP 時要推進哪一筆的規則就定在這裡：
    預定開始時間最早的優先，同時間再用 id（建立先後）決勝，確保每次挑的都一樣。
    沒有開始時間的（資料異常）排到最後，不要被誤挑中。
    """
    with SessionLocal() as db:
        s = (
            db.query(Schedule)
            .filter(
                Schedule.device_id == device_id,
                Schedule.status == ScheduleStatus.CONFIRMED,
            )
            .order_by(
                Schedule.start_time.is_(None),
                Schedule.start_time.asc(),
                Schedule.id.asc(),
            )
            .first()
        )
        return s.id if s else None


async def try_start_schedule(
    schedule_id: int, device_id: Optional[str], conditions: List[str],
    cache: dict, locks: dict,
) -> bool:
    """啟動排程的唯一入口：設備真的進入 RUNNING 才把排程標為進行中、治具才轉借出。

    設備不可用時排程維持「已確認」，由 auto_advance_schedules 每 5 分鐘重試。
    """
    from .sop import auto_start_sop
    if not conditions or not device_id:
        logger.warning(f"[scheduler] 排程 #{schedule_id} 缺少測試條件或設備，轉「異常」停止重試")
        await asyncio.to_thread(_mark_schedule_error_db, schedule_id, "缺少測試條件或設備")
        return False

    # 設備在維護（不可用）時段內不自動啟動，維持「已確認」等維護結束後重試。
    # 維護是暫時性阻擋（會結束），與「設備忙碌」同類，故不轉「異常」。
    blocked_reason = await asyncio.to_thread(device_blocked_reason_now, device_id)
    if blocked_reason is not None:
        logger.info(
            f"[scheduler] 排程 #{schedule_id} 的 {device_id} 在維護時段"
            f"（{blocked_reason}），維持「已確認」等待重試"
        )
        return False

    if not await auto_start_sop(device_id, conditions[0], cache, locks):
        logger.info(f"[scheduler] 排程 #{schedule_id} 的 {device_id} 非 IDLE，維持「已確認」等待重試")
        return False

    # 這裡不看 _activate_schedule_db 的回傳：設備已經真的啟動了，就算排程剛好被別人
    # 搶先推進（回 False），對呼叫方而言「這次啟動成功」仍然成立。
    await asyncio.to_thread(_activate_schedule_db, schedule_id)
    return True


async def _start_schedule_by_id(schedule_id: int, cache: dict, locks: dict):
    """排程到達 start_time 時由 APScheduler date job 精確觸發。"""
    rows = await asyncio.to_thread(_confirmed_schedules_db, schedule_id)
    if rows:
        await try_start_schedule(*rows[0], cache, locks)


async def auto_advance_schedules(cache: dict = None, locks: dict = None):
    """Fallback：每 5 分鐘掃一次，補抓任何漏掉的已確認排程（如重啟後 date job 遺失、設備當時忙碌）。"""
    if cache is None or locks is None:
        return

    rows = await asyncio.to_thread(_confirmed_schedules_db)
    if not rows:
        return

    results = await asyncio.gather(
        *(try_start_schedule(sid, dev, conds, cache, locks) for sid, dev, conds in rows)
    )
    started = sum(results)
    if started:
        logger.info(f"[scheduler] fallback 推進：{started}/{len(rows)} 筆→進行中")
