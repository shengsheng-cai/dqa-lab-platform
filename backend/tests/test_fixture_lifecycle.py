"""
治具借還生命週期的數量不變式。

核心不變式：available = total_quantity − loaned − reserved − damaged，且恆 ≥ 0；
任何借出/歸還操作都不得讓 available 被灌大或讓庫存被超借。
"""
import datetime
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.fixtures as fixtures_module
import app.schedules as schedules_module
from app.fixtures import LoanCreate, router as fixtures_router
from app.schedules import SchedulePatch, router as schedules_router
from app.models import Fixture, FixtureLoan, Schedule, ScheduleFixture, ScheduleStatus


@pytest.fixture()
def admin_client(api_client):
    with api_client(fixtures_module, fixtures_router, role="admin", user_id=1, username="admin") as (client, Session):
        yield client, Session


@pytest.fixture()
def schedule_client(api_client):
    """排程 router 的 admin client——治具預約是從「確認排程」這條路建立的。"""
    with api_client(
        schedules_module, schedules_router, role="admin", user_id=1, username="admin",
        app_state={"AICM_CACHE": {}},
    ) as (client, Session):
        yield client, Session


def _post_schedule(client, fixture_id: int, quantity: int, project: str = "P-1"):
    return client.post("/api/schedules", json={
        "project_number": project, "sample_name": "s", "standard": "IEC 60068",
        "conditions": ["iec60068_ab_-40_16h"],
        "fixtures": [{"fixture_id": fixture_id, "quantity": quantity}],
    })


def _apply_schedule(client, fixture_id: int, quantity: int, project: str = "P-1") -> int:
    resp = _post_schedule(client, fixture_id, quantity, project)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _confirm_schedule(client, schedule_id: int, device_id: str):
    """確認排程並指定未來時段——時間到了才啟動，這裡只驗預約階段。"""
    start = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(days=1)
    return client.patch(f"/api/schedules/{schedule_id}", json={
        "status": ScheduleStatus.CONFIRMED.value,
        "device_id": device_id,
        "start_time": start.isoformat(),
        "end_time": (start + datetime.timedelta(hours=20)).isoformat(),
    })


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


def test_manual_loan_and_schedule_cannot_both_claim_last_fixture(patched_session):
    """手動借出與排程預約同時搶最後一件時，只能有一筆成功。

    兩條路都是「先讀庫存、再寫借出」。沒有原子配置鎖時，兩個執行緒會各自讀到
    available=1 就放行，接著各自提交，最後留下兩筆有效借出、庫存被超借。
    """
    with patched_session("app.fixtures", "app.schedules") as Session:
        with Session() as db:
            fixture = Fixture(
                interface_type="USB",
                form_factor="Desktop",
                total_quantity=1,
                shortage=0,
                is_active=True,
            )
            schedule = Schedule(
                project_number="P-CONCURRENT",
                sample_name="sample",
                standard="IEC 60068",
                conditions='["iec60068_ab_-40_16h"]',
                status=ScheduleStatus.PENDING,
            )
            db.add_all((fixture, schedule))
            db.flush()
            fixture_id = fixture.id
            schedule_id = schedule.id
            db.add(ScheduleFixture(schedule_id=schedule_id, fixture_id=fixture_id, quantity=1))
            db.commit()

        start = threading.Barrier(2)

        def run(operation):
            request = SimpleNamespace(
                state=SimpleNamespace(user_id=1, username="admin", user_role="admin")
            )
            start.wait()
            try:
                if operation == "manual":
                    fixtures_module.create_loan(
                        LoanCreate(
                            fixture_id=fixture_id,
                            borrower_name="手動借用",
                            quantity=1,
                        ),
                        request,
                        None,
                    )
                else:
                    start_time = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
                    schedules_module._patch_schedule_db(
                        schedule_id,
                        SchedulePatch(
                            status=ScheduleStatus.CONFIRMED,
                            device_id="CH-01",
                            start_time=start_time,
                            end_time=start_time + datetime.timedelta(hours=20),
                        ),
                        1,
                        "admin",
                        {},
                    )
                return 200
            except HTTPException as exc:
                return exc.status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = sorted(executor.map(run, ("manual", "schedule")))

        assert statuses == [200, 400]
        with Session() as db:
            active = db.query(FixtureLoan).filter(
                FixtureLoan.fixture_id == fixture_id,
                FixtureLoan.status.in_(("loaned", "reserved")),
            ).all()
            assert sum(loan.quantity for loan in active) == 1


def test_loan_over_stock_is_rejected(admin_client):
    """借超過庫存必須被拒。"""
    client, Session = admin_client
    fid = _seed_fixture(Session, total=5)

    resp = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "貪心", "quantity": 6,
    })

    assert resp.status_code == 400
    assert _available(client, fid) == 5


def test_loan_guard_counts_reserved_and_damaged(admin_client):
    """借出守門要跟總表算同一套：預約中與損壞也占用庫存。

    總表顯示與借出檢查曾經各寫一份算式，改動時只改到一邊就會出現
    「畫面說借得到、按下去被擋」。這條同時對兩邊作證：總表報幾件，
    就真的能借幾件，多一件要被擋。
    """
    client, Session = admin_client
    fid = _seed_fixture(Session, total=10)
    with Session() as db:
        db.add(FixtureLoan(fixture_id=fid, borrower_name="預約", quantity=3, status="reserved"))
        db.add(FixtureLoan(fixture_id=fid, borrower_name="壞掉", quantity=2, status="damaged"))
        db.commit()

    assert _available(client, fid) == 5

    over = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "貪心", "quantity": 6,
    })
    assert over.status_code == 400, "總表說只剩 5 件，借 6 件卻沒被擋——兩邊算式不一致"

    ok = client.post("/api/fixtures/loans", json={
        "fixture_id": fid, "borrower_name": "剛好", "quantity": 5,
    })
    assert ok.status_code == 200, "總表說剩 5 件，借 5 件卻被擋——兩邊算式不一致"
    assert _available(client, fid) == 0


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


def test_schedule_reservation_rejects_negative_quantity(schedule_client):
    """排程預約治具的負數量必須被拒——否則轉為 reserved 借出時同樣灌大庫存，繞過 create_loan 守衛。"""
    client, Session = schedule_client
    with Session() as db:
        db.add(Fixture(interface_type="USB", form_factor="Desktop", total_quantity=5, is_active=True))
        db.commit()

    resp = _post_schedule(client, fixture_id=1, quantity=-5)

    assert resp.status_code == 400, f"負數預約應被拒，實際 {resp.status_code}"


def test_schedule_confirm_rejects_reservation_over_stock(schedule_client):
    """兩張排程預約同一支治具、加起來超過庫存時，第二張確認要被擋。

    手動借出有守門，排程確認以前沒有：兩張都確認成功，可借量被扣到 0，
    真正缺料是到了現場才發現。這條同時驗「剛好用完可以」與「多一件被擋」。
    """
    client, Session = schedule_client
    with Session() as db:
        db.add(Fixture(interface_type="USB", form_factor="Desktop", total_quantity=2, is_active=True))
        db.commit()

    first = _apply_schedule(client, fixture_id=1, quantity=2, project="P-1")
    second = _apply_schedule(client, fixture_id=1, quantity=1, project="P-2")

    ok = _confirm_schedule(client, first, "CH-01")
    assert ok.status_code == 200, f"庫存剛好夠的排程被擋：{ok.text}"

    over = _confirm_schedule(client, second, "CH-02")
    assert over.status_code == 400, "庫存已用完，第二張排程仍確認成功——預約沒有守門"
    assert "USB" in over.json()["detail"], "錯誤訊息要說是哪支治具不夠"

    with Session() as db:
        assert db.get(Schedule, second).status == ScheduleStatus.PENDING, "被擋下的排程不得留在已確認"
        assert db.query(FixtureLoan).filter(FixtureLoan.schedule_id == second).count() == 0, (
            "被擋下的排程不得留下預約紀錄"
        )
        reserved = db.query(FixtureLoan).filter(FixtureLoan.schedule_id == first).all()
        assert [loan.quantity for loan in reserved] == [2], "先確認的排程應保留 2 件預約"


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
