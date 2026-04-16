import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from .models import SessionLocal, PurchaseOrder, Fixture
from .auth import require_admin

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])


class PurchaseOrderOut(BaseModel):
    id: int
    fixture_id: int
    fixture_label: str
    quantity: int
    unit_price: Optional[float] = None
    total_price: Optional[float] = None
    vendor: Optional[str] = None
    status: str
    ordered_at: Optional[str] = None
    arrived_at: Optional[str] = None
    note: Optional[str] = None
    created_at: str


def _fmt_dt(dt) -> Optional[str]:
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _order_to_dict(o: PurchaseOrder, fixtures: dict) -> dict:
    fixture = fixtures.get(o.fixture_id)
    fixture_label = (
        f"{fixture.interface_type} / {fixture.form_factor}" if fixture else f"ID:{o.fixture_id}"
    )
    return {
        "id": o.id,
        "fixture_id": o.fixture_id,
        "fixture_label": fixture_label,
        "quantity": o.quantity,
        "unit_price": o.unit_price,
        "total_price": o.total_price,
        "vendor": o.vendor,
        "status": o.status,
        "ordered_at": _fmt_dt(o.ordered_at),
        "arrived_at": _fmt_dt(o.arrived_at),
        "note": o.note,
        "created_at": _fmt_dt(o.created_at),
    }


@router.get("/", response_model=list[PurchaseOrderOut])
def list_purchase_orders(status: Optional[str] = None):
    """列出採購清單，可用 ?status=pending/arrived/cancelled 篩選"""
    with SessionLocal() as db:
        q = db.query(PurchaseOrder)
        if status:
            q = q.filter(PurchaseOrder.status == status)
        orders = q.order_by(PurchaseOrder.created_at.desc()).all()
        fixture_ids = {o.fixture_id for o in orders}
        fixtures = {f.id: f for f in db.query(Fixture).filter(Fixture.id.in_(fixture_ids)).all()}
        return [_order_to_dict(o, fixtures) for o in orders]


class PurchaseOrderCreate(BaseModel):
    fixture_id: int
    quantity: int
    vendor: Optional[str] = None
    unit_price: Optional[float] = None
    note: Optional[str] = None


@router.post("/", response_model=PurchaseOrderOut)
def create_purchase_order(body: PurchaseOrderCreate, _: None = Depends(require_admin)):
    """新增採購單（admin only）"""

    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="數量必須大於 0")

    with SessionLocal() as db:
        fixture = db.query(Fixture).filter(Fixture.id == body.fixture_id).first()
        if not fixture:
            raise HTTPException(status_code=404, detail="治具不存在")

        total_price = (
            round(body.unit_price * body.quantity, 2)
            if body.unit_price is not None
            else None
        )
        order = PurchaseOrder(
            fixture_id=body.fixture_id,
            quantity=body.quantity,
            vendor=body.vendor,
            unit_price=body.unit_price,
            total_price=total_price,
            note=body.note,
            status="pending",
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        return _order_to_dict(order, {fixture.id: fixture})


class PurchaseOrderUpdate(BaseModel):
    status: Optional[str] = None        # pending / arrived / cancelled
    vendor: Optional[str] = None
    unit_price: Optional[float] = None
    note: Optional[str] = None
    arrived_quantity: Optional[int] = None  # 到貨時填寫，自動累加至治具庫存


@router.patch("/{order_id}", response_model=PurchaseOrderOut)
def update_purchase_order(order_id: int, body: PurchaseOrderUpdate, _: None = Depends(require_admin)):
    """更新採購單；status=arrived 時自動將 arrived_quantity 加入治具庫存（admin only）"""

    with SessionLocal() as db:
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="採購單不存在")

        if body.vendor is not None:
            order.vendor = body.vendor
        if body.unit_price is not None:
            order.unit_price = body.unit_price
            order.total_price = round(body.unit_price * order.quantity, 2)
        if body.note is not None:
            order.note = body.note

        if body.status == "arrived" and order.status != "arrived":
            order.status = "arrived"
            order.arrived_at = datetime.datetime.now(datetime.timezone.utc)
            # 累加庫存
            arrived_qty = body.arrived_quantity if body.arrived_quantity and body.arrived_quantity > 0 else order.quantity
            fixture = db.query(Fixture).filter(Fixture.id == order.fixture_id).first()
            if fixture:
                fixture.total_quantity = (fixture.total_quantity or 0) + arrived_qty
                fixture.shortage = max(0, (fixture.shortage or 0) - arrived_qty)
        elif body.status in ("pending", "cancelled") and body.status is not None:
            order.status = body.status

        db.commit()
        db.refresh(order)
        fixture = db.query(Fixture).filter(Fixture.id == order.fixture_id).first()
        return _order_to_dict(order, {order.fixture_id: fixture})


@router.delete("/{order_id}")
def delete_purchase_order(order_id: int, _: None = Depends(require_admin)):
    """刪除採購單（admin only，僅限 pending 狀態）"""

    with SessionLocal() as db:
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="採購單不存在")
        if order.status == "arrived":
            raise HTTPException(status_code=400, detail="已到貨的採購單不可刪除")
        db.delete(order)
        db.commit()
        return {"status": "deleted"}
