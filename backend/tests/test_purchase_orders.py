"""
T-07: purchase_orders 模組純函數與業務邏輯測試
- _fmt_dt（純函數）
- _order_to_dict（純函數）
- arrived 到貨庫存累加邏輯（db fixture）
"""
import datetime
from types import SimpleNamespace

import pytest

from app.models import Fixture, PurchaseOrder
from app.purchase_orders import _fmt_dt, _order_to_dict, router as purchase_orders_router


@pytest.fixture()
def admin_client(api_client):
    import app.purchase_orders as purchase_orders_module

    with api_client(
        purchase_orders_module,
        purchase_orders_router,
        role="admin",
        user_id=1,
        username="admin",
    ) as (client, Session):
        yield client, Session


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


def test_arrived_order_cannot_reopen_and_add_stock_twice(admin_client):
    """真實 route：已到貨是終態，不能切回 pending 後再次入庫。"""
    client, Session = admin_client
    with Session() as db:
        fixture = _seed_fixture(db, total_quantity=10, shortage=0)
        order = _seed_order(db, fixture.id, quantity=3)
        db.commit()
        fixture_id, order_id = fixture.id, order.id

    first_arrival = client.patch(
        f"/api/purchase-orders/{order_id}",
        json={"status": "arrived"},
    )
    reopen = client.patch(
        f"/api/purchase-orders/{order_id}",
        json={"status": "pending"},
    )
    repeat_arrival = client.patch(
        f"/api/purchase-orders/{order_id}",
        json={"status": "arrived"},
    )

    assert first_arrival.status_code == 200
    assert reopen.status_code == 409
    assert repeat_arrival.status_code == 200
    with Session() as db:
        fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        assert fixture.total_quantity == 13


def test_cancelled_order_is_terminal_and_cannot_be_deleted(admin_client):
    """取消單保留作結案紀錄，不可重開或刪除。"""
    client, Session = admin_client
    with Session() as db:
        fixture = _seed_fixture(db)
        order = _seed_order(db, fixture.id, quantity=3, status="cancelled")
        db.commit()
        order_id = order.id

    reopen = client.patch(
        f"/api/purchase-orders/{order_id}",
        json={"status": "pending"},
    )
    delete = client.delete(f"/api/purchase-orders/{order_id}")

    assert reopen.status_code == 409
    assert delete.status_code == 400
    with Session() as db:
        assert db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()


def test_update_rejects_invalid_status(admin_client):
    client, Session = admin_client
    with Session() as db:
        fixture = _seed_fixture(db)
        order = _seed_order(db, fixture.id, quantity=3)
        db.commit()
        order_id = order.id

    response = client.patch(
        f"/api/purchase-orders/{order_id}",
        json={"status": "unknown"},
    )

    assert response.status_code == 400


@pytest.mark.parametrize("arrived_quantity", [0, -1])
def test_arrival_rejects_nonpositive_quantity(admin_client, arrived_quantity):
    client, Session = admin_client
    with Session() as db:
        fixture = _seed_fixture(db, total_quantity=10, shortage=0)
        order = _seed_order(db, fixture.id, quantity=3)
        db.commit()
        order_id = order.id

    resp = client.patch(
        f"/api/purchase-orders/{order_id}",
        json={"status": "arrived", "arrived_quantity": arrived_quantity},
    )

    assert resp.status_code == 400
