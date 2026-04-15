"""
排程系統 API
"""
import asyncio
import datetime
import json
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from .models import SessionLocal, Schedule, ScheduleStatus, DeviceBlockedPeriod, User, ScheduleFixture, Fixture, FixtureLoan
from .standards import STANDARD_TREE, get_standard
from .sop import DEVICE_IDS
from .auth import _require_admin
from .line import push_message
from .utils import _now_utc, _save_device_state, _parse_conditions

router = APIRouter(prefix="/api/schedules", tags=["schedules"])
blocked_router = APIRouter(prefix="/api/device-blocked-periods", tags=["schedules"])


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

INTER_CONDITION_BUFFER_HOURS = 0.5  # 條件間設備穩定緩衝（30 分鐘）


# ── Pydantic Schemas ────────────────────────────────────────────────────────


class FixtureItem(BaseModel):
    fixture_id: int
    quantity: int = 1


class ScheduleCreate(BaseModel):
    project_number: str
    sample_name: str
    standard: str
    conditions: List[str]  # sop_id list
    note: Optional[str] = None
    applicant_name: Optional[str] = None
    fixtures: List[FixtureItem] = []


class SchedulePatch(BaseModel):
    status: Optional[str] = None
    device_id: Optional[str] = None
    start_time: Optional[datetime.datetime] = None
    end_time: Optional[datetime.datetime] = None
    note: Optional[str] = None
    rejection_note: Optional[str] = None


class ScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_number: str
    sample_name: str
    applicant_name: Optional[str]
    applicant_user_id: Optional[int]
    device_id: Optional[str]
    standard: str
    conditions: List[str]
    start_time: Optional[datetime.datetime]
    end_time: Optional[datetime.datetime]
    status: str
    current_condition_index: int = 0
    note: Optional[str]
    created_by: Optional[int]
    confirmed_by: Optional[int]
    created_at: datetime.datetime
    updated_at: datetime.datetime
    total_hours: Optional[float] = None
    condition_names: Optional[List[str]] = None


class BlockedPeriodCreate(BaseModel):
    device_id: str
    start_time: datetime.datetime
    end_time: datetime.datetime
    reason: Optional[str] = None


class BlockedPeriodPatch(BaseModel):
    device_id: Optional[str] = None
    start_time: Optional[datetime.datetime] = None
    end_time: Optional[datetime.datetime] = None
    reason: Optional[str] = None


class BlockedPeriodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    start_time: datetime.datetime
    end_time: datetime.datetime
    reason: Optional[str]
    created_by: Optional[int]
    created_at: datetime.datetime


# ── 時長計算工具 ────────────────────────────────────────────────────────────


STABILIZATION_HOURS = 0.5  # 每個條件前 30min 常溫穩定時間（ISO 17025）


def _calc_condition_hours(sop_id: str) -> float:
    """計算單一測試條件的完整時長（含回常溫 + 30min 常溫穩定），單位：小時"""
    std = get_standard(sop_id)
    if not std:
        return 1.0

    ramp_rate = float(std.get("ramp_rate", 1.0))  # °C/min
    dwell_hours = float(std.get("dwell_time_hours", 1.0))
    dwell_min = dwell_hours * 60.0
    cycles = int(std.get("cycles", 1))
    high_temp = float(std.get("high_temperature") or std.get("target_temperature") or 25.0)
    low_temp = std.get("low_temperature")
    ambient = 25.0

    if ramp_rate <= 0:
        ramp_rate = 1.0

    if low_temp is not None and float(low_temp) < ambient:
        low_temp = float(low_temp)
        ramp_ambient_to_low = abs(ambient - low_temp) / ramp_rate
        ramp_low_to_high = abs(high_temp - low_temp) / ramp_rate
        if ramp_low_to_high < 0.01:
            # 單點冷測（Ab/Ad）：降溫 + 停留 + 升溫
            total_min = ramp_ambient_to_low + dwell_min * cycles + ramp_ambient_to_low
        else:
            # 溫度循環（Nb/Na）：低↔高各有停留
            one_cycle_min = ramp_low_to_high + dwell_min + ramp_low_to_high + dwell_min
            total_min = ramp_ambient_to_low + one_cycle_min * cycles + ramp_ambient_to_low
    elif low_temp is not None:
        low_temp = float(low_temp)
        ramp_up = abs(high_temp - ambient) / ramp_rate
        ramp_hl = abs(high_temp - low_temp) / ramp_rate
        ramp_down = abs(low_temp - ambient) / ramp_rate
        full_cycle = dwell_min * 2 + ramp_hl * 2
        last_cycle = dwell_min * 2 + ramp_hl
        total_min = ramp_up + full_cycle * (cycles - 1) + last_cycle + ramp_down
    else:
        ramp_up = abs(high_temp - ambient) / ramp_rate
        total_min = ramp_up + dwell_min + ramp_up

    return total_min / 60.0 + STABILIZATION_HOURS


def _calc_total_hours(conditions: List[str]) -> float:
    """計算所有條件的總時長（含條件間 30 分鐘緩衝）"""
    if not conditions:
        return 0.0
    total = sum(_calc_condition_hours(c) for c in conditions)
    total += INTER_CONDITION_BUFFER_HOURS * (len(conditions) - 1)
    return round(total, 2)


def _est_end_from_device(device: dict) -> Optional[datetime.datetime]:
    """從 AICM_CACHE 設備 dict 估算測試結束時間（UTC）；設備不在執行中則回傳 None"""
    if device.get("status") not in ("RUNNING", "PAUSED", "FINISHING"):
        return None

    # 優先使用 devices.py 已算好的 estimated_end_at（含常溫穩定時間）
    cached_end = device.get("estimated_end_at")
    if cached_end:
        try:
            if isinstance(cached_end, str):
                dt = datetime.datetime.fromisoformat(cached_end.replace("Z", "+00:00"))
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
    dwell_min = float(sop.get("dwell_time_hours") or 0.0) * 60.0
    cycles = int(sop.get("cycles") or 1)
    high_temp = float(sop.get("high_temperature") or sop.get("target_temperature") or 25.0)
    low_temp = sop.get("low_temperature")
    ambient = 25.0
    if ramp_rate <= 0:
        ramp_rate = 1.0

    if low_temp is not None and float(low_temp) < ambient:
        low_temp = float(low_temp)
        r_lo = abs(ambient - low_temp) / ramp_rate
        r_hl = abs(high_temp - low_temp) / ramp_rate
        if r_hl < 0.01:
            total_min = r_lo + dwell_min * cycles + r_lo
        else:
            total_min = r_lo + (r_hl + dwell_min + r_hl + dwell_min) * cycles + r_lo
    elif low_temp is not None:
        low_temp = float(low_temp)
        r_up = abs(high_temp - ambient) / ramp_rate
        r_hl = abs(high_temp - low_temp) / ramp_rate
        r_dn = abs(low_temp - ambient) / ramp_rate
        total_min = r_up + (dwell_min * 2 + r_hl * 2) * (cycles - 1) + (dwell_min * 2 + r_hl) + r_dn
    else:
        r_up = abs(high_temp - ambient) / ramp_rate
        total_min = r_up + dwell_min + r_up

    if isinstance(started_at, str):
        started_dt = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
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
    now = datetime.datetime.now(datetime.timezone.utc)
    return {
        did for did, dev in cache.items()
        if (est := _est_end_from_device(dev)) and (now - est).total_seconds() > 3600
    }


def _get_emergency_devices(cache: dict) -> set:
    """回傳狀態為 EMERGENCY 的設備 ID（不可排程）"""
    return {did for did, dev in cache.items() if dev.get("status") == "EMERGENCY"}


def _get_condition_names(conditions: List[str]) -> List[str]:
    """取得每個 sop_id 的顯示名稱"""
    names = []
    for sop_id in conditions:
        std = get_standard(sop_id)
        names.append(std.get("name", sop_id) if std else sop_id)
    return names


def _get_schedule_fixtures(schedule_id: int, db) -> list:
    """查詢排程治具清單，一次批次載入 Fixture 資料（避免 N+1）"""
    sfs = db.query(ScheduleFixture).filter(ScheduleFixture.schedule_id == schedule_id).all()
    if not sfs:
        return []
    fixture_map = {
        f.id: f
        for f in db.query(Fixture).filter(Fixture.id.in_([sf.fixture_id for sf in sfs])).all()
    }
    return [
        {
            "fixture_id": sf.fixture_id,
            "quantity": sf.quantity,
            "interface_type": fixture_map[sf.fixture_id].interface_type if sf.fixture_id in fixture_map else "",
            "form_factor": fixture_map[sf.fixture_id].form_factor if sf.fixture_id in fixture_map else "",
        }
        for sf in sfs
    ]


def _enrich(s: Schedule, db=None) -> dict:
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
        "fixtures": _get_schedule_fixtures(s.id, db) if db is not None else [],
    }


# ── 自動排程邏輯 ────────────────────────────────────────────────────────────


def _find_earliest_slot(
    device_id: str,
    total_hours: float,
    db,
    running_until: Optional[dict] = None,
) -> datetime.datetime:
    """找出指定設備的最早可用開始時間（aware UTC）"""
    now = datetime.datetime.now(datetime.timezone.utc)

    # 先以設備當前實際執行預估結束時間為下限
    candidate_start = now
    if running_until and device_id in running_until:
        live_end = running_until[device_id]
        if live_end and live_end > candidate_start:
            candidate_start = live_end

    # 再找 DB 已確認/進行中排程的最晚結束時間
    existing = (
        db.query(Schedule)
        .filter(
            Schedule.device_id == device_id,
            Schedule.status.in_([ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]),
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

    # 貪婪迴避不可用時段
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
    stuck_devices: Optional[set] = None,
    emergency_devices: Optional[set] = None,
) -> tuple[str, datetime.datetime, datetime.datetime]:
    """自動選最早可用設備，回傳 (device_id, start_time, end_time)。
    emergency_devices / stuck_devices 內的設備跳過；若所有設備皆排除則退回全選。"""
    total_hours = _calc_total_hours(conditions)
    best_device = None
    best_start = None

    candidates = [d for d in DEVICE_IDS
                  if (not stuck_devices or d not in stuck_devices)
                  and (not emergency_devices or d not in emergency_devices)]
    if not candidates:
        candidates = DEVICE_IDS  # 所有設備都被排除時退回全選

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
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    with SessionLocal() as db:
        s = db.query(Schedule).filter(
            Schedule.id == schedule_id,
            Schedule.status == ScheduleStatus.CONFIRMED,
        ).first()
        if not s:
            return
        s.status = ScheduleStatus.RUNNING
        s.updated_at = now
        db.commit()
        conditions = json.loads(s.conditions) if s.conditions else []
        device_id = s.device_id

    if conditions and device_id:
        await auto_start_sop(device_id, conditions[0], cache, locks)


async def auto_advance_schedules(cache: dict = None, locks: dict = None):
    """
    Fallback：每 5 分鐘掃一次，補抓任何漏掉的已確認排程（如重啟後 date job 遺失）。
    """
    from .sop import auto_start_sop
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
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

        # 在 session 內提取需要的資料，避免 session 關閉後存取 ORM 物件
        start_info = []
        for s in to_running:
            conditions = json.loads(s.conditions) if s.conditions else []
            if conditions and s.device_id:
                start_info.append((s.device_id, conditions[0]))

    if cache is not None and locks is not None and start_info:
        tasks = [auto_start_sop(dev, cond, cache, locks) for dev, cond in start_info]
        if tasks:
            await asyncio.gather(*tasks)



# ── Schedules 端點 ─────────────────────────────────────────────────────────


@router.get("/preview")
def preview_schedule(request: Request, conditions: str, device_id: Optional[str] = None):
    """預覽排程時間（不寫入 DB）。conditions 為逗號分隔的 sop_id 清單。"""
    cond_list = [c.strip() for c in conditions.split(",") if c.strip()]
    if not cond_list:
        raise HTTPException(status_code=400, detail="至少需要一個測試條件")

    total_hours = _calc_total_hours(cond_list)
    cache = getattr(request.app.state, "AICM_CACHE", {})
    running_until = _build_running_until(cache)
    stuck_devices = _get_stuck_devices(cache)
    emergency_devices = _get_emergency_devices(cache)

    with SessionLocal() as db:
        if device_id and device_id in DEVICE_IDS:
            start = _find_earliest_slot(device_id, total_hours, db, running_until)
            assigned_device = device_id
        else:
            assigned_device, start, _ = _auto_assign(cond_list, db, running_until, stuck_devices, emergency_devices)

    end = start + datetime.timedelta(hours=total_hours)
    return {
        "device_id": assigned_device,
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
        "total_hours": round(total_hours, 2),
    }


@router.get("/standards-tree")
def get_standards_tree():
    """回傳三層標準樹供前端條件選擇器使用"""
    result = {}
    for std_key, std_data in STANDARD_TREE.items():
        result[std_key] = {
            "label": std_key,
            "versions": {}
        }
        for ver_key, ver_data in std_data["versions"].items():
            result[std_key]["versions"][ver_key] = {
                "label": ver_key,
                "tests": {}
            }
            for test_key, test_data in ver_data["tests"].items():
                result[std_key]["versions"][ver_key]["tests"][test_key] = {
                    "sop_id": test_data["sop_id"],
                    "name": test_data["name"],
                    "high_temperature": test_data.get("high_temperature"),
                    "low_temperature": test_data.get("low_temperature"),
                    "dwell_time_hours": test_data.get("dwell_time_hours"),
                    "cycles": test_data.get("cycles", 1),
                    "ramp_rate": test_data.get("ramp_rate", 1.0),
                    "estimated_hours": round(_calc_condition_hours(test_data["sop_id"]), 1),
                }
    return result


@router.get("/gantt")
def get_gantt(request: Request):
    """甘特圖資料：排程 + 不可用時段 + 設備即時狀態"""
    cache = getattr(request.app.state, "AICM_CACHE", {})
    with SessionLocal() as db:
        schedules = (
            db.query(Schedule)
            .order_by(Schedule.start_time)
            .all()
        )
        blocked = db.query(DeviceBlockedPeriod).all()

        return {
            "schedules": [_enrich(s, db) for s in schedules],
            "blocked_periods": [
                {
                    "id": b.id,
                    "device_id": b.device_id,
                    "start_time": b.start_time,
                    "end_time": b.end_time,
                    "reason": b.reason,
                }
                for b in blocked
            ],
            "devices": DEVICE_IDS,
            "device_statuses": {did: cache[did].get("status", "OFFLINE") for did in DEVICE_IDS if did in cache},
        }


@router.get("")
def list_schedules(request: Request, status: Optional[str] = None):
    """排程清單（可依 status 篩選）"""
    with SessionLocal() as db:
        q = db.query(Schedule)
        if status:
            q = q.filter(Schedule.status == status)
        schedules = q.order_by(Schedule.created_at.desc()).limit(200).all()
        return [_enrich(s, db) for s in schedules]


@router.get("/{schedule_id}")
def get_schedule(schedule_id: int):
    with SessionLocal() as db:
        s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="找不到排程")
        return _enrich(s, db)


@router.post("")
def create_schedule(body: ScheduleCreate, request: Request):
    """提交新排程申請（admin）"""
    _require_admin(request)

    if not body.conditions:
        raise HTTPException(status_code=400, detail="至少選擇一個測試條件")

    # 驗證所有 sop_id 存在
    for sop_id in body.conditions:
        if not get_standard(sop_id):
            raise HTTPException(status_code=400, detail=f"無效的測試條件：{sop_id}")

    user_id = getattr(request.state, "user_id", None)
    applicant_name = body.applicant_name

    # 從 DB 取 display_name（若未提供）
    if not applicant_name and user_id:
        with SessionLocal() as db:
            u = db.query(User).filter(User.id == user_id).first()
            if u:
                applicant_name = u.display_name

    with SessionLocal() as db:
        s = Schedule(
            project_number=body.project_number,
            sample_name=body.sample_name,
            applicant_name=applicant_name,
            applicant_user_id=user_id,
            standard=body.standard,
            conditions=json.dumps(body.conditions, ensure_ascii=False),
            status=ScheduleStatus.PENDING,
            note=body.note,
            created_by=user_id,
        )
        db.add(s)
        db.flush()
        for fi in body.fixtures:
            db.add(ScheduleFixture(
                schedule_id=s.id,
                fixture_id=fi.fixture_id,
                quantity=fi.quantity,
            ))
        db.commit()
        db.refresh(s)
        return _enrich(s, db)


@router.patch("/{schedule_id}")
async def patch_schedule(schedule_id: int, body: SchedulePatch, request: Request):
    """
    更新排程（admin only）。
    status=已確認 時若無指定設備，自動排程。
    """
    role = getattr(request.state, "user_role", None)
    user_id = getattr(request.state, "user_id", None)

    # 非 admin 只允許取消自己的待審核排程
    if role != "admin":
        if body.status != ScheduleStatus.CANCELLED:
            raise HTTPException(status_code=403, detail="僅管理者可審核排程")
        # 後續在讀取 schedule 後再驗證擁有權，這裡先通過

    cancelled_device_id = None  # 取消排程時若設備正在跑，記錄 device_id 供後面停止

    with SessionLocal() as db:
        s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="找不到排程")

        # 非 admin 取消：只能取消自己的待審核排程
        if role != "admin":
            if s.applicant_user_id != user_id:
                raise HTTPException(status_code=403, detail="只能取消自己的排程")
            if s.status != ScheduleStatus.PENDING:
                raise HTTPException(status_code=400, detail="只能取消待審核的排程")

        applicant_user_id = s.applicant_user_id
        project_label = f"{s.project_number} / {s.sample_name}"

        if body.note is not None:
            s.note = body.note
        if body.rejection_note is not None:
            s.rejection_note = body.rejection_note

        if body.status == ScheduleStatus.CONFIRMED:
            if s.status != ScheduleStatus.PENDING:
                raise HTTPException(status_code=409, detail=f"排程已是「{s.status}」，無法重複確認")
            conditions = _parse_conditions(s.conditions)
            cache = getattr(request.app.state, "AICM_CACHE", {})
            running_until = _build_running_until(cache)
            stuck_devices = _get_stuck_devices(cache)
            emergency_devices = _get_emergency_devices(cache)
            # 若管理人指定設備 + 手動時間 → 直接套用；只指定設備 → 自動算時間；否則全自動
            if body.device_id and body.start_time and body.end_time:
                device_id = body.device_id
                start = body.start_time
                end = body.end_time
            elif body.device_id:
                device_id = body.device_id
                total_hours = _calc_total_hours(conditions)
                start = _find_earliest_slot(device_id, total_hours, db, running_until)
                end = start + datetime.timedelta(hours=total_hours)
            else:
                device_id, start, end = _auto_assign(conditions, db, running_until, stuck_devices, emergency_devices)

            s.device_id = device_id
            s.start_time = start
            s.end_time = end
            s.confirmed_by = user_id

            # 若 start_time ≤ now 代表立即啟動，直接存為進行中；否則存為已確認等 date job
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            start_aware = start if start.tzinfo else start.replace(tzinfo=datetime.timezone.utc)
            immediate_start = start_aware <= now_utc
            s.status = ScheduleStatus.RUNNING if immediate_start else ScheduleStatus.CONFIRMED
            fixture_status = "loaned" if immediate_start else "reserved"
            fixture_loan_date = now_utc if immediate_start else None
            for sf in db.query(ScheduleFixture).filter(ScheduleFixture.schedule_id == s.id).all():
                db.add(FixtureLoan(
                    fixture_id=sf.fixture_id,
                    borrower_name=s.applicant_name or "排程系統",
                    borrower_user_id=s.applicant_user_id,
                    device_id=device_id,
                    project_name=f"{s.project_number} / {s.sample_name}",
                    quantity=sf.quantity,
                    due_date=end,
                    status=fixture_status,
                    loan_date=fixture_loan_date,
                    schedule_id=s.id,
                ))

            def _fmt(dt):
                if dt is None:
                    return "—"
                if dt.tzinfo:
                    dt = dt.astimezone(datetime.timezone(datetime.timedelta(hours=8)))
                return dt.strftime("%m/%d %H:%M")

        elif body.status in (ScheduleStatus.CANCELLED, ScheduleStatus.RUNNING, ScheduleStatus.DONE):
            original_status = s.status  # 保存改變前的狀態
            s.status = body.status
            if body.device_id:
                s.device_id = body.device_id
            if body.start_time:
                s.start_time = body.start_time
            if body.end_time:
                s.end_time = body.end_time

            if body.status == ScheduleStatus.CANCELLED:
                # 清除此排程的 reserved 治具預約
                db.query(FixtureLoan).filter(
                    FixtureLoan.schedule_id == schedule_id,
                    FixtureLoan.status == "reserved",
                ).delete(synchronize_session=False)
                # 若排程已在執行中（CONFIRMED/RUNNING），記錄 device_id 供後面停止設備
                if original_status in (ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING) and s.device_id:
                    cancelled_device_id = s.device_id

        else:
            # 純欄位更新（不改狀態）
            if body.device_id is not None:
                s.device_id = body.device_id
            if body.start_time is not None:
                s.start_time = body.start_time
            if body.end_time is not None:
                s.end_time = body.end_time

        s.updated_at = datetime.datetime.now(datetime.timezone.utc)
        db.commit()
        db.refresh(s)
        result = _enrich(s, db)

    _cache = getattr(request.app.state, "AICM_CACHE", {})
    _locks = getattr(request.app.state, "DEVICE_LOCKS", {})
    _scheduler = getattr(request.app.state, "scheduler", None)

    if body.status == ScheduleStatus.CONFIRMED:
        if immediate_start and conditions and device_id:
            # 立即啟動：狀態已在 DB session 中存為 RUNNING，直接啟動 SOP
            from .sop import auto_start_sop
            await auto_start_sop(device_id, conditions[0], _cache, _locks, skip_fixture_transfer=True)
        elif _scheduler and not immediate_start:
            # 未來時間：加精確 date job
            _scheduler.add_job(
                _start_schedule_by_id,
                trigger="date",
                run_date=start_aware,
                kwargs={"schedule_id": schedule_id, "cache": _cache, "locks": _locks},
                id=f"sched_{schedule_id}",
                replace_existing=True,
            )

    elif body.status == ScheduleStatus.CANCELLED:
        if _scheduler:
            try:
                _scheduler.remove_job(f"sched_{schedule_id}")
            except Exception:
                pass
        # 若設備正在執行此排程，改為正常收尾
        if cancelled_device_id:
            await _force_normal_stop(cancelled_device_id, _cache, _locks)

    return result


@router.delete("/{schedule_id}")
async def delete_schedule(schedule_id: int, request: Request):
    _require_admin(request)
    _cache = getattr(request.app.state, "AICM_CACHE", {})
    _locks = getattr(request.app.state, "DEVICE_LOCKS", {})
    _scheduler = getattr(request.app.state, "scheduler", None)

    with SessionLocal() as db:
        s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="找不到排程")
        stop_device_id = s.device_id if s.status in (ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING) else None
        db.query(ScheduleFixture).filter(ScheduleFixture.schedule_id == schedule_id).delete(synchronize_session=False)
        db.query(FixtureLoan).filter(FixtureLoan.schedule_id == schedule_id).delete(synchronize_session=False)
        db.delete(s)
        db.commit()

    if _scheduler:
        try:
            _scheduler.remove_job(f"sched_{schedule_id}")
        except Exception:
            pass
    if stop_device_id:
        await _force_normal_stop(stop_device_id, _cache, _locks)

    return {"ok": True}


# ── 條件確認端點 ──────────────────────────────────────────────────────────────


@router.post("/{schedule_id}/confirm-condition")
async def confirm_condition(schedule_id: int, request: Request):
    from .sop import auto_start_sop
    _require_admin(request)
    cache = getattr(request.app.state, "AICM_CACHE", {})
    locks = getattr(request.app.state, "DEVICE_LOCKS", {})
    now = _now_utc()

    with SessionLocal() as db:
        schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not schedule:
            raise HTTPException(status_code=404, detail="找不到排程")
        if schedule.status not in (ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING):
            raise HTTPException(status_code=400, detail="排程不在進行中狀態")

        conditions = json.loads(schedule.conditions) if schedule.conditions else []
        idx = schedule.current_condition_index

        if idx < len(conditions):
            next_sop_id = conditions[idx]
            proj, sample, dev = schedule.project_number, schedule.sample_name, schedule.device_id
        else:
            _complete_schedule(db, schedule, now)
            db.commit()
            asyncio.create_task(push_message(
                f"✅ 測試完成\n專案：{schedule.project_number} / {schedule.sample_name}\n設備：{schedule.device_id}"
            ))
            return {"status": "completed"}

    asyncio.create_task(auto_start_sop(dev, next_sop_id, cache, locks, skip_fixture_transfer=True))
    return {"status": "started", "sop_id": next_sop_id}


@router.post("/{schedule_id}/start")
async def start_schedule(schedule_id: int, request: Request):
    """手動立即啟動「已確認」排程（補救 APScheduler 漏掉的情況）。"""
    from .sop import auto_start_sop
    _require_admin(request)
    cache = getattr(request.app.state, "AICM_CACHE", {})
    locks = getattr(request.app.state, "DEVICE_LOCKS", {})
    now = _now_utc()

    with SessionLocal() as db:
        s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="找不到排程")
        if s.status != ScheduleStatus.CONFIRMED:
            raise HTTPException(status_code=400, detail="只有「已確認」狀態的排程才能手動啟動")
        s.status = ScheduleStatus.RUNNING
        s.updated_at = now
        db.commit()
        conditions = _parse_conditions(s.conditions)
        device_id = s.device_id

    sop_id = conditions[0] if conditions else None
    if sop_id and device_id:
        asyncio.create_task(auto_start_sop(device_id, sop_id, cache, locks))
    return {"status": "started", "device_id": device_id, "sop_id": sop_id}


# ── Device Blocked Periods 端點 ────────────────────────────────────────────


@blocked_router.get("")
def list_blocked_periods():
    with SessionLocal() as db:
        items = db.query(DeviceBlockedPeriod).order_by(DeviceBlockedPeriod.start_time).all()
        return [
            {
                "id": b.id,
                "device_id": b.device_id,
                "start_time": b.start_time,
                "end_time": b.end_time,
                "reason": b.reason,
                "created_by": b.created_by,
                "created_at": b.created_at,
            }
            for b in items
        ]


@blocked_router.post("")
def create_blocked_period(body: BlockedPeriodCreate, request: Request):
    _require_admin(request)

    if body.end_time <= body.start_time:
        raise HTTPException(status_code=400, detail="結束時間必須晚於開始時間")

    if body.device_id not in DEVICE_IDS:
        raise HTTPException(status_code=400, detail=f"無效的設備 ID：{body.device_id}")

    user_id = getattr(request.state, "user_id", None)
    with SessionLocal() as db:
        b = DeviceBlockedPeriod(
            device_id=body.device_id,
            start_time=body.start_time,
            end_time=body.end_time,
            reason=body.reason,
            created_by=user_id,
        )
        db.add(b)
        db.commit()
        db.refresh(b)
        return {
            "id": b.id,
            "device_id": b.device_id,
            "start_time": b.start_time,
            "end_time": b.end_time,
            "reason": b.reason,
        }


@blocked_router.patch("/{period_id}")
def update_blocked_period(period_id: int, body: BlockedPeriodPatch, request: Request):
    _require_admin(request)

    with SessionLocal() as db:
        b = db.query(DeviceBlockedPeriod).filter(DeviceBlockedPeriod.id == period_id).first()
        if not b:
            raise HTTPException(status_code=404, detail="找不到紀錄")
        if body.device_id is not None:
            if body.device_id not in DEVICE_IDS:
                raise HTTPException(status_code=400, detail=f"無效的設備 ID：{body.device_id}")
            b.device_id = body.device_id
        if body.start_time is not None:
            b.start_time = body.start_time
        if body.end_time is not None:
            b.end_time = body.end_time
        if body.reason is not None:
            b.reason = body.reason
        if b.end_time <= b.start_time:
            raise HTTPException(status_code=400, detail="結束時間必須晚於開始時間")
        db.commit()
        db.refresh(b)
        return {"id": b.id, "device_id": b.device_id, "start_time": b.start_time, "end_time": b.end_time, "reason": b.reason}


@blocked_router.delete("/{period_id}")
def delete_blocked_period(period_id: int, request: Request):
    _require_admin(request)

    with SessionLocal() as db:
        b = db.query(DeviceBlockedPeriod).filter(DeviceBlockedPeriod.id == period_id).first()
        if not b:
            raise HTTPException(status_code=404, detail="找不到紀錄")
        db.delete(b)
        db.commit()
    return {"ok": True}
