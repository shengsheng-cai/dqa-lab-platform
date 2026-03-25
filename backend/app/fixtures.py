import asyncio
import datetime
import io
from typing import Optional, List
from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from pydantic import BaseModel
from .models import SessionLocal, Fixture, FixtureLoan, PurchaseOrder, User

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

    class Config:
        from_attributes = True


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


class LoanOut(BaseModel):
    id: int
    fixture_id: int
    fixture_interface: str
    fixture_form_factor: str
    borrower_name: str
    device_id: Optional[str]
    project_name: Optional[str]
    quantity: int
    loan_date: datetime.datetime
    due_date: Optional[datetime.datetime]
    return_date: Optional[datetime.datetime]
    status: str
    return_condition: Optional[str]
    extension_note: Optional[str]

    class Config:
        from_attributes = True


class ReturnUpdate(BaseModel):
    return_condition: str  # normal / damaged / lost
    keeper_note: Optional[str] = None
    returned_at: Optional[str] = None  # YYYY-MM-DD，不填則用當下時間


class ExtensionRequest(BaseModel):
    new_due_date: datetime.datetime
    reason: str


# ---------- Helper ----------


def _calc_loaned(db, fixture_id: int) -> int:
    from sqlalchemy import func
    result = (
        db.query(func.sum(FixtureLoan.quantity))
        .filter(FixtureLoan.fixture_id == fixture_id, FixtureLoan.status == "loaned")
        .scalar()
    )
    return result or 0


def _calc_damaged(db, fixture_id: int) -> int:
    from sqlalchemy import func
    result = (
        db.query(func.sum(FixtureLoan.quantity))
        .filter(FixtureLoan.fixture_id == fixture_id, FixtureLoan.status == "damaged")
        .scalar()
    )
    return result or 0


def _calc_replacement_date(f: Fixture) -> Optional[str]:
    """根據 replacement_years 與 created_at 計算預估汰換日期"""
    if not f.replacement_years or not f.created_at:
        return None
    try:
        import re
        years = float(re.search(r"[\d.]+", str(f.replacement_years)).group())
        days = int(years * 365)
        created = f.created_at
        if created.tzinfo is not None:
            created = created.replace(tzinfo=None)
        return (created + datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    except Exception:
        return None


def _fixture_to_out(db, f: Fixture) -> dict:
    loaned = _calc_loaned(db, f.id)
    damaged = _calc_damaged(db, f.id)
    available = max(0, f.total_quantity - loaned - damaged)
    return {
        "id": f.id,
        "priority": f.priority,
        "interface_type": f.interface_type,
        "form_factor": f.form_factor,
        "size": f.size,
        "purpose": f.purpose,
        "total_quantity": f.total_quantity,
        "shortage": f.shortage,
        "available_quantity": available,
        "loaned_quantity": loaned,
        "damaged_quantity": damaged,
        "usage_frequency": f.usage_frequency,
        "replacement_years": f.replacement_years,
        "estimated_replacement_date": _calc_replacement_date(f),
        "note": f.note,
        "keeper_name": f.keeper_name,
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
    db = SessionLocal()
    try:
        q = db.query(Fixture).filter(Fixture.is_active == True)
        if interface_type:
            q = q.filter(Fixture.interface_type == interface_type)
        if search:
            q = q.filter(
                (Fixture.interface_type.contains(search))
                | (Fixture.form_factor.contains(search))
            )
        fixtures = q.order_by(Fixture.priority.asc(), Fixture.id.asc()).all()

        result = []
        for f in fixtures:
            data = _fixture_to_out(db, f)
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
    finally:
        db.close()


@router.get("/summary")
def get_summary():
    db = SessionLocal()
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        today_end = now.replace(hour=23, minute=59, second=59)

        from sqlalchemy import func as _func
        total_loaned = (
            db.query(_func.sum(FixtureLoan.quantity))
            .filter(FixtureLoan.status == "loaned")
            .scalar()
        ) or 0

        due_today = (
            db.query(FixtureLoan)
            .filter(
                FixtureLoan.status == "loaned",
                FixtureLoan.due_date <= today_end,
                FixtureLoan.due_date >= now.replace(hour=0, minute=0, second=0),
            )
            .count()
        )

        overdue = (
            db.query(FixtureLoan)
            .filter(
                FixtureLoan.status == "loaned",
                FixtureLoan.due_date < now,
            )
            .count()
        )

        shortage_count = (
            db.query(Fixture)
            .filter(
                Fixture.is_active == True,
                Fixture.shortage > 0,
            )
            .count()
        )

        replacement_due = (
            db.query(Fixture)
            .filter(
                Fixture.is_active == True,
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
    finally:
        db.close()


@router.get("/interface-types")
def get_interface_types():
    db = SessionLocal()
    try:
        rows = (
            db.query(Fixture.interface_type)
            .filter(Fixture.is_active == True)
            .distinct()
            .all()
        )
        return sorted([r[0] for r in rows if r[0]])
    finally:
        db.close()


@router.get("/users")
def list_users(request: Request):
    """回傳使用者清單（供借出登記下拉選單用，任何已登入使用者皆可呼叫）"""
    role = getattr(request.state, "user_role", None)
    if role is None:
        raise HTTPException(status_code=401, detail="請先登入")
    db = SessionLocal()
    try:
        users = (
            db.query(User)
            .filter(User.is_active == True)
            .order_by(User.display_name.asc())
            .all()
        )
        return [
            {"id": u.id, "display_name": u.display_name, "role": u.role}
            for u in users
        ]
    finally:
        db.close()


@router.get("/{fixture_id}")
def get_fixture(fixture_id: int):
    db = SessionLocal()
    try:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        return _fixture_to_out(db, f)
    finally:
        db.close()


# ---------- 借出 ----------


@router.get("/loans/active")
def list_active_loans():
    db = SessionLocal()
    try:
        loans = (
            db.query(FixtureLoan)
            .filter(FixtureLoan.status.in_(["loaned", "reserved"]))
            .order_by(FixtureLoan.due_date.asc())
            .all()
        )

        result = []
        for loan in loans:
            f = db.query(Fixture).filter(Fixture.id == loan.fixture_id).first()
            result.append(
                {
                    "id": loan.id,
                    "fixture_id": loan.fixture_id,
                    "fixture_interface": f.interface_type if f else "",
                    "fixture_form_factor": f.form_factor if f else "",
                    "borrower_name": loan.borrower_name,
                    "device_id": loan.device_id,
                    "project_name": loan.project_name,
                    "quantity": loan.quantity,
                    "loan_date": loan.loan_date.isoformat() if loan.loan_date else None,
                    "due_date": loan.due_date.isoformat() if loan.due_date else None,
                    "status": loan.status,
                }
            )
        return result
    finally:
        db.close()


@router.get("/loans/overdue")
def list_overdue_loans():
    db = SessionLocal()
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        loans = (
            db.query(FixtureLoan)
            .filter(
                FixtureLoan.status == "loaned",
                FixtureLoan.due_date < now,
            )
            .order_by(FixtureLoan.due_date.asc())
            .all()
        )

        result = []
        for loan in loans:
            f = db.query(Fixture).filter(Fixture.id == loan.fixture_id).first()
            overdue_days = (now - loan.due_date).days if loan.due_date else 0
            result.append(
                {
                    "id": loan.id,
                    "fixture_id": loan.fixture_id,
                    "fixture_interface": f.interface_type if f else "",
                    "fixture_form_factor": f.form_factor if f else "",
                    "borrower_name": loan.borrower_name,
                    "device_id": loan.device_id,
                    "project_name": loan.project_name,
                    "due_date": loan.due_date.isoformat() if loan.due_date else None,
                    "overdue_days": overdue_days,
                }
            )
        return result
    finally:
        db.close()


@router.get("/loans/damaged")
def list_damaged_lost_loans():
    """損壞或遺失的治具紀錄"""
    db = SessionLocal()
    try:
        loans = (
            db.query(FixtureLoan)
            .filter(FixtureLoan.status.in_(["damaged", "lost"]))
            .order_by(FixtureLoan.return_date.desc())
            .all()
        )
        result = []
        for loan in loans:
            f = db.query(Fixture).filter(Fixture.id == loan.fixture_id).first()
            result.append({
                "id": loan.id,
                "fixture_id": loan.fixture_id,
                "fixture_interface": f.interface_type if f else "",
                "fixture_form_factor": f.form_factor if f else "",
                "borrower_name": loan.borrower_name,
                "device_id": loan.device_id,
                "project_name": loan.project_name,
                "quantity": loan.quantity,
                "loan_date": loan.loan_date.isoformat() if loan.loan_date else None,
                "return_date": loan.return_date.isoformat() if loan.return_date else None,
                "status": loan.status,
                "return_condition": loan.return_condition,
                "keeper_note": loan.keeper_note,
            })
        return result
    finally:
        db.close()


@router.post("/loans")
async def create_loan(body: LoanCreate, request: Request):
    from .fixture_notifications import notify_loan_created

    if getattr(request.state, "user_role", None) not in ("admin", "keeper"):
        raise HTTPException(status_code=403, detail="需要保管人或管理者權限")

    db = SessionLocal()
    try:
        f = db.query(Fixture).filter(Fixture.id == body.fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")

        loaned = _calc_loaned(db, f.id)
        damaged = _calc_damaged(db, f.id)
        available = max(0, f.total_quantity - loaned - damaged)
        if available < body.quantity:
            raise HTTPException(
                status_code=400, detail=f"庫存不足，目前可借：{available} 件"
            )

        loan = FixtureLoan(
            fixture_id=body.fixture_id,
            borrower_name=body.borrower_name,
            borrower_user_id=body.borrower_user_id,
            device_id=body.device_id,
            project_name=body.project_name,
            quantity=body.quantity,
            due_date=body.due_date,
            status="loaned",
            loan_date=datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(loan)
        f.loan_count += 1
        db.commit()
        db.refresh(loan)
        loan_id = loan.id
        asyncio.create_task(notify_loan_created(loan_id))
        return {"status": "success", "loan_id": loan_id}
    finally:
        db.close()


@router.post("/loans/{loan_id}/return")
def return_loan(loan_id: int, body: ReturnUpdate, request: Request):
    if getattr(request.state, "user_role", None) not in ("admin", "keeper"):
        raise HTTPException(status_code=403, detail="需要保管人或管理者權限")

    db = SessionLocal()
    try:
        loan = db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first()
        if not loan:
            raise HTTPException(status_code=404, detail="借出紀錄不存在")
        if loan.status not in ("loaned", "reserved"):
            raise HTTPException(status_code=400, detail="此紀錄已結束")

        if body.returned_at:
            try:
                d = datetime.date.fromisoformat(body.returned_at)
                loan.return_date = datetime.datetime(d.year, d.month, d.day, tzinfo=datetime.timezone.utc)
            except ValueError:
                loan.return_date = datetime.datetime.now(datetime.timezone.utc)
        else:
            loan.return_date = datetime.datetime.now(datetime.timezone.utc)
        loan.return_condition = body.return_condition
        loan.keeper_note = body.keeper_note

        if body.return_condition == "normal":
            loan.status = "returned"
        elif body.return_condition == "damaged":
            loan.status = "damaged"
        elif body.return_condition == "lost":
            loan.status = "lost"
            f = db.query(Fixture).filter(Fixture.id == loan.fixture_id).first()
            if f:
                f.total_quantity = max(0, f.total_quantity - loan.quantity)

        db.commit()
        return {"status": "success"}
    finally:
        db.close()


@router.post("/loans/{loan_id}/extend")
def extend_loan(loan_id: int, body: ExtensionRequest, request: Request):
    if getattr(request.state, "user_role", None) not in ("admin", "keeper"):
        raise HTTPException(status_code=403, detail="需要保管人或管理者權限")

    db = SessionLocal()
    try:
        loan = db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first()
        if not loan:
            raise HTTPException(status_code=404, detail="借出紀錄不存在")

        old_due = loan.due_date.isoformat() if loan.due_date else "未設定"
        loan.due_date = body.new_due_date
        note = f"[延期] {old_due} → {body.new_due_date.isoformat()} 原因：{body.reason}"
        loan.extension_note = (loan.extension_note or "") + "\n" + note
        db.commit()
        return {"status": "success"}
    finally:
        db.close()


# ---------- Excel 匯入 ----------


@router.post("/import")
async def import_fixtures(request: Request, file: UploadFile = File(...)):
    """從 Excel 匯入治具資料（保管人/管理者操作）"""
    if getattr(request.state, "user_role", None) not in ("admin", "keeper"):
        raise HTTPException(status_code=403, detail="需要保管人或管理者權限")
    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(status_code=500, detail="需要安裝 pandas 和 openpyxl")

    contents = await file.read()
    df = pd.read_excel(io.BytesIO(contents), header=None)

    db = SessionLocal()
    imported = 0
    skipped = 0

    def safe_col(row, idx):
        """安全讀取欄位，欄位不存在或為空時回傳 None"""
        try:
            val = row[idx]
            if pd.isna(val):
                return None
            s = str(val).strip()
            return s if s and s != "nan" else None
        except (KeyError, IndexError):
            return None

    def safe_int_col(row, idx, default=0):
        try:
            val = row[idx]
            if pd.isna(val):
                return default
            return int(float(val))
        except (KeyError, IndexError, ValueError, TypeError):
            return default

    def safe_float_col(row, idx):
        try:
            val = row[idx]
            if pd.isna(val):
                return None
            return float(val)
        except (KeyError, IndexError, ValueError, TypeError):
            return None

    try:
        for idx, row in df.iterrows():
            if idx == 0:
                continue  # 跳過標題行

            interface_type = safe_col(row, 2) or ""
            form_factor = safe_col(row, 3) or ""

            if not interface_type or not form_factor:
                skipped += 1
                continue

            fixture = Fixture(
                priority=safe_int_col(row, 0, None),
                interface_type=interface_type,
                form_factor=form_factor,
                size=safe_col(row, 4),
                purpose=safe_col(row, 5),
                estimated_usage=safe_float_col(row, 6),
                total_quantity=safe_int_col(row, 7, 0),
                shortage=safe_int_col(row, 8, 0),
                usage_frequency=safe_int_col(row, 9, None),
                replacement_years=safe_col(row, 10),
                note=safe_col(row, 11),
                keeper_name=safe_col(row, 12),
                deputy_name=safe_col(row, 13),
                vendor=safe_col(row, 14),
                model_number=safe_col(row, 15),
                unit_price=safe_float_col(row, 16),
            )
            db.add(fixture)
            imported += 1

        db.commit()
        return {"status": "success", "imported": imported, "skipped": skipped}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()



# ---------- 設定保管人 ----------


@router.patch("/{fixture_id}/keeper")
def set_keeper(fixture_id: int, body: SetKeeperBody, request: Request):
    """設定治具的系統保管人（keeper/admin only）"""
    role = getattr(request.state, "user_role", None)
    if role not in ("admin", "keeper"):
        raise HTTPException(status_code=403, detail="需要保管人或管理者權限")
    db = SessionLocal()
    try:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")

        f.keeper_user_id = body.keeper_user_id

        # 同步更新 keeper_name（方便顯示，不需要 join）
        if body.keeper_user_id:
            u = db.query(User).filter(User.id == body.keeper_user_id).first()
            if u:
                f.keeper_name = u.display_name
        else:
            f.keeper_name = None

        db.commit()
        return {"status": "success"}
    finally:
        db.close()


# ---------- 月盤點 ----------


@router.post("/{fixture_id}/inventory")
def update_inventory(fixture_id: int, actual_quantity: int, request: Request):
    if getattr(request.state, "user_role", None) not in ("admin", "keeper"):
        raise HTTPException(status_code=403, detail="需要保管人或管理者權限")

    db = SessionLocal()
    try:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")

        diff = f.total_quantity - actual_quantity
        f.total_quantity = actual_quantity
        db.commit()
        return {
            "status": "success",
            "previous": f.total_quantity + diff,
            "actual": actual_quantity,
            "diff": diff,
        }
    finally:
        db.close()
