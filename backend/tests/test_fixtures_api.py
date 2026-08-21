"""
T-15: fixtures API 補充測試
- delete_fixture：有 reserved/loaned 借用時不可刪除
- update_inventory：負數盤點擋下、歸零合法
- create_loan：借用人指到不存在的帳號要被擋
"""
import datetime

import pytest

from app.fixtures import router as fixtures_router
from app.models import Fixture, FixtureInventoryLog, FixtureLoan
from app.utils import _now_utc_naive


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


def _seed_loan_due_at(Session, fixture_id: int, due: datetime.datetime, borrower: str) -> None:
    with Session() as db:
        db.add(FixtureLoan(
            fixture_id=fixture_id,
            borrower_name=borrower,
            quantity=1,
            status="loaned",
            loan_date=datetime.datetime.now(),
            due_date=due,
        ))
        db.commit()


def test_summary_due_today_uses_caller_day_window(admin_client):
    """「今日到期」要照呼叫端給的日界算，不是照 UTC 當天。

    後端存 naive UTC、也不知道使用者在哪個時區。台北凌晨 0–8 點時 UTC 還是前一天，
    用 UTC 日界會把昨天到期的算成今天的。
    """
    client, Session = admin_client
    fixture_id = _seed_fixture_with_loan(Session, "reserved")

    # 刻意用一個不是「今天」的日期：台北 2026-01-15 整天 = UTC 1/14 16:00 起算 24 小時。
    # 這樣後端若忽略參數、改用 UTC 當日，這條就會抓到 0 筆而失敗。
    day_start = datetime.datetime(2026, 1, 14, 16, 0, 0)
    day_end = datetime.datetime(2026, 1, 15, 15, 59, 59, 999000)
    _seed_loan_due_at(Session, fixture_id, datetime.datetime(2026, 1, 15, 15, 0, 0), "台北 1/15 到期")
    _seed_loan_due_at(Session, fixture_id, datetime.datetime(2026, 1, 14, 15, 0, 0), "台北 1/14 到期")

    resp = client.get("/api/fixtures/summary", params={
        "due_from": day_start.isoformat() + "Z",
        "due_to": day_end.isoformat() + "Z",
    })

    assert resp.status_code == 200
    assert resp.json()["due_today"] == 1, "本地日界內只有一筆到期，前一天那筆不該被算進來"


def test_summary_without_window_falls_back_to_utc_day(admin_client):
    """沒帶日界時退回 UTC 當日，舊呼叫端不會壞掉。"""
    client, Session = admin_client
    fixture_id = _seed_fixture_with_loan(Session, "reserved")
    _seed_loan_due_at(Session, fixture_id, _now_utc_naive(), "UTC 今天到期")

    resp = client.get("/api/fixtures/summary")

    assert resp.status_code == 200
    assert resp.json()["due_today"] == 1


def test_delete_fixture_blocks_reserved_loan(admin_client):
    client, Session = admin_client
    fixture_id = _seed_fixture_with_loan(Session, "reserved")

    resp = client.delete(f"/api/fixtures/{fixture_id}")

    assert resp.status_code == 400
    assert "借出/預約未結束" in resp.json()["detail"]


def test_create_loan_rejects_unknown_borrower(admin_client):
    """借用人指到不存在的帳號時回 404，不要讓外鍵把它變成 500。"""
    client, Session = admin_client
    fixture_id = _seed_fixture_with_loan(Session, "returned")

    resp = client.post("/api/fixtures/loans", json={
        "fixture_id": fixture_id,
        "borrower_name": "查無此人",
        "borrower_user_id": 999,
        "quantity": 1,
    })

    assert resp.status_code == 404
    assert resp.json()["detail"] == "使用者不存在"


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
    """第二道門：POST /inventory-logs 也要經生命週期守衛 → 400，庫存不變。"""
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


def test_inventory_log_patch_rejects_negative(admin_client):
    """編輯既有盤點紀錄也必須走同一道守衛，不能把主檔寫成負庫存。"""
    client, Session = admin_client
    fixture_id = _seed_plain_fixture(Session, total_quantity=5)
    with Session() as db:
        log = FixtureInventoryLog(
            fixture_id=fixture_id,
            previous_quantity=5,
            counted_quantity=5,
            difference=0,
            counted_by="admin",
        )
        db.add(log)
        db.commit()
        log_id = log.id

    resp = client.patch(
        f"/api/fixtures/inventory-logs/{log_id}?actual_quantity=-1"
    )

    assert resp.status_code == 400
    assert "不可為負數" in resp.json()["detail"]
    with Session() as db:
        fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
        log = db.query(FixtureInventoryLog).filter(
            FixtureInventoryLog.id == log_id
        ).first()
        assert fixture.total_quantity == 5
        assert log.counted_quantity == 5


def test_create_fixture_rejects_negative_stock(admin_client):
    """新增／編輯 schema 也要擋負數，不能只靠畫面上的 input min。"""
    client, _ = admin_client

    resp = client.post(
        "/api/fixtures/",
        json={
            "interface_type": "USB",
            "form_factor": "Adapter",
            "total_quantity": -1,
            "shortage": 0,
        },
    )

    assert resp.status_code == 422
