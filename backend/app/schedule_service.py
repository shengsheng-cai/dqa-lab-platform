"""
排程業務邏輯層（service layer）

從 schedules.py 拆出的私有函式，供 schedules.py routes、main.py APScheduler、
simulator.py 共同使用。所有函式均不依賴 FastAPI context，可直接 pytest 測試。
"""
import asyncio
import datetime
import json
import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Optional, List

from .models import (
    SessionLocal, Schedule, ScheduleStatus, DeviceBlockedPeriod,
    ScheduleFixture, Fixture, FixtureLoan,
)
from .standards import get_standard
from .constants import DEVICE_IDS
from .utils import (
    _now_utc, _now_utc_naive, _parse_conditions,
    parse_iso_utc, _to_naive_utc, device_blocked_reason_now,
)
from . import device_state
from .audit_log import log_audit

logger = logging.getLogger("schedule_service")

INTER_CONDITION_BUFFER_HOURS = 0.5
ACTIVE_STATUSES = [ScheduleStatus.PENDING, ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]
STABILIZATION_HOURS = 0.5


class ScheduleStartCode(StrEnum):
    STARTED = "started"
    DEVICE_BUSY = "device_busy"
    UNDER_MAINTENANCE = "under_maintenance"
    BROKEN = "broken"
    NOT_FOUND = "not_found"
    NOT_STARTABLE = "not_startable"
    RETRYABLE_FAILURE = "retryable_failure"


@dataclass(frozen=True)
class ScheduleStartActor:
    actor: str
    role: Optional[str] = None
    action: str = "AUTO_START"
    operator: str = "排程系統"
    operator_user_id: Optional[int] = None


SYSTEM_SCHEDULE_ACTOR = ScheduleStartActor(actor="system:scheduler")


@dataclass(frozen=True)
class ScheduleStartResult:
    code: ScheduleStartCode
    schedule_id: int
    device_id: Optional[str] = None
    sop_id: Optional[str] = None
    detail: Optional[str] = None

    @property
    def started(self) -> bool:
        return self.code == ScheduleStartCode.STARTED


@dataclass(frozen=True)
class _ScheduleStartPlan:
    schedule_id: int
    device_id: str
    sop_id: str
    condition_index: int
    expected_status: str
    std_data: dict


class _ScheduleStartRejected(Exception):
    def __init__(self, code: ScheduleStartCode, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


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
    """排程標為已完成並釋放全部治具占用（不 commit，由呼叫方負責）。"""
    schedule.status = ScheduleStatus.DONE
    schedule.updated_at = now
    _release_schedule_fixtures(db, schedule.id, now, return_loaned=True)


def _release_schedule_fixtures(
    db, schedule_id: int, now: datetime.datetime, *, return_loaned: bool = False,
) -> None:
    """排程走到完成／取消／異常時釋放它占用的治具（不 commit，由呼叫方負責）。

    終止路徑若各寫各的，漏掉一邊就會讓治具永遠卡住、可借量收不回來。收成同一支
    避免日後再漂：還沒真正借出的「預約」一律刪掉；return_loaned=True 時，連已經借出的
    也一併歸還。
    """
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == schedule_id,
        FixtureLoan.status == "reserved",
    ).delete(synchronize_session=False)
    if return_loaned:
        _return_loaned_fixtures(db, schedule_id, now)


# ── 排程推進（設備完成一個條件時，唯一的推進入口）─────────────────────────────


@dataclass(frozen=True)
class ConditionAdvance:
    """設備自然完成一個條件後的結果；僅推進索引，排程續為進行中，等人員確認下一步。"""
    schedule_id: int
    new_index: int
    total: int
    project_number: str
    sample_name: str


@dataclass(frozen=True)
class ScheduleCompletion:
    """設備手動收尾後、排程被標為已完成的結果（治具已在同一 transaction 歸還）。"""
    schedule_id: int
    device_id: str
    project_number: str
    sample_name: str


def _running_schedule_for_device(db, device_id: str) -> Optional[Schedule]:
    """該設備目前進行中的排程。同機台理論上只有一筆 RUNNING，order_by 讓選取具決定性；
    因為只挑 RUNNING，同機台未來的已確認排程（CONFIRMED）永遠不會被誤選。"""
    return (
        db.query(Schedule)
        .filter(
            Schedule.device_id == device_id,
            Schedule.status == ScheduleStatus.RUNNING,
        )
        .order_by(Schedule.start_time.asc(), Schedule.id.asc())
        .first()
    )


def advance_running_condition(device_id: str) -> Optional[ConditionAdvance]:
    """設備自然完成目前條件：current_condition_index +1，等待人員確認下一步。

    只推進索引，不完成排程、不歸還治具——最後一條也一樣，要由人員在排程頁面確認後
    才走完成。無進行中排程時回 None（例如臨時 SOP，不得誤動同機台未來排程）。
    """
    with SessionLocal() as db:
        schedule = _running_schedule_for_device(db, device_id)
        if schedule is None:
            return None
        new_index = schedule.current_condition_index + 1
        result = ConditionAdvance(
            schedule_id=schedule.id,
            new_index=new_index,
            total=len(_parse_conditions(schedule.conditions)),
            project_number=schedule.project_number,
            sample_name=schedule.sample_name,
        )
        schedule.current_condition_index = new_index
        db.commit()
        return result


def complete_running_schedule(
    device_id: str, now: datetime.datetime
) -> Optional[ScheduleCompletion]:
    """設備手動收尾：把進行中排程標為已完成並歸還治具（同一 transaction）。

    無進行中排程時回 None（臨時 SOP 收尾，不得把同機台未來排程直接標成已完成）。
    """
    with SessionLocal() as db:
        schedule = _running_schedule_for_device(db, device_id)
        if schedule is None:
            return None
        result = ScheduleCompletion(
            schedule_id=schedule.id,
            device_id=schedule.device_id,
            project_number=schedule.project_number,
            sample_name=schedule.sample_name,
        )
        _complete_schedule(db, schedule, now)
        db.commit()
        logger.info(f"[{device_id}] 排程 {result.schedule_id} 標為已完成")
        return result


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


async def _force_normal_stop(
    device_id: str,
    states: device_state.DeviceStateManager,
) -> None:
    """取消/刪除排程時，若設備正在執行，改為正常收尾（不觸發 LINE 推播或錯誤記錄）。"""
    await states.finish(device_id, cancelled=True, notify=False)


def _confirmed_schedule_ids_db() -> list[int]:
    """已到開始時間、待 fallback 啟動的排程 id。"""
    with SessionLocal() as db:
        rows = (
            db.query(Schedule.id)
            .filter(
                Schedule.status == ScheduleStatus.CONFIRMED,
                Schedule.start_time <= _now_utc_naive(),
            )
            .order_by(
                Schedule.start_time.asc(),
                Schedule.id.asc(),
            )
            .all()
        )
        return [schedule_id for (schedule_id,) in rows]


def _apply_schedule_error(
    db,
    schedule: Schedule,
    reason: str,
    actor: ScheduleStartActor,
) -> None:
    """在 caller 的 transaction 內把永久壞資料收斂為 ERROR。"""
    now = _now_utc_naive()
    schedule.status = ScheduleStatus.ERROR
    schedule.updated_at = now
    _release_schedule_fixtures(
        db,
        schedule.id,
        now,
        return_loaned=True,
    )
    log_audit(
        db,
        actor.actor,
        actor.role,
        "ERROR",
        "schedule",
        schedule.id,
        f"{schedule.project_number} / {schedule.sample_name}：{reason}",
    )


def _load_schedule_start_plan(
    schedule_id: int,
    *,
    continuation: bool,
    actor: ScheduleStartActor,
) -> _ScheduleStartPlan | ScheduleStartResult:
    """讀取不可變啟動計畫；永久壞資料在同一 transaction 直接收斂。"""
    expected_status = ScheduleStatus.RUNNING if continuation else ScheduleStatus.CONFIRMED
    with SessionLocal() as db:
        s = db.get(Schedule, schedule_id)
        if not s:
            return ScheduleStartResult(
                ScheduleStartCode.NOT_FOUND,
                schedule_id,
                detail="找不到排程",
            )
        if s.status != expected_status:
            return ScheduleStartResult(
                ScheduleStartCode.NOT_STARTABLE,
                schedule_id,
                device_id=s.device_id,
                detail=f"排程目前為「{s.status}」，不能從這個入口啟動",
            )

        def broken(detail: str, *, sop_id: str | None = None) -> ScheduleStartResult:
            result = ScheduleStartResult(
                ScheduleStartCode.BROKEN,
                schedule_id,
                device_id=s.device_id,
                sop_id=sop_id,
                detail=detail,
            )
            _apply_schedule_error(db, s, detail, actor)
            db.commit()
            return result

        conditions = _parse_conditions(s.conditions)
        condition_index = s.current_condition_index or 0
        if (
            not s.device_id
            or not isinstance(conditions, list)
            or not conditions
            or condition_index < 0
            or condition_index >= len(conditions)
        ):
            return broken("缺少測試條件或設備")

        sop_id = conditions[condition_index]
        if not isinstance(sop_id, str):
            return broken("測試條件格式錯誤")
        std_data = get_standard(sop_id)
        if not std_data:
            return broken(f"找不到測試條件 {sop_id}", sop_id=sop_id)

        return _ScheduleStartPlan(
            schedule_id=s.id,
            device_id=s.device_id,
            sop_id=sop_id,
            condition_index=condition_index,
            expected_status=expected_status,
            std_data=std_data,
        )


def _conditions_matching_plan(
    schedule: Schedule,
    plan: _ScheduleStartPlan,
) -> list | None:
    """回傳仍符合 optimistic plan 的條件；資料漂移時回 None。"""
    conditions = _parse_conditions(schedule.conditions)
    condition_index = schedule.current_condition_index or 0
    if (
        schedule.device_id != plan.device_id
        or not isinstance(conditions, list)
        or condition_index != plan.condition_index
        or condition_index < 0
        or condition_index >= len(conditions)
        or conditions[condition_index] != plan.sop_id
    ):
        return None
    return conditions


def _mark_schedule_error_db(
    plan: _ScheduleStartPlan,
    reason: str,
    actor: ScheduleStartActor = SYSTEM_SCHEDULE_ACTOR,
) -> bool:
    """依 optimistic plan 把永久無法啟動的排程轉「異常」並停止重試。

    不同於「設備忙碌」（暫時性），設備不存在等永久缺陷重試也不會好。
    CONFIRMED/RUNNING 皆可收斂為 ERROR、釋放治具，並寫 audit 供管理者追查。

    plan 是讀取當下的 optimistic snapshot；資料若已被管理員修正就不套用舊判定。
    """
    with SessionLocal() as db:
        s = db.query(Schedule).filter(
            Schedule.id == plan.schedule_id,
            Schedule.status == plan.expected_status,
        ).first()
        if not s:
            return False
        if _conditions_matching_plan(s, plan) is None:
            return False
        _apply_schedule_error(db, s, reason, actor)
        db.commit()
        return True


async def _settle_broken_schedule(
    result: ScheduleStartResult,
    actor: ScheduleStartActor,
    plan: _ScheduleStartPlan,
) -> ScheduleStartResult:
    """把永久壞資料收斂為 ERROR；收斂本身失敗時仍維持 typed result。"""
    try:
        settled = await asyncio.to_thread(
            _mark_schedule_error_db,
            plan,
            result.detail or "排程資料不完整",
            actor,
        )
    except Exception:
        logger.exception(
            "[scheduler] 排程 #%s 無法標記為異常",
            result.schedule_id,
        )
        return ScheduleStartResult(
            ScheduleStartCode.RETRYABLE_FAILURE,
            result.schedule_id,
            device_id=result.device_id,
            sop_id=result.sop_id,
            detail="排程資料異常，但目前無法完成錯誤收斂，請稍後重試",
        )
    if not settled:
        return ScheduleStartResult(
            ScheduleStartCode.NOT_STARTABLE,
            result.schedule_id,
            device_id=result.device_id,
            sop_id=result.sop_id,
            detail="排程資料已被其他操作變更，未套用舊的錯誤判定",
        )
    return result


def _apply_schedule_start(
    db,
    plan: _ScheduleStartPlan,
    actor: ScheduleStartActor,
) -> None:
    """在 DeviceStateManager.start 的 transaction 內推進排程、治具與 audit。"""
    now = _now_utc_naive()
    schedule = db.query(Schedule).filter(
        Schedule.id == plan.schedule_id,
        Schedule.status == plan.expected_status,
    ).first()
    if schedule is None:
        raise _ScheduleStartRejected(
            ScheduleStartCode.NOT_STARTABLE,
            "排程狀態已被其他操作變更",
        )

    conditions = _conditions_matching_plan(schedule, plan)
    if conditions is None:
        raise _ScheduleStartRejected(
            ScheduleStartCode.NOT_STARTABLE,
            "排程的設備或目前條件已被其他操作變更",
        )

    blocked = db.query(DeviceBlockedPeriod).filter(
        DeviceBlockedPeriod.device_id == plan.device_id,
        DeviceBlockedPeriod.start_time <= now,
        DeviceBlockedPeriod.end_time > now,
    ).first()
    if blocked is not None:
        reason = blocked.reason or "已設定封鎖"
        raise _ScheduleStartRejected(
            ScheduleStartCode.UNDER_MAINTENANCE,
            f"{plan.device_id} 在維護時段（{reason}）",
        )

    if plan.expected_status == ScheduleStatus.CONFIRMED:
        schedule.status = ScheduleStatus.RUNNING
        db.query(FixtureLoan).filter(
            FixtureLoan.schedule_id == plan.schedule_id,
            FixtureLoan.status == "reserved",
        ).update(
            {"status": "loaned", "loan_date": now},
            synchronize_session=False,
        )

    schedule.updated_at = now
    detail = (
        f"{schedule.project_number} / {schedule.sample_name}"
        f" · 條件 {plan.condition_index + 1}/{len(conditions)}"
    )
    log_audit(
        db,
        actor.actor,
        actor.role,
        actor.action,
        "schedule",
        schedule.id,
        detail,
    )


async def start_schedule(
    schedule_id: int,
    actor: ScheduleStartActor,
    states: device_state.DeviceStateManager,
    *,
    continuation: bool = False,
) -> ScheduleStartResult:
    """排程啟動的唯一入口；所有 caller 只提供 id、actor 與啟動模式。

    DeviceState、SopExecution、Schedule、FixtureLoan 與 AuditLog 在同一個
    transaction 寫入；commit 成功後才發布 cache。暫時性阻擋不改排程狀態。
    """
    from .sop import _start_device_sop

    try:
        plan_or_result = await asyncio.to_thread(
            _load_schedule_start_plan,
            schedule_id,
            continuation=continuation,
            actor=actor,
        )
    except Exception:
        logger.exception("[scheduler] 排程 #%s 啟動計畫讀取失敗", schedule_id)
        return ScheduleStartResult(
            ScheduleStartCode.RETRYABLE_FAILURE,
            schedule_id,
            detail="暫時無法讀取排程資料，請稍後重試",
        )
    if isinstance(plan_or_result, ScheduleStartResult):
        if plan_or_result.code == ScheduleStartCode.BROKEN:
            logger.warning(
                "[scheduler] 排程 #%s 無法啟動：%s，已轉「異常」",
                schedule_id,
                plan_or_result.detail,
            )
        return plan_or_result

    plan = plan_or_result
    try:
        blocked_reason = await asyncio.to_thread(
            device_blocked_reason_now,
            plan.device_id,
        )
    except Exception:
        logger.exception("[scheduler] 排程 #%s 維護狀態讀取失敗", schedule_id)
        return ScheduleStartResult(
            ScheduleStartCode.RETRYABLE_FAILURE,
            schedule_id,
            device_id=plan.device_id,
            sop_id=plan.sop_id,
            detail="暫時無法確認設備維護狀態，請稍後重試",
        )
    if blocked_reason is not None:
        return ScheduleStartResult(
            ScheduleStartCode.UNDER_MAINTENANCE,
            schedule_id,
            device_id=plan.device_id,
            sop_id=plan.sop_id,
            detail=f"{plan.device_id} 在維護時段（{blocked_reason}）",
        )

    device = states.get(plan.device_id)
    if device is None:
        detail = f"設備 {plan.device_id} 不存在"
        return await _settle_broken_schedule(
            ScheduleStartResult(
                ScheduleStartCode.BROKEN,
                schedule_id,
                device_id=plan.device_id,
                sop_id=plan.sop_id,
                detail=detail,
            ),
            actor,
            plan,
        )
    if device.get("status") != "IDLE":
        device_status = str(device.get("status", "未知"))
        return ScheduleStartResult(
            ScheduleStartCode.DEVICE_BUSY,
            schedule_id,
            device_id=plan.device_id,
            sop_id=plan.sop_id,
            detail=f"{plan.device_id} 目前為「{device_status}」，非待機狀態",
        )

    try:
        transition = await _start_device_sop(
            states,
            plan.device_id,
            plan.sop_id,
            plan.std_data.get("name", plan.sop_id),
            plan.std_data,
            actor.operator,
            actor.operator_user_id,
            before_commit=lambda db, _state: _apply_schedule_start(db, plan, actor),
        )
    except _ScheduleStartRejected as error:
        return ScheduleStartResult(
            error.code,
            schedule_id,
            device_id=plan.device_id,
            sop_id=plan.sop_id,
            detail=error.detail,
        )
    except Exception:
        logger.exception("[scheduler] 排程 #%s 啟動 transaction 失敗", schedule_id)
        return ScheduleStartResult(
            ScheduleStartCode.RETRYABLE_FAILURE,
            schedule_id,
            device_id=plan.device_id,
            sop_id=plan.sop_id,
            detail="啟動資料暫時無法寫入，請稍後重試",
        )

    if transition.reason == "invalid_status":
        device_status = str(transition.before.get("status", "未知"))
        return ScheduleStartResult(
            ScheduleStartCode.DEVICE_BUSY,
            schedule_id,
            device_id=plan.device_id,
            sop_id=plan.sop_id,
            detail=f"{plan.device_id} 目前為「{device_status}」，非待機狀態",
        )
    if transition.reason == "execution_failed":
        return ScheduleStartResult(
            ScheduleStartCode.RETRYABLE_FAILURE,
            schedule_id,
            device_id=plan.device_id,
            sop_id=plan.sop_id,
            detail="無法建立 SOP 執行紀錄，請稍後重試",
        )
    if not transition.changed:
        return ScheduleStartResult(
            ScheduleStartCode.RETRYABLE_FAILURE,
            schedule_id,
            device_id=plan.device_id,
            sop_id=plan.sop_id,
            detail=f"設備啟動被拒絕：{transition.reason}",
        )

    logger.info(
        "[scheduler] 排程 #%s 條件 %s 在 %s 啟動",
        schedule_id,
        plan.sop_id,
        plan.device_id,
    )
    return ScheduleStartResult(
        ScheduleStartCode.STARTED,
        schedule_id,
        device_id=plan.device_id,
        sop_id=plan.sop_id,
    )


async def _start_schedule_by_id(
    schedule_id: int,
    states: device_state.DeviceStateManager,
) -> ScheduleStartResult | None:
    """排程到達 start_time 時由 APScheduler date job 精確觸發。"""
    result = await start_schedule(schedule_id, SYSTEM_SCHEDULE_ACTOR, states)
    if result.code in {ScheduleStartCode.NOT_FOUND, ScheduleStartCode.NOT_STARTABLE}:
        return None
    return result


def _register_schedule_start_job(
    scheduler,
    schedule_id: int,
    states: device_state.DeviceStateManager,
    run_date: datetime.datetime,
) -> None:
    """以一致的 UTC date-job 規格註冊或更新排程啟動工作。"""
    run_date_utc = _to_naive_utc(run_date)
    assert run_date_utc is not None
    scheduler.add_job(
        _start_schedule_by_id,
        trigger="date",
        run_date=run_date_utc.replace(tzinfo=datetime.timezone.utc),
        kwargs={"schedule_id": schedule_id, "states": states},
        id=f"sched_{schedule_id}",
        replace_existing=True,
    )


async def auto_advance_schedules(
    states: device_state.DeviceStateManager | None = None,
) -> None:
    """Fallback：每 5 分鐘掃一次，補抓任何漏掉的已確認排程（如重啟後 date job 遺失、設備當時忙碌）。"""
    if states is None:
        return

    schedule_ids = await asyncio.to_thread(_confirmed_schedule_ids_db)
    if not schedule_ids:
        return

    # Query 已依 start_time/id 排序。同一設備若並行搶 lock，較晚排程反而可能先啟動；
    # fallback 頻率低且設備數有限，逐筆執行才能保證「最早到期者先」。
    results = []
    for schedule_id in schedule_ids:
        results.append(
            await start_schedule(schedule_id, SYSTEM_SCHEDULE_ACTOR, states)
        )
    started = sum(result.started for result in results)
    if started:
        logger.info(
            "[scheduler] fallback 推進：%s/%s 筆→進行中",
            started,
            len(schedule_ids),
        )
