"""
T-15: fixtures API 補充測試
- delete_fixture：有 reserved/loaned 借用時不可刪除
- update_inventory：負數盤點擋下、歸零合法
"""
import datetime

import pytest

from app.fixtures import router as fixtures_router
from app.models import Fixture, FixtureLoan


@pytest.fixture()
def admin_client(api_client):
    import app.fixtures as fixtures_module
    with api_client(fixtures_module, fixtures_router) as (client, Session):
        yield client, Session


def _seed_fixture_with_loan(Session, loan_status: str) -> int:
    with Session() as db:
        fixture = Fixture(
            interface_type="USB",
            form_factor="Desktop",
            total_quantity=5,
            shortage=0,
            is_active=True,
        )
        db.add(fixture)
        db.flush()
        db.add(
            FixtureLoan(
                fixture_id=fixture.id,
                borrower_name="測試人員",
                quantity=1,
                status=loan_status,
                loan_date=datetime.datetime.now(),
            )
        )
        db.commit()
        return fixture.id


def test_delete_fixture_blocks_reserved_loan(admin_client):
    client, Session = admin_client
    fixture_id = _seed_fixture_with_loan(Session, "reserved")

    resp = client.delete(f"/api/fixtures/{fixture_id}")

    assert resp.status_code == 400
    assert "借出/預約未結束" in resp.json()["detail"]


def _seed_plain_fixture(Session, total_quantity: int = 5) -> int:
    with Session() as db:
        fixture = Fixture(
            interface_type="USB",
            form_factor="Desktop",
            total_quantity=total_quantity,
            shortage=0,
            is_active=True,
        )
        db.add(fixture)
        db.commit()
        return fixture.id


def test_inventory_rejects_negative(admin_client):
    """盤點負數 → 400，庫存不變（負庫存會讓可借量計算連鎖出錯）"""
    client, Session = admin_client
    fixture_id = _seed_plain_fixture(Session, total_quantity=5)

    resp = client.post(f"/api/fixtures/{fixture_id}/inventory?actual_quantity=-1")

    assert resp.status_code == 400
    assert "不可為負數" in resp.json()["detail"]
    with Session() as db:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        assert f.total_quantity == 5  # 未被改動


def test_inventory_allows_zero(admin_client):
    """盤點歸零（0）合法 → 200，庫存變 0"""
    client, Session = admin_client
    fixture_id = _seed_plain_fixture(Session, total_quantity=5)

    resp = client.post(f"/api/fixtures/{fixture_id}/inventory?actual_quantity=0")

    assert resp.status_code == 200
    with Session() as db:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        assert f.total_quantity == 0


def test_inventory_log_rejects_negative(admin_client):
    """第二道門：POST /inventory-logs 負數也要被 _apply_inventory_db 守住 → 400，庫存不變"""
    client, Session = admin_client
    fixture_id = _seed_plain_fixture(Session, total_quantity=5)

    resp = client.post(
        f"/api/fixtures/inventory-logs?fixture_id={fixture_id}&actual_quantity=-1"
    )

    assert resp.status_code == 400
    assert "不可為負數" in resp.json()["detail"]
    with Session() as db:
        f = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        assert f.total_quantity == 5
