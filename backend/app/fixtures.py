import asyncio
import datetime
import io
from typing import Optional, List
from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from .models import SessionLocal, Fixture, FixtureLoan, FixtureInventoryLog, PurchaseOrder, User
from .utils import today_utc_window, _now_utc_naive
from .auth import _require_admin

try:
    import pandas as pd
except ImportError:
    pd = None

router = APIRouter(prefix="/api/fixtures", tags=["fixtures"])

# 欄位別名對應表（中英文都接受，不分大小寫）
COLUMN_ALIASES = {
    "interface_type":    ["介面", "interface", "interface_type", "接口"],
    "form_factor":       ["型態", "form factor", "form_factor", "formfactor"],
    "priority":          ["優先度", "priority"],
    "size":              ["尺寸", "size"],
    "purpose":           ["用途", "purpose"],
    "estimated_usage":   ["預估用量", "estimated usage", "estimated_usage"],
    "total_quantity":    ["現有數量", "數量", "quantity", "total_quantity", "total quantity"],
    "shortage":          ["缺貨數", "shortage"],
    "usage_frequency":   ["使用頻率", "使用率", "usage frequency", "usage_frequency"],
    "replacement_years": ["汰換年限", "汰換時間", "replacement years", "replacement_years"],
    "note":              ["備註", "note"],
    "keeper_name":       ["保管人", "keeper", "keeper_name"],
    "deputy_name":       ["代理人", "deputy", "deputy_name"],
    "vendor":            ["廠商", "vendor"],
    "model_number":      ["型號", "model", "model_number", "model number"],
    "unit_price":        ["單價", "price", "unit price", "unit_price"],
}


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


class FixtureUpsert(BaseModel):
    interface_type: str
    form_factor: str
    priority: Optional[int] = None
    size: Optional[str] = None
    purpose: Optional[str] = None
    total_quantity: int = 0
    shortage: int = 0
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


def _calc_loan_qty(db, fixture_id: int, status: str) -> int:
    from sqlalchemy import func
    result = (
        db.query(func.sum(FixtureLoan.quantity))
        .filter(FixtureLoan.fixture_id == fixture_id, FixtureLoan.status == status)
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
    loaned = _calc_loan_qty(db, f.id, "loaned")
    reserved = _calc_loan_qty(db, f.id, "reserved")
    damaged = _calc_loan_qty(db, f.id, "damaged")
    available = max(0, f.total_quantity - loaned - reserved - damaged)
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
        "reserved_quantity": reserved,
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
        now, today_start, today_end = today_utc_window()

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
                FixtureLoan.due_date >= today_start,
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
    """回傳使用者清單（供借出登記下拉選單用，admin only）"""
    _require_admin(request)
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


@router.get("/template")
def download_template():
    """下載治具匯入標準 Excel 範本"""
    if pd is None:
        raise HTTPException(status_code=500, detail="需要安裝 pandas 和 openpyxl")

    columns = ["介面", "型態", "現有數量", "缺貨數", "優先度", "尺寸", "用途",
               "預估用量", "使用頻率", "汰換年限", "備註", "保管人", "代理人",
               "廠商", "型號", "單價"]
    example = ["USB-C", "轉接頭", 10, 0, 1, "", "連接測試設備", "", "", "5年", "", "", "", "", "", ""]
    df = pd.DataFrame([example], columns=columns)

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="治具資料")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=fixture_template.xlsx"},
    )


@router.get("/export")
def export_fixtures():
    """匯出所有治具為 Excel"""
    if pd is None:
        raise HTTPException(status_code=500, detail="需要安裝 pandas 和 openpyxl")

    db = SessionLocal()
    try:
        fixtures = db.query(Fixture).filter(Fixture.is_active == True).order_by(Fixture.interface_type).all()
        rows = []
        for f in fixtures:
            rows.append({
                "介面": f.interface_type,
                "型態": f.form_factor,
                "現有數量": f.total_quantity,
                "缺貨數": f.shortage,
                "優先度": f.priority or "",
                "尺寸": f.size or "",
                "用途": f.purpose or "",
                "預估用量": f.estimated_usage or "",
                "使用頻率": f.usage_frequency or "",
                "汰換年限": f.replacement_years or "",
                "備註": f.note or "",
                "保管人": f.keeper_name or "",
                "代理人": f.deputy_name or "",
                "廠商": f.vendor or "",
                "型號": f.model_number or "",
                "單價": f.unit_price or "",
            })
        df = pd.DataFrame(rows)
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="治具資料")
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=fixtures_export.xlsx"},
        )
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


def _fetch_fixtures_map(db, loans) -> dict:
    """一次撈出 loans 相關的所有 Fixture，回傳 {id: fixture}。"""
    ids = {loan.fixture_id for loan in loans}
    if not ids:
        return {}
    return {f.id: f for f in db.query(Fixture).filter(Fixture.id.in_(ids)).all()}


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
        fixtures = _fetch_fixtures_map(db, loans)
        return [
            {
                "id": loan.id,
                "fixture_id": loan.fixture_id,
                "fixture_interface": fixtures[loan.fixture_id].interface_type if loan.fixture_id in fixtures else "",
                "fixture_form_factor": fixtures[loan.fixture_id].form_factor if loan.fixture_id in fixtures else "",
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
    finally:
        db.close()


@router.get("/loans/overdue")
def list_overdue_loans():
    db = SessionLocal()
    try:
        now_naive = _now_utc_naive()
        loans = (
            db.query(FixtureLoan)
            .filter(
                FixtureLoan.status == "loaned",
                FixtureLoan.due_date < now_naive,
            )
            .order_by(FixtureLoan.due_date.asc())
            .all()
        )
        fixtures = _fetch_fixtures_map(db, loans)
        return [
            {
                "id": loan.id,
                "fixture_id": loan.fixture_id,
                "fixture_interface": fixtures[loan.fixture_id].interface_type if loan.fixture_id in fixtures else "",
                "fixture_form_factor": fixtures[loan.fixture_id].form_factor if loan.fixture_id in fixtures else "",
                "borrower_name": loan.borrower_name,
                "device_id": loan.device_id,
                "project_name": loan.project_name,
                "due_date": loan.due_date.isoformat() if loan.due_date else None,
                "overdue_days": (now_naive - loan.due_date).days if loan.due_date else 0,
            }
            for loan in loans
        ]
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
        fixtures = _fetch_fixtures_map(db, loans)
        return [
            {
                "id": loan.id,
                "fixture_id": loan.fixture_id,
                "fixture_interface": fixtures[loan.fixture_id].interface_type if loan.fixture_id in fixtures else "",
                "fixture_form_factor": fixtures[loan.fixture_id].form_factor if loan.fixture_id in fixtures else "",
                "borrower_name": loan.borrower_name,
                "device_id": loan.device_id,
                "project_name": loan.project_name,
                "quantity": loan.quantity,
                "loan_date": loan.loan_date.isoformat() if loan.loan_date else None,
                "return_date": loan.return_date.isoformat() if loan.return_date else None,
                "status": loan.status,
                "return_condition": loan.return_condition,
                "keeper_note": loan.keeper_note,
            }
            for loan in loans
        ]
    finally:
        db.close()


@router.post("/loans")
async def create_loan(body: LoanCreate, request: Request):
    _require_admin(request)

    db = SessionLocal()
    try:
        f = db.query(Fixture).filter(Fixture.id == body.fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")

        loaned = _calc_loan_qty(db, f.id, "loaned")
        reserved = _calc_loan_qty(db, f.id, "reserved")
        damaged = _calc_loan_qty(db, f.id, "damaged")
        available = max(0, f.total_quantity - loaned - reserved - damaged)
        if available < body.quantity:
            raise HTTPException(
                status_code=400, detail=f"庫存不足，目前可借：{available} 件"
            )

        # 用 SQL-level atomic update 確保原子性，避免並發超借出
        updated = (
            db.query(Fixture)
            .filter(
                Fixture.id == body.fixture_id,
                Fixture.total_quantity >= body.quantity + loaned + damaged
            )
            .update({}, synchronize_session="fetch")
        )
        if not updated:
            raise HTTPException(
                status_code=400, detail="並發借出失敗，庫存已被他人搶先取用，請重試"
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
        return {"status": "success", "loan_id": loan_id}
    finally:
        db.close()


@router.post("/loans/{loan_id}/return")
def return_loan(loan_id: int, body: ReturnUpdate, request: Request):
    _require_admin(request)

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
    _require_admin(request)

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
    """從 Excel 匯入治具資料（admin only）"""
    _require_admin(request)
    if pd is None:
        raise HTTPException(status_code=500, detail="需要安裝 pandas 和 openpyxl")

    contents = await file.read()
    df = pd.read_excel(io.BytesIO(contents), header=0)

    # 將 DataFrame 欄標題正規化（去空白、小寫）後建立對應 dict
    col_map = {}  # field_name -> actual_df_column
    normalized_cols = {str(c).strip().lower(): c for c in df.columns}
    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            key = alias.strip().lower()
            if key in normalized_cols:
                col_map[field] = normalized_cols[key]
                break

    db = SessionLocal()
    imported = 0
    updated = 0
    skipped = 0

    def safe_str(row, field):
        col = col_map.get(field)
        if col is None:
            return None
        try:
            val = row[col]
            if pd.isna(val):
                return None
            s = str(val).strip()
            return s if s and s.lower() != "nan" else None
        except (KeyError, TypeError):
            return None

    def safe_int(row, field, default=None):
        col = col_map.get(field)
        if col is None:
            return default
        try:
            val = row[col]
            if pd.isna(val):
                return default
            return int(float(val))
        except (KeyError, ValueError, TypeError):
            return default

    def safe_float(row, field):
        col = col_map.get(field)
        if col is None:
            return None
        try:
            val = row[col]
            if pd.isna(val):
                return None
            return float(val)
        except (KeyError, ValueError, TypeError):
            return None

    try:
        for _, row in df.iterrows():
            interface_type = safe_str(row, "interface_type") or ""
            form_factor = safe_str(row, "form_factor") or ""

            if not interface_type or not form_factor:
                skipped += 1
                continue

            existing = db.query(Fixture).filter(
                Fixture.interface_type == interface_type,
                Fixture.form_factor == form_factor,
                Fixture.is_active == True,
            ).first()

            fields = dict(
                priority=safe_int(row, "priority"),
                size=safe_str(row, "size"),
                purpose=safe_str(row, "purpose"),
                estimated_usage=safe_float(row, "estimated_usage"),
                total_quantity=safe_int(row, "total_quantity", 0),
                shortage=safe_int(row, "shortage", 0),
                usage_frequency=safe_int(row, "usage_frequency"),
                replacement_years=safe_str(row, "replacement_years"),
                note=safe_str(row, "note"),
                keeper_name=safe_str(row, "keeper_name"),
                deputy_name=safe_str(row, "deputy_name"),
                vendor=safe_str(row, "vendor"),
                model_number=safe_str(row, "model_number"),
                unit_price=safe_float(row, "unit_price"),
            )

            if existing:
                for k, v in fields.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                db.add(Fixture(interface_type=interface_type, form_factor=form_factor, **fields))
                imported += 1

        db.commit()
        return {"status": "success", "imported": imported, "updated": updated, "skipped": skipped}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()



# ---------- 設定保管人 ----------


@router.patch("/{fixture_id}/keeper")
def set_keeper(fixture_id: int, body: SetKeeperBody, request: Request):
    """設定治具的系統保管人（admin only）"""
    _require_admin(request)
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
    _require_admin(request)

    user = getattr(request.state, "user", None)
    counted_by = user.get("username") if user else None

    db = SessionLocal()
    try:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")

        previous = f.total_quantity
        diff = actual_quantity - previous
        f.total_quantity = actual_quantity

        log = FixtureInventoryLog(
            fixture_id=fixture_id,
            previous_quantity=previous,
            counted_quantity=actual_quantity,
            difference=diff,
            counted_by=counted_by,
        )
        db.add(log)
        db.commit()
        return {
            "status": "success",
            "previous": previous,
            "actual": actual_quantity,
            "diff": diff,
        }
    finally:
        db.close()


@router.get("/inventory-logs")
def list_inventory_logs(fixture_id: Optional[int] = None):
    db = SessionLocal()
    try:
        q = db.query(FixtureInventoryLog).order_by(FixtureInventoryLog.counted_at.desc())
        if fixture_id is not None:
            q = q.filter(FixtureInventoryLog.fixture_id == fixture_id)
        logs = q.limit(200).all()
        fixture_ids = {log.fixture_id for log in logs}
        fixtures = {f.id: f for f in db.query(Fixture).filter(Fixture.id.in_(fixture_ids)).all()} if fixture_ids else {}
        return [
            {
                "id": log.id,
                "fixture_id": log.fixture_id,
                "fixture_interface": fixtures[log.fixture_id].interface_type if log.fixture_id in fixtures else "",
                "fixture_form_factor": fixtures[log.fixture_id].form_factor if log.fixture_id in fixtures else "",
                "previous_quantity": log.previous_quantity,
                "counted_quantity": log.counted_quantity,
                "difference": log.difference,
                "counted_at": log.counted_at.isoformat() if log.counted_at else None,
                "counted_by": log.counted_by,
            }
            for log in logs
        ]
    finally:
        db.close()


# ---------- 新增治具 ----------


@router.post("/")
def create_fixture(body: FixtureUpsert, request: Request):
    _require_admin(request)
    db = SessionLocal()
    try:
        f = Fixture(
            interface_type=body.interface_type,
            form_factor=body.form_factor,
            priority=body.priority,
            size=body.size,
            purpose=body.purpose,
            total_quantity=body.total_quantity,
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
        db.add(f)
        db.commit()
        db.refresh(f)
        return _fixture_to_out(db, f)
    finally:
        db.close()


# ---------- 編輯治具 ----------


@router.patch("/{fixture_id}")
def update_fixture(fixture_id: int, body: FixtureUpsert, request: Request):
    _require_admin(request)
    db = SessionLocal()
    try:
        f = db.query(Fixture).filter(Fixture.id == fixture_id, Fixture.is_active == True).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        f.interface_type = body.interface_type
        f.form_factor = body.form_factor
        f.priority = body.priority
        f.size = body.size
        f.purpose = body.purpose
        f.total_quantity = body.total_quantity
        f.shortage = body.shortage
        f.usage_frequency = body.usage_frequency
        f.replacement_years = body.replacement_years
        f.note = body.note
        f.keeper_name = body.keeper_name
        f.deputy_name = body.deputy_name
        f.vendor = body.vendor
        f.model_number = body.model_number
        f.unit_price = body.unit_price
        db.commit()
        return _fixture_to_out(db, f)
    finally:
        db.close()


# ---------- 刪除治具（軟刪除）----------


@router.delete("/{fixture_id}")
def delete_fixture(fixture_id: int, request: Request):
    _require_admin(request)
    db = SessionLocal()
    try:
        f = db.query(Fixture).filter(Fixture.id == fixture_id, Fixture.is_active == True).first()
        if not f:
            raise HTTPException(status_code=404, detail="治具不存在")
        active_loans = db.query(FixtureLoan).filter(
            FixtureLoan.fixture_id == fixture_id,
            FixtureLoan.status == "loaned",
        ).count()
        if active_loans > 0:
            raise HTTPException(status_code=400, detail=f"此治具有 {active_loans} 筆借出未歸還，無法刪除")
        f.is_active = False
        db.commit()
        return {"status": "success"}
    finally:
        db.close()
