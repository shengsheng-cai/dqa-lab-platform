"""
T-07: purchase_orders 模組純函數與業務邏輯測試
- _fmt_dt（純函數）
- _order_to_dict（純函數）
- arrived 到貨庫存累加邏輯（db fixture）
"""
import datetime
import pytest
from types import SimpleNamespace
from app.models import Fixture, PurchaseOrder
from app.purchase_orders import _fmt_dt, _order_to_dict


# ── _fmt_dt ────────────────────────────────────────────────────────────────


def test_fmt_dt_none():
    assert _fmt_dt(None) is None


def test_fmt_dt_formats_correctly():
    dt = datetime.datetime(2024, 6, 15, 9, 30, 0)
    assert _fmt_dt(dt) == "2024-06-15 09:30:00"


def test_fmt_dt_midnight():
    dt = datetime.datetime(2025, 1, 1, 0, 0, 0)
    assert _fmt_dt(dt) == "2025-01-01 00:00:00"


# ── _order_to_dict ─────────────────────────────────────────────────────────


def _make_order(**kwargs) -> SimpleNamespace:
    """用 SimpleNamespace 模擬 PurchaseOrder，_order_to_dict 只讀屬性不需要 ORM"""
    defaults = {
        "id": 1,
        "fixture_id": 1,
        "quantity": 5,
        "unit_price": None,
        "total_price": None,
        "vendor": None,
        "status": "pending",
        "ordered_at": None,
        "arrived_at": None,
        "note": None,
        "created_at": datetime.datetime(2024, 1, 1),
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _make_fixture(interface_type="USB", form_factor="Desktop") -> SimpleNamespace:
    return SimpleNamespace(id=1, interface_type=interface_type, form_factor=form_factor)


def test_order_to_dict_with_fixture():
    o = _make_order()
    f = _make_fixture("RS-232", "PCI Card")
    result = _order_to_dict(o, {1: f})
    assert result["fixture_label"] == "RS-232 / PCI Card"


def test_order_to_dict_without_fixture():
    """找不到 fixture 時，label 顯示 ID:xxx"""
    o = _make_order(fixture_id=99)
    result = _order_to_dict(o, {})
    assert result["fixture_label"] == "ID:99"


def test_order_to_dict_total_price():
    o = _make_order(unit_price=150.0, total_price=750.0, quantity=5)
    result = _order_to_dict(o, {})
    assert result["total_price"] == 750.0
    assert result["quantity"] == 5


def test_order_to_dict_status():
    o = _make_order(status="arrived")
    result = _order_to_dict(o, {})
    assert result["status"] == "arrived"


# ── arrived 到貨庫存累加邏輯 ──────────────────────────────────────────────
# 直接在 db 操作，模擬 update_purchase_order 的核心業務邏輯


def _seed_fixture(db, total_quantity=10, shortage=0) -> Fixture:
    f = Fixture(
        interface_type="USB", form_factor="Desktop",
        total_quantity=total_quantity, shortage=shortage,
    )
    db.add(f)
    db.flush()
    return f


def _seed_order(db, fixture_id: int, quantity: int, status="pending") -> PurchaseOrder:
    o = PurchaseOrder(
        fixture_id=fixture_id,
        quantity=quantity,
        status=status,
    )
    db.add(o)
    db.flush()
    return o


def _apply_arrived(db, order: PurchaseOrder, arrived_quantity=None):
    """模擬 update_purchase_order 的 arrived 累加邏輯"""
    if order.status == "arrived":
        return  # 已到貨不重複累加
    order.status = "arrived"
    order.arrived_at = datetime.datetime.now(datetime.timezone.utc)
    arrived_qty = arrived_quantity if arrived_quantity and arrived_quantity > 0 else order.quantity
    fixture = db.query(Fixture).filter(Fixture.id == order.fixture_id).first()
    if fixture:
        fixture.total_quantity = (fixture.total_quantity or 0) + arrived_qty
        fixture.shortage = max(0, (fixture.shortage or 0) - arrived_qty)
    db.commit()


def test_arrived_adds_to_total_quantity(db):
    """到貨 → fixture.total_quantity 增加"""
    f = _seed_fixture(db, total_quantity=10, shortage=0)
    o = _seed_order(db, f.id, quantity=3)
    db.commit()

    _apply_arrived(db, o)
    db.refresh(f)
    assert f.total_quantity == 13


def test_arrived_uses_arrived_quantity_when_given(db):
    """指定 arrived_quantity=2，order.quantity=5 → 只加 2"""
    f = _seed_fixture(db, total_quantity=10, shortage=0)
    o = _seed_order(db, f.id, quantity=5)
    db.commit()

    _apply_arrived(db, o, arrived_quantity=2)
    db.refresh(f)
    assert f.total_quantity == 12


def test_arrived_deducts_shortage(db):
    """shortage=3，到貨 3 → shortage 歸零"""
    f = _seed_fixture(db, total_quantity=10, shortage=3)
    o = _seed_order(db, f.id, quantity=3)
    db.commit()

    _apply_arrived(db, o)
    db.refresh(f)
    assert f.shortage == 0


def test_arrived_shortage_not_negative(db):
    """到貨數量超過 shortage → shortage 最小為 0"""
    f = _seed_fixture(db, total_quantity=10, shortage=2)
    o = _seed_order(db, f.id, quantity=10)
    db.commit()

    _apply_arrived(db, o)
    db.refresh(f)
    assert f.shortage == 0


def test_arrived_twice_not_double_counted(db):
    """已是 arrived 的訂單再次呼叫 → 不重複累加"""
    f = _seed_fixture(db, total_quantity=10, shortage=0)
    o = _seed_order(db, f.id, quantity=5, status="arrived")
    db.commit()

    _apply_arrived(db, o)  # 已是 arrived，早期 return
    db.refresh(f)
    assert f.total_quantity == 10  # 沒有被累加
