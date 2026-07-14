"""
排程系統 API
"""
import asyncio
import datetime
import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from .models import (
    SessionLocal, Schedule, ScheduleStatus, DeviceBlockedPeriod,
    User, ScheduleFixture, FixtureLoan,
)
from .standards import STANDARD_TREE, get_standard
from .sop import DEVICE_IDS
from .auth import require_admin, current_user
from .line import push_message
from .utils import _now_utc, _now_utc_naive, _parse_conditions
from .audit import log_audit
from .schedule_service import (
    ACTIVE_STATUSES,
    _complete_schedule,
    _calc_condition_hours, _calc_total_hours,
    _build_running_until,
    _build_schedule_fixtures_map, _enrich,
    _find_earliest_slot, _auto_assign,
    _force_normal_stop, _start_schedule_by_id,
    find_overlapping_schedule, try_start_schedule,
)

logger = logging.getLogger("schedules")

router = APIRouter(prefix="/api/schedules", tags=["schedules"])
blocked_router = APIRouter(prefix="/api/device-blocked-periods", tags=["schedules"])



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


class ScheduleFixtureOut(BaseModel):
    fixture_id: int
    quantity: int
    interface_type: str
    form_factor: str


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
    status: ScheduleStatus
    current_condition_index: int = 0
    note: Optional[str]
    rejection_note: Optional[str] = None
    created_by: Optional[int]
    confirmed_by: Optional[int]
    created_at: datetime.datetime
    updated_at: datetime.datetime
    total_hours: Optional[float] = None
    condition_names: Optional[List[str]] = None
    fixtures: List[ScheduleFixtureOut] = []


class SchedulePreviewOut(BaseModel):
    device_id: Optional[str]
    start_time: str
    end_time: str
    total_hours: float


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



# ── Schedules 端點 ─────────────────────────────────────────────────────────


@router.get("/preview", response_model=SchedulePreviewOut)
def preview_schedule(request: Request, conditions: str, device_id: Optional[str] = None):
    """預覽排程時間（不寫入 DB）。conditions 為逗號分隔的 sop_id 清單。"""
    cond_list = [c.strip() for c in conditions.split(",") if c.strip()]
    if not cond_list:
        raise HTTPException(status_code=400, detail="至少需要一個測試條件")

    total_hours = _calc_total_hours(cond_list)
    cache = getattr(request.app.state, "AICM_CACHE", {})
    running_until = _build_running_until(cache)
    with SessionLocal() as db:
        if device_id and device_id in DEVICE_IDS:
            start = _find_earliest_slot(device_id, total_hours, db, running_until)
            assigned_device = device_id
        else:
            assigned_device, start, _ = _auto_assign(cond_list, db, running_until, cache)

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
        blocked = db.query(DeviceBlockedPeriod).limit(500).all()
        fixtures_map = _build_schedule_fixtures_map(db, [s.id for s in schedules])

        return {
            "schedules": [_enrich(s, db, fixtures_map) for s in schedules],
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


@router.get("", response_model=list[ScheduleOut])
def list_schedules(request: Request, status: Optional[str] = None):
    """排程清單（可依 status 篩選）"""
    with SessionLocal() as db:
        q = db.query(Schedule)
        if status:
            q = q.filter(Schedule.status == status)
        schedules = q.order_by(Schedule.created_at.desc()).limit(200).all()
        fixtures_map = _build_schedule_fixtures_map(db, [s.id for s in schedules])
        return [_enrich(s, db, fixtures_map) for s in schedules]


@router.get("/{schedule_id}", response_model=ScheduleOut)
def get_schedule(schedule_id: int):
    with SessionLocal() as db:
        s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="找不到排程")
        return _enrich(s, db)


@router.post("", response_model=ScheduleOut, status_code=201)
def create_schedule(body: ScheduleCreate, request: Request, _: None = Depends(require_admin)):
    """提交新排程申請（admin）"""

    if not body.conditions:
        raise HTTPException(status_code=400, detail="至少選擇一個測試條件")

    # 驗證所有 sop_id 存在
    for sop_id in body.conditions:
        if not get_standard(sop_id):
            raise HTTPException(status_code=400, detail=f"無效的測試條件：{sop_id}")

    user_id = current_user(request).user_id
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
        log_audit(db, str(user_id or "unknown"), "admin", "CREATE", "schedule", s.id,
                  f"{s.project_number} / {s.sample_name}")
        db.commit()
        db.refresh(s)
        return _enrich(s, db)


def _slot_changed(body: "SchedulePatch") -> bool:
    """請求是否試圖變更設備或時段（純改備註不需重新檢查衝突）。"""
    return any(v is not None for v in (body.device_id, body.start_time, body.end_time))


def _assert_no_overlap(db, schedule_id: int, device_id, start, end) -> None:
    """同一設備上不得有時段重疊的有效排程。"""
    overlap = find_overlapping_schedule(db, schedule_id, device_id, start, end)
    if overlap:
        raise HTTPException(
            status_code=409,
            detail=f"時段與排程 #{overlap.id}（{overlap.project_number}）重疊"
        )


def _patch_schedule_db(schedule_id: int, body: "SchedulePatch", role, user_id, cache: dict):
    cancelled_device_id = None
    immediate_start = None
    conditions = None
    device_id = None
    start_aware = None

    with SessionLocal() as db:
        s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="找不到排程")

        if role != "admin":
            if user_id is None or s.applicant_user_id != user_id:
                raise HTTPException(status_code=403, detail="只能取消自己的排程")
            if s.status != ScheduleStatus.PENDING:
                raise HTTPException(status_code=400, detail="只能取消待審核的排程")

        if body.note is not None:
            s.note = body.note
        if body.rejection_note is not None:
            s.rejection_note = body.rejection_note

        if body.status == ScheduleStatus.CONFIRMED:
            if s.status != ScheduleStatus.PENDING:
                raise HTTPException(status_code=409, detail=f"排程已是「{s.status}」，無法重複確認")
            conditions = _parse_conditions(s.conditions)
            running_until = _build_running_until(cache)
            if body.device_id and body.start_time and body.end_time:
                device_id = body.device_id
                start = body.start_time
                end = body.end_time
                _assert_no_overlap(db, schedule_id, device_id, start, end)
            elif body.device_id:
                device_id = body.device_id
                total_hours = _calc_total_hours(conditions)
                start = _find_earliest_slot(device_id, total_hours, db, running_until)
                end = start + datetime.timedelta(hours=total_hours)
            else:
                device_id, start, end = _auto_assign(conditions, db, running_until, cache)

            s.device_id = device_id
            s.start_time = start
            s.end_time = end
            s.confirmed_by = user_id

            now_utc = _now_utc()
            start_aware = start if start.tzinfo else start.replace(tzinfo=datetime.timezone.utc)
            immediate_start = start_aware <= now_utc
            # 一律先落地為「已確認 + 治具已預約」。即時啟動的排程由 try_start_schedule
            # 在設備真的進入 RUNNING 後，才推進狀態並把預約治具轉為借出。
            s.status = ScheduleStatus.CONFIRMED
            for sf in db.query(ScheduleFixture).filter(ScheduleFixture.schedule_id == s.id).all():
                db.add(FixtureLoan(
                    fixture_id=sf.fixture_id,
                    borrower_name=s.applicant_name or "排程系統",
                    borrower_user_id=s.applicant_user_id,
                    device_id=device_id,
                    project_name=f"{s.project_number} / {s.sample_name}",
                    quantity=sf.quantity,
                    due_date=end,
                    status="reserved",
                    loan_date=None,
                    schedule_id=s.id,
                ))

        elif body.status in (ScheduleStatus.CANCELLED, ScheduleStatus.RUNNING, ScheduleStatus.DONE):
            original_status = s.status
            original_device_id = s.device_id
            new_device_id = body.device_id or s.device_id
            new_start = body.start_time or s.start_time
            new_end = body.end_time or s.end_time
            # 仍佔用設備的狀態（RUNNING）才需檢查；取消/完成會退出 ACTIVE_STATUSES
            if _slot_changed(body) and body.status in ACTIVE_STATUSES:
                _assert_no_overlap(db, schedule_id, new_device_id, new_start, new_end)

            s.status = body.status
            s.device_id = new_device_id
            s.start_time = new_start
            s.end_time = new_end

            if body.status == ScheduleStatus.CANCELLED:
                db.query(FixtureLoan).filter(
                    FixtureLoan.schedule_id == schedule_id,
                    FixtureLoan.status == "reserved",
                ).delete(synchronize_session=False)
                db.query(FixtureLoan).filter(
                    FixtureLoan.schedule_id == schedule_id,
                    FixtureLoan.status == "loaned",
                ).update({"status": "returned"}, synchronize_session=False)
                if original_status in (ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING) and original_device_id:
                    cancelled_device_id = original_device_id

        else:
            new_device_id = body.device_id if body.device_id is not None else s.device_id
            new_start = body.start_time if body.start_time is not None else s.start_time
            new_end = body.end_time if body.end_time is not None else s.end_time
            if _slot_changed(body) and s.status in ACTIVE_STATUSES:
                _assert_no_overlap(db, schedule_id, new_device_id, new_start, new_end)

            s.device_id = new_device_id
            s.start_time = new_start
            s.end_time = new_end

        s.updated_at = _now_utc_naive()
        if body.status:
            action_map = {
                ScheduleStatus.CONFIRMED: "CONFIRM",
                ScheduleStatus.CANCELLED: "CANCEL",
                ScheduleStatus.RUNNING: "START",
                ScheduleStatus.DONE: "DONE",
            }
            action = action_map.get(body.status, "UPDATE")
            log_audit(db, str(user_id or "unknown"), role or "admin", action, "schedule", schedule_id,
                      f"{s.project_number} / {s.sample_name}")
        db.commit()
        db.refresh(s)
        result = _enrich(s, db)

    return {
        "result": result,
        "immediate_start": immediate_start,
        "conditions": conditions,
        "device_id": device_id,
        "start_aware": start_aware,
        "cancelled_device_id": cancelled_device_id,
        "should_remove_job": body.status == ScheduleStatus.CANCELLED,
    }


@router.patch("/{schedule_id}", response_model=ScheduleOut)
async def patch_schedule(schedule_id: int, body: SchedulePatch, request: Request):
    """
    更新排程（admin only）。
    status=已確認 時若無指定設備，自動排程。
    """
    u = current_user(request)
    user_id, role = u.user_id, u.role

    # 非 admin 只允許取消自己的待審核排程
    if role != "admin":
        if body.status != ScheduleStatus.CANCELLED:
            raise HTTPException(status_code=403, detail="僅管理者可審核排程")

    _cache = getattr(request.app.state, "AICM_CACHE", {})
    _locks = getattr(request.app.state, "DEVICE_LOCKS", {})
    _scheduler = getattr(request.app.state, "scheduler", None)

    out = await asyncio.to_thread(_patch_schedule_db, schedule_id, body, role, user_id, _cache)

    if out["immediate_start"] and out["conditions"] and out["device_id"]:
        # 設備忙碌時不會啟動；排程維持「已確認」，由 fallback 於設備空出後重試。
        await try_start_schedule(
            schedule_id, out["device_id"], out["conditions"], _cache, _locks,
        )
    elif _scheduler and out["start_aware"]:
        _scheduler.add_job(
            _start_schedule_by_id,
            trigger="date",
            run_date=out["start_aware"],
            kwargs={"schedule_id": schedule_id, "cache": _cache, "locks": _locks},
            id=f"sched_{schedule_id}",
            replace_existing=True,
        )

    if out["should_remove_job"] and _scheduler:
        try:
            _scheduler.remove_job(f"sched_{schedule_id}")
        except Exception:
            pass
    if out["cancelled_device_id"]:
        await _force_normal_stop(out["cancelled_device_id"], _cache, _locks)

    return out["result"]


def _delete_schedule_db(schedule_id: int, user_id):
    with SessionLocal() as db:
        s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="找不到排程")
        stop_device_id = s.device_id if s.status in (ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING) else None
        detail = f"{s.project_number} / {s.sample_name}"
        db.query(ScheduleFixture).filter(ScheduleFixture.schedule_id == schedule_id).delete(synchronize_session=False)
        db.query(FixtureLoan).filter(
            FixtureLoan.schedule_id == schedule_id,
        ).delete(synchronize_session=False)
        db.delete(s)
        log_audit(db, str(user_id or "unknown"), "admin", "DELETE", "schedule", schedule_id, detail)
        db.commit()
    return stop_device_id


@router.delete("/{schedule_id}")
async def delete_schedule(schedule_id: int, request: Request, _: None = Depends(require_admin)):
    _cache = getattr(request.app.state, "AICM_CACHE", {})
    _locks = getattr(request.app.state, "DEVICE_LOCKS", {})
    _scheduler = getattr(request.app.state, "scheduler", None)
    user_id = current_user(request).user_id

    stop_device_id = await asyncio.to_thread(_delete_schedule_db, schedule_id, user_id)

    if _scheduler:
        try:
            _scheduler.remove_job(f"sched_{schedule_id}")
        except Exception:
            pass
    if stop_device_id:
        await _force_normal_stop(stop_device_id, _cache, _locks)

    return {"ok": True}


# ── 條件確認端點 ──────────────────────────────────────────────────────────────


def _confirm_condition_db(schedule_id: int, now, user_id):
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
            dev = schedule.device_id
            log_audit(db, str(user_id or "unknown"), "admin", "CONFIRM_CONDITION", "schedule", schedule_id,
                      f"條件 {idx}/{len(conditions)}，下一條：{next_sop_id}")
            db.commit()
            return {"completed": False, "next_sop_id": next_sop_id, "dev": dev, "push_msg": None}
        else:
            _complete_schedule(db, schedule, now)
            log_audit(db, str(user_id or "unknown"), "admin", "COMPLETE", "schedule", schedule_id,
                      f"{schedule.project_number} / {schedule.sample_name}")
            db.commit()
            return {
                "completed": True,
                "next_sop_id": None,
                "dev": None,
                "push_msg": (
                    f"✅ 測試完成\n專案：{schedule.project_number} / {schedule.sample_name}"
                    f"\n設備：{schedule.device_id}"
                ),
            }


@router.post("/{schedule_id}/confirm-condition")
async def confirm_condition(schedule_id: int, request: Request, _: None = Depends(require_admin)):
    from .sop import auto_start_sop
    cache = getattr(request.app.state, "AICM_CACHE", {})
    locks = getattr(request.app.state, "DEVICE_LOCKS", {})
    user_id = current_user(request).user_id

    result = await asyncio.to_thread(_confirm_condition_db, schedule_id, _now_utc_naive(), user_id)

    if result["completed"]:
        asyncio.create_task(push_message(result["push_msg"]))
        return {"status": "completed"}

    # 不可 fire-and-forget：設備若尚未回到 IDLE，啟動會被跳過，
    # 而排程停在「進行中」不會被 fallback 重試 → 測試靜默停擺。
    if not await auto_start_sop(result["dev"], result["next_sop_id"], cache, locks):
        dev_status = (cache.get(result["dev"]) or {}).get("status", "未知")
        raise HTTPException(
            status_code=409,
            detail=f"{result['dev']} 目前為「{dev_status}」，尚未回到待機狀態，請待降溫收尾完成後再開始下一條件",
        )
    return {"status": "started", "sop_id": result["next_sop_id"]}


def _load_startable_schedule_db(schedule_id: int):
    """手動啟動前的檢查；狀態不動，由 try_start_schedule 在設備啟動後才推進。"""
    with SessionLocal() as db:
        s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="找不到排程")
        if s.status != ScheduleStatus.CONFIRMED:
            raise HTTPException(status_code=400, detail="只有「已確認」狀態的排程才能手動啟動")
        return _parse_conditions(s.conditions), s.device_id


@router.post("/{schedule_id}/start")
async def start_schedule(schedule_id: int, request: Request, _: None = Depends(require_admin)):
    """手動立即啟動「已確認」排程（補救 APScheduler 漏掉的情況）。"""
    cache = getattr(request.app.state, "AICM_CACHE", {})
    locks = getattr(request.app.state, "DEVICE_LOCKS", {})

    conditions, device_id = await asyncio.to_thread(_load_startable_schedule_db, schedule_id)

    if not conditions or not device_id:
        raise HTTPException(status_code=400, detail="排程缺少測試條件或設備，無法啟動")

    if not await try_start_schedule(schedule_id, device_id, conditions, cache, locks):
        dev_status = (cache.get(device_id) or {}).get("status", "未知")
        raise HTTPException(
            status_code=409,
            detail=f"{device_id} 目前為「{dev_status}」，非待機狀態，無法啟動；"
                   f"排程維持「已確認」，設備空出後會自動啟動",
        )

    return {"status": "started", "device_id": device_id, "sop_id": conditions[0]}


# ── Device Blocked Periods 端點 ────────────────────────────────────────────


def _blocked_period_dict(b: DeviceBlockedPeriod) -> dict:
    return {
        "id": b.id,
        "device_id": b.device_id,
        "start_time": b.start_time,
        "end_time": b.end_time,
        "reason": b.reason,
        "created_by": b.created_by,
        "created_at": b.created_at,
    }


@blocked_router.get("", response_model=list[BlockedPeriodOut])
def list_blocked_periods():
    with SessionLocal() as db:
        items = db.query(DeviceBlockedPeriod).order_by(DeviceBlockedPeriod.start_time).all()
        return [_blocked_period_dict(b) for b in items]


@blocked_router.post("", response_model=BlockedPeriodOut, status_code=201)
def create_blocked_period(body: BlockedPeriodCreate, request: Request, _: None = Depends(require_admin)):
    if body.end_time <= body.start_time:
        raise HTTPException(status_code=400, detail="結束時間必須晚於開始時間")

    if body.device_id not in DEVICE_IDS:
        raise HTTPException(status_code=400, detail=f"無效的設備 ID：{body.device_id}")

    user_id = current_user(request).user_id
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
        return _blocked_period_dict(b)


@blocked_router.patch("/{period_id}", response_model=BlockedPeriodOut)
def update_blocked_period(period_id: int, body: BlockedPeriodPatch, _: None = Depends(require_admin)):
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
        return _blocked_period_dict(b)


@blocked_router.delete("/{period_id}")
def delete_blocked_period(period_id: int, _: None = Depends(require_admin)):
    with SessionLocal() as db:
        b = db.query(DeviceBlockedPeriod).filter(DeviceBlockedPeriod.id == period_id).first()
        if not b:
            raise HTTPException(status_code=404, detail="找不到紀錄")
        db.delete(b)
        db.commit()
    return {"ok": True}
