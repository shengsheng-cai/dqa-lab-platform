import datetime
import re
from typing import Optional, List
from sqlalchemy import func
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from .models import (
    SessionLocal,
    Fixture,
    FixtureLoan,
    FixtureInventoryLog,
    User,
    ReturnCondition,
)
from .utils import today_utc_window, _now_utc_naive, _to_naive_utc
from .auth import require_admin, current_user
from .audit_log import log_audit
from .fixture_lifecycle import (
    ACTIVE_LOAN_STATUSES,
    LOAN_DAMAGED,
    LOAN_LOANED,
    LOAN_LOST,
    acquire_fixture_allocation_lock,
    create_manual_loan,
    fetch_fixtures_map as _fetch_fixtures_map,
    finish_manual_loan,
    record_inventory_count,
    set_fixture_quantity,
    stock_counts as _stock_counts,
    update_inventory_log_count,
    build_loan_qty_map as _build_loan_qty_map,
)

router = APIRouter(prefix="/api/fixtures", tags=["fixtures"])


# ---------- Pydantic Schemas ----------


class FixtureOut(BaseModel):
    id: int
    priority: Optional[int]
    interface_type: str
    form_factor: str
    size: Optional[str]
    purpose: Optional[str]
    total_quantity: int
    shortage: int
    available_quantity: int
    loaned_quantity: int
    reserved_quantity: int
    damaged_quantity: int
    usage_frequency: Optional[int]
    replacement_years: Optional[str]
    note: Optional[str]
    keeper_name: Optional[str]
    keeper_user_id: Optional[int]
    deputy_name: Optional[str]
    vendor: Optional[str]
    model_number: Optional[str]
    unit_price: Optional[float]
    loan_count: int
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class LoanCreate(BaseModel):
    fixture_id: int
    borrower_name: str
    borrower_user_id: Optional[int] = None
    device_id: Optional[str] = None
    project_name: Optional[str] = None
    quantity: int = 1
    due_date: Optional[datetime.datetime] = None


class SetKeeperBody(BaseModel):
    keeper_user_id: Optional[int] = None


class FixtureUpsert(BaseModel):
    interface_type: str
    form_factor: str
    priority: Optional[int] = None
    size: Optional[str] = None
    purpose: Optional[str] = None
    total_quantity: int = Field(default=0, ge=0)
    shortage: int = Field(default=0, ge=0)
    usage_frequency: Optional[int] = None
    replacement_years: Optional[str] = None
    note: Optional[str] = None
    keeper_name: Optional[str] = None
    deputy_name: Optional[str] = None
    vendor: Optional[str] = None
    model_number: Optional[str] = None
    unit_price: Optional[float] = None


class LoanOut(BaseModel):
    id: int
    fixture_id: int
    fixture_interface: str
    fixture_form_factor: str
    borrower_name: str
    device_id: Optional[str]
    project_name: Optional[str]
    quantity: int
    loan_date: Optional[datetime.datetime] = None
    due_date: Optional[datetime.datetime]
    return_date: Optional[datetime.datetime]
    status: str
    return_condition: Optional[ReturnCondition]
    extension_note: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class ReturnUpdate(BaseModel):
    return_condition: ReturnCondition
    keeper_note: Optional[str] = None
    returned_at: Optional[str] = None  # YYYY-MM-DD，不填則用當下時間


class ExtensionRequest(BaseModel):
    new_due_date: datetime.datetime
    reason: str


# ---------- Helper ----------


def _calc_replacement_date(f: Fixture) -> Optional[str]:
    """根據 replacement_years 與 created_at 計算預估汰換日期"""
    if not f.replacement_years or not f.created_at:
        return None
    try:
        years = float(re.search(r"[\d.]+", str(f.replacement_years)).group())
        days = int(years * 365)
        created = f.created_at
        if created.tzinfo is not None:
            created = created.replace(tzinfo=None)
        return (created + datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    except Exception:
        return None


def _keeper_name_map(db, fixtures: list[Fixture]) -> dict[int, str]:
    """批次取得保管人的即時顯示名稱；Fixture.keeper_name 僅作快照備援。"""
    user_ids = {fixture.keeper_user_id for fixture in fixtures if fixture.keeper_user_id}
    if not user_ids:
        return {}
    return {
        user.id: user.display_name
        for user in db.query(User).filter(User.id.in_(user_ids)).all()
    }


def _fixture_to_out(
    f: Fixture,
    loan_map: dict,
    keeper_names: Optional[dict[int, str]] = None,
) -> dict:
    qty = _stock_counts(f, loan_map)
    keeper_name = (keeper_names or {}).get(f.keeper_user_id, f.keeper_name)
    return {
        "id": f.id,
        "priority": f.priority,
        "interface_type": f.interface_type,
        "form_factor": f.form_factor,
        "size": f.size,
        "purpose": f.purpose,
        "total_quantity": f.total_quantity,
        "shortage": f.shortage,
        "available_quantity": qty.available,
        "loaned_quantity": qty.loaned,
        "reserved_quantity": qty.reserved,
        "damaged_quantity": qty.damaged,
        "usage_frequency": f.usage_frequency,
        "replacement_years": f.replacement_years,
        "estimated_replacement_date": _calc_replacement_date(f),
        "note": f.note,
        "keeper_name": keeper_name,
        "keeper_user_id": f.keeper_user_id,
        "deputy_name": f.deputy_name,
        "vendor": f.vendor,
        "model_number": f.model_number,
        "unit_price": f.unit_price,
        "loan_count": f.loan_count,
        "is_active": f.is_active,
    }


# ---------- 治具清單 ----------


@router.get("/", response_model=List[dict])
def list_fixtures(
    interface_type: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
):
    with SessionLocal() as db:
        q = db.query(Fixture).filter(Fixture.is_active)
        if interface_type:
            q = q.filter(Fixture.interface_type == interface_type)
        if search:
            q = q.filter(
                (Fixture.interface_type.contains(search))
                | (Fixture.form_factor.contains(search))
            )
        fixtures = q.order_by(Fixture.priority.asc(), Fixture.id.asc()).all()

        fixture_ids = [f.id for f in fixtures]
        loan_map = _build_loan_qty_map(db, fixture_ids)
        keeper_names = _keeper_name_map(db, fixtures)

        result = []
        for f in fixtures:
            data = _fixture_to_out(f, loan_map, keeper_names)
            if status:
                avail = data["available_quantity"]
                total = data["total_quantity"]
                if status == "ok" and not (avail > 0 and data["shortage"] == 0):
                    continue
                elif status == "shortage" and not (avail > 0 and data["shortage"] > 0):
                    continue
                elif status == "out_of_stock" and not (avail == 0 and total == 0):
                    continue
                elif status == "loaned" and not (data["loaned_quantity"] > 0):
                    continue
            result.append(data)
        return result


@router.get("/summary")
def get_summary(
    due_from: Optional[datetime.datetime] = None,
    due_to: Optional[datetime.datetime] = None,
):
    """治具摘要計數。

    due_from / due_to 是前端算好的「今天」日界（ISO）。後端存的是 UTC、也不知道
    使用者在哪個時區，沒帶就退回 UTC 當日——那會讓台北凌晨 0–8 點的「今日到期」
    顯示成前一天的筆數。
    """
    with SessionLocal() as db:
        now, utc_day_start, utc_day_end = today_utc_window()
        window_start = _to_naive_utc(due_from) or utc_day_start
        window_end = _to_naive_utc(due_to) or utc_day_end

        total_loaned = (
            db.query(func.sum(FixtureLoan.quantity))
            .filter(FixtureLoan.status == LOAN_LOANED)
            .scalar()
        ) or 0

        due_today = (
            db.query(FixtureLoan)
            .filter(
                FixtureLoan.status == LOAN_LOANED,
                FixtureLoan.due_date <= window_end,
                FixtureLoan.due_date >= window_start,
            )
            .count()
        )

        overdue = (
            db.query(FixtureLoan)
            .filter(
                FixtureLoan.status == LOAN_LOANED,
                FixtureLoan.due_date < now,
            )
            .count()
        )

        shortage_count = (
            db.query(Fixture)
            .filter(
                Fixture.is_active,
                Fixture.shortage > 0,
            )
            .count()
        )

        replacement_due = (
            db.query(Fixture)
            .filter(
                Fixture.is_active,
                Fixture.replacement_years.isnot(None),
            )
            .count()
        )

        return {
            "total_loaned": total_loaned,
            "due_today": due_today,
            "overdue": overdue,
            "shortage_count": shortage_count,
            "replacement_due": replacement_due,
        }


@router.get("/interface-types")
def get_interface_types():
    with SessionLocal() as db:
        rows = (
            db.query(Fixture.interface_type)
            .filter(Fixture.is_active)
            .distinct()
            .all()
        )
        return sorted([r[0] for r in rows if r[0]])


@router.patch("/inventory-logs/{log_id}")
def patch_inventory_log(log_id: int, actual_quantity: int, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    with SessionLocal() as db:
        log = (
            db.query(FixtureInventoryLog)
            .filter(FixtureInventoryLog.id == log_id)
            .first()
        )
        if not log:
            raise HTTPException(status_code=404, detail="盤點紀錄不存在")
        f = db.query(Fixture).filter(Fixture.id == log.fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        update_inventory_log_count(f, log, actual_quantity)
        log_audit(db, str(u.user_id or "unknown"), u.role, "INVENTORY_LOG_UPDATE", "fixture", log.fixture_id,
                  f"修改盤點紀錄 #{log_id}：庫存改為 {actual_quantity}")
        db.commit()
        return {
            "id": log.id,
            "counted_quantity": log.counted_quantity,
            "difference": log.difference,
        }


@router.delete("/inventory-logs/{log_id}")
def delete_inventory_log(log_id: int, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    with SessionLocal() as db:
        log = (
            db.query(FixtureInventoryLog)
            .filter(FixtureInventoryLog.id == log_id)
            .first()
        )
        if not log:
            raise HTTPException(status_code=404, detail="盤點紀錄不存在")
        fixture_id = log.fixture_id
        db.delete(log)
        log_audit(db, str(u.user_id or "unknown"), u.role, "INVENTORY_LOG_DELETE", "fixture", fixture_id,
                  f"刪除盤點紀錄 #{log_id}")
        db.commit()
        return {"status": "deleted"}


@router.post("/inventory-logs")
def create_inventory_log(fixture_id: int, actual_quantity: int, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    user_id, counted_by = u.user_id, u.username
    with SessionLocal() as db:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        log, _, _ = record_inventory_count(
            db,
            f,
            actual_quantity,
            user_id,
            counted_by,
            u.role,
        )
        db.commit()
        db.refresh(log)
        return {
            "id": log.id,
            "fixture_id": log.fixture_id,
            "fixture_interface": f.interface_type,
            "fixture_form_factor": f.form_factor,
            "previous_quantity": log.previous_quantity,
            "counted_quantity": log.counted_quantity,
            "difference": log.difference,
            "counted_at": log.counted_at.isoformat() if log.counted_at else None,
            "counted_by": log.counted_by,
        }


@router.get("/inventory-logs")
def list_inventory_logs(fixture_id: Optional[int] = None):
    with SessionLocal() as db:
        q = db.query(FixtureInventoryLog).order_by(
            FixtureInventoryLog.counted_at.desc()
        )
        if fixture_id is not None:
            q = q.filter(FixtureInventoryLog.fixture_id == fixture_id)
        logs = q.limit(200).all()
        fixture_ids = {log.fixture_id for log in logs}
        fixtures = (
            {
                f.id: f
                for f in db.query(Fixture).filter(Fixture.id.in_(fixture_ids)).all()
            }
            if fixture_ids
            else {}
        )
        return [
            {
                "id": log.id,
                "fixture_id": log.fixture_id,
                "fixture_interface": fixtures[log.fixture_id].interface_type
                if log.fixture_id in fixtures
                else "",
                "fixture_form_factor": fixtures[log.fixture_id].form_factor
                if log.fixture_id in fixtures
                else "",
                "previous_quantity": log.previous_quantity,
                "counted_quantity": log.counted_quantity,
                "difference": log.difference,
                "counted_at": log.counted_at.isoformat() if log.counted_at else None,
                "counted_by": log.counted_by,
            }
            for log in logs
        ]


@router.get("/{fixture_id}")
def get_fixture(fixture_id: int):
    with SessionLocal() as db:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        loan_map = _build_loan_qty_map(db, [f.id])
        return _fixture_to_out(f, loan_map, _keeper_name_map(db, [f]))


# ---------- 借出 ----------


@router.get("/loans/active")
def list_active_loans():
    with SessionLocal() as db:
        loans = (
            db.query(FixtureLoan)
            .filter(FixtureLoan.status.in_(ACTIVE_LOAN_STATUSES))
            .order_by(FixtureLoan.due_date.asc())
            .all()
        )
        fixtures = _fetch_fixtures_map(db, {loan.fixture_id for loan in loans})
        return [
            {
                "id": loan.id,
                "fixture_id": loan.fixture_id,
                "fixture_interface": fixtures[loan.fixture_id].interface_type
                if loan.fixture_id in fixtures
                else "",
                "fixture_form_factor": fixtures[loan.fixture_id].form_factor
                if loan.fixture_id in fixtures
                else "",
                "borrower_name": loan.borrower_name,
                "device_id": loan.device_id,
                "project_name": loan.project_name,
                "quantity": loan.quantity,
                "loan_date": loan.loan_date.isoformat() if loan.loan_date else None,
                "due_date": loan.due_date.isoformat() if loan.due_date else None,
                "status": loan.status,
            }
            for loan in loans
        ]


@router.get("/loans/damaged")
def list_damaged_lost_loans():
    """損壞或遺失的治具紀錄"""
    with SessionLocal() as db:
        loans = (
            db.query(FixtureLoan)
            .filter(FixtureLoan.status.in_((LOAN_DAMAGED, LOAN_LOST)))
            .order_by(FixtureLoan.return_date.desc())
            .all()
        )
        fixtures = _fetch_fixtures_map(db, {loan.fixture_id for loan in loans})
        return [
            {
                "id": loan.id,
                "fixture_id": loan.fixture_id,
                "fixture_interface": fixtures[loan.fixture_id].interface_type
                if loan.fixture_id in fixtures
                else "",
                "fixture_form_factor": fixtures[loan.fixture_id].form_factor
                if loan.fixture_id in fixtures
                else "",
                "borrower_name": loan.borrower_name,
                "device_id": loan.device_id,
                "project_name": loan.project_name,
                "quantity": loan.quantity,
                "loan_date": loan.loan_date.isoformat() if loan.loan_date else None,
                "return_date": loan.return_date.isoformat()
                if loan.return_date
                else None,
                "status": loan.status,
                "return_condition": loan.return_condition,
                "keeper_note": loan.keeper_note,
            }
            for loan in loans
        ]


@router.post("/loans")
def create_loan(body: LoanCreate, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    user_id = u.user_id
    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="借出數量必須大於 0")
    with SessionLocal() as db:
        acquire_fixture_allocation_lock(db)
        f = db.query(Fixture).filter(Fixture.id == body.fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")

        loan = create_manual_loan(
            db,
            f,
            borrower_name=body.borrower_name,
            borrower_user_id=body.borrower_user_id,
            device_id=body.device_id,
            project_name=body.project_name,
            quantity=body.quantity,
            due_date=_to_naive_utc(body.due_date),
            loan_date=_now_utc_naive(),
        )
        log_audit(db, str(user_id or "unknown"), u.role, "LOAN", "fixture", body.fixture_id,
                  f"{f.interface_type} {f.form_factor} x{body.quantity}，借用人：{body.borrower_name}")
        db.commit()
        db.refresh(loan)
        loan_id = loan.id
        return {"status": "success", "loan_id": loan_id}


@router.post("/loans/{loan_id}/return")
def return_loan(loan_id: int, body: ReturnUpdate, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    user_id = u.user_id
    with SessionLocal() as db:
        loan = db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first()
        if not loan:
            raise HTTPException(status_code=404, detail="借出紀錄不存在")

        if body.returned_at:
            try:
                d = datetime.date.fromisoformat(body.returned_at)
                return_date = datetime.datetime(d.year, d.month, d.day)
            except ValueError:
                return_date = _now_utc_naive()
        else:
            return_date = _now_utc_naive()
        loan.keeper_note = body.keeper_note
        finish_manual_loan(
            db,
            loan,
            body.return_condition,
            return_date,
        )

        condition_label = {ReturnCondition.NORMAL: "正常", ReturnCondition.DAMAGED: "損壞", ReturnCondition.LOST: "遺失"}.get(
            body.return_condition, str(body.return_condition)
        )
        log_audit(db, str(user_id or "unknown"), u.role, "RETURN", "fixture", loan.fixture_id,
                  f"loan#{loan_id}，狀態：{condition_label}")
        db.commit()
        return {"status": "success"}


@router.post("/loans/{loan_id}/extend")
def extend_loan(loan_id: int, body: ExtensionRequest, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    with SessionLocal() as db:
        loan = db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first()
        if not loan:
            raise HTTPException(status_code=404, detail="借出紀錄不存在")

        old_due = loan.due_date.isoformat() if loan.due_date else "未設定"
        new_due = _to_naive_utc(body.new_due_date)
        loan.due_date = new_due
        note = f"[延期] {old_due} → {new_due.isoformat()} 原因：{body.reason}"
        loan.extension_note = (loan.extension_note or "") + "\n" + note
        log_audit(db, str(u.user_id or "unknown"), u.role, "LOAN_EXTEND", "fixture", loan.fixture_id,
                  f"借出 #{loan_id} 延期至 {new_due.date()}")
        db.commit()
        return {"status": "success"}


# ---------- 設定保管人 ----------


@router.patch("/{fixture_id}/keeper")
def set_keeper(fixture_id: int, body: SetKeeperBody, request: Request, _: None = Depends(require_admin)):
    """設定治具的系統保管人（admin only）"""
    actor = current_user(request)
    with SessionLocal() as db:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")

        f.keeper_user_id = body.keeper_user_id

        # 保存當下姓名作快照備援；讀取時仍以 User.display_name 反映後續改名。
        if body.keeper_user_id:
            u = db.query(User).filter(User.id == body.keeper_user_id).first()
            if not u:
                raise HTTPException(status_code=404, detail="使用者不存在")
            f.keeper_name = u.display_name
        else:
            f.keeper_name = None

        log_audit(db, str(actor.user_id or "unknown"), actor.role, "KEEPER_SET", "fixture", fixture_id,
                  f"設定保管人：{f.keeper_name or '（清除）'}")
        db.commit()
        return {"status": "success"}


# ---------- 月盤點 ----------


@router.post("/{fixture_id}/inventory")
def update_inventory(fixture_id: int, actual_quantity: int, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    user_id, counted_by = u.user_id, u.username

    with SessionLocal() as db:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        _, previous, diff = record_inventory_count(
            db,
            f,
            actual_quantity,
            user_id,
            counted_by,
            u.role,
        )
        db.commit()
        return {
            "status": "success",
            "previous": previous,
            "actual": actual_quantity,
            "diff": diff,
        }


# ---------- 新增治具 ----------


@router.post("/")
def create_fixture(body: FixtureUpsert, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    with SessionLocal() as db:
        f = Fixture(
            interface_type=body.interface_type,
            form_factor=body.form_factor,
            priority=body.priority,
            size=body.size,
            purpose=body.purpose,
            total_quantity=0,
            shortage=body.shortage,
            usage_frequency=body.usage_frequency,
            replacement_years=body.replacement_years,
            note=body.note,
            keeper_name=body.keeper_name,
            deputy_name=body.deputy_name,
            vendor=body.vendor,
            model_number=body.model_number,
            unit_price=body.unit_price,
        )
        set_fixture_quantity(f, body.total_quantity)
        db.add(f)
        db.flush()
        log_audit(db, str(u.user_id or "unknown"), u.role, "CREATE", "fixture", f.id,
                  f"新增治具：{f.interface_type} / {f.form_factor}")
        db.commit()
        db.refresh(f)
        loan_map = _build_loan_qty_map(db, [f.id])
        return _fixture_to_out(f, loan_map, _keeper_name_map(db, [f]))


# ---------- 編輯治具 ----------


@router.patch("/{fixture_id}")
def update_fixture(fixture_id: int, body: FixtureUpsert, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    with SessionLocal() as db:
        f = (
            db.query(Fixture)
            .filter(Fixture.id == fixture_id, Fixture.is_active)
            .first()
        )
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        f.interface_type = body.interface_type
        f.form_factor = body.form_factor
        f.priority = body.priority
        f.size = body.size
        f.purpose = body.purpose
        set_fixture_quantity(f, body.total_quantity)
        f.shortage = body.shortage
        f.usage_frequency = body.usage_frequency
        f.replacement_years = body.replacement_years
        f.note = body.note
        f.keeper_name = body.keeper_name
        f.deputy_name = body.deputy_name
        f.vendor = body.vendor
        f.model_number = body.model_number
        f.unit_price = body.unit_price
        log_audit(db, str(u.user_id or "unknown"), u.role, "UPDATE", "fixture", fixture_id,
                  f"編輯治具 #{fixture_id}")
        db.commit()
        loan_map = _build_loan_qty_map(db, [f.id])
        return _fixture_to_out(f, loan_map, _keeper_name_map(db, [f]))


# ---------- 刪除治具（軟刪除）----------


@router.delete("/{fixture_id}")
def delete_fixture(fixture_id: int, request: Request, _: None = Depends(require_admin)):
    u = current_user(request)
    with SessionLocal() as db:
        f = (
            db.query(Fixture)
            .filter(Fixture.id == fixture_id, Fixture.is_active)
            .first()
        )
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        active_loans = (
            db.query(FixtureLoan)
            .filter(
                FixtureLoan.fixture_id == fixture_id,
                FixtureLoan.status.in_(ACTIVE_LOAN_STATUSES),
            )
            .count()
        )
        if active_loans > 0:
            raise HTTPException(
                status_code=400,
                detail=f"此治具有 {active_loans} 筆借出/預約未結束，無法刪除",
            )
        f.is_active = False
        log_audit(db, str(u.user_id or "unknown"), u.role, "DELETE", "fixture", fixture_id,
                  f"刪除治具 #{fixture_id}（{f.interface_type} / {f.form_factor}）")
        db.commit()
        return {"status": "success"}
