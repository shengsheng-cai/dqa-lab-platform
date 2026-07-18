"""
治具借還生命週期的數量不變式。

核心不變式：available = total_quantity − loaned − reserved − damaged，且恆 ≥ 0；
任何借出/歸還操作都不得讓 available 被灌大或讓庫存被超借。
"""
import pytest

import app.fixtures as fixtures_module
from app.fixtures import router as fixtures_router
from app.models import Fixture


@pytest.fixture()
def admin_client(api_client):
    with api_client(fixtures_module, fixtures_router, role="admin", user_id=1, username="admin") as (client, Session):
        yield client, Session


def _seed_fixture(Session, total=5) -> int:
    with Session() as db:
        f = Fixture(interface_type="USB", form_factor="Desktop", total_quantity=total, shortage=0, is_active=True)
        db.add(f)
        db.commit()
        return f.id


def _available(client, fixture_id) -> int:
    resp = client.get("/api/fixtures")
    assert resp.status_code == 200
    for row in resp.json():
        if row["id"] == fixture_id:
            return row["available_quantity"]
    raise AssertionError(f"治具 {fixture_id} 不在列表中")


# ── 借出數量的邊界 ────────────────────────────────────────────────────────────


def test_loan_rejects_negative_quantity(admin_client):
    """借出負數量必須被拒。否則負數灌進 loaned 加總會放大可借量 → 可超借。"""
    client, Session = admin_client
    fid = _seed_fixture(Session, total=5)

    resp = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "壞人", "quantity": -5,
    })

    assert resp.status_code == 400, (
        f"負數借出應被拒，實際 {resp.status_code}；"
        f"借出 -5 後可借量變為 {_available(client, fid)}（應仍為 5）"
    )
    assert _available(client, fid) == 5


def test_loan_rejects_zero_quantity(admin_client):
    """借出 0 件無意義，應被拒。"""
    client, Session = admin_client
    fid = _seed_fixture(Session, total=5)

    resp = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "無聊", "quantity": 0,
    })

    assert resp.status_code == 400


def test_loan_within_stock_succeeds_and_reduces_available(admin_client):
    """正常借出：可借量對應減少。"""
    client, Session = admin_client
    fid = _seed_fixture(Session, total=5)

    resp = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "正常", "quantity": 3,
    })

    assert resp.status_code == 200
    assert _available(client, fid) == 2


def test_loan_over_stock_is_rejected(admin_client):
    """借超過庫存必須被拒。"""
    client, Session = admin_client
    fid = _seed_fixture(Session, total=5)

    resp = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "貪心", "quantity": 6,
    })

    assert resp.status_code == 400
    assert _available(client, fid) == 5


def test_return_restores_available(admin_client):
    """正常歸還後可借量還原。"""
    client, Session = admin_client
    fid = _seed_fixture(Session, total=5)
    r = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "正常", "quantity": 3,
    })
    loan_id = r.json()["loan_id"]
    assert _available(client, fid) == 2

    resp = client.post(f"/api/fixtures/loans/{loan_id}/return", json={"return_condition": "normal"})

    assert resp.status_code == 200
    assert _available(client, fid) == 5


def test_schedule_reservation_rejects_negative_quantity(api_client):
    """排程預約治具的負數量必須被拒——否則轉為 reserved 借出時同樣灌大庫存，繞過 create_loan 守衛。"""
    import app.schedules as schedules_module
    from app.schedules import router as schedules_router

    with api_client(
        schedules_module, schedules_router, role="admin", user_id=1, username="admin",
        app_state={"AICM_CACHE": {}, "DEVICE_LOCKS": {}},
    ) as (client, Session):
        with Session() as db:
            db.add(Fixture(interface_type="USB", form_factor="Desktop", total_quantity=5, is_active=True))
            db.commit()

        resp = client.post("/api/schedules", json={
            "project_number": "P-1", "sample_name": "s", "standard": "IEC 60068",
            "conditions": ["iec60068_ab_-40_16h"],
            "fixtures": [{"fixture_id": 1, "quantity": -5}],
        })

        assert resp.status_code == 400, f"負數預約應被拒，實際 {resp.status_code}"


def test_double_return_is_rejected(admin_client):
    """同一筆借出不得重複歸還。"""
    client, Session = admin_client
    fid = _seed_fixture(Session, total=5)
    r = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "正常", "quantity": 3,
    })
    loan_id = r.json()["loan_id"]
    client.post(f"/api/fixtures/loans/{loan_id}/return", json={"return_condition": "normal"})

    resp = client.post(f"/api/fixtures/loans/{loan_id}/return", json={"return_condition": "normal"})

    assert resp.status_code == 400
    assert _available(client, fid) == 5, "重複歸還不得再次影響庫存"
