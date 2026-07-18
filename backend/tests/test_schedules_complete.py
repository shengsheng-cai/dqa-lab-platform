"""
T-09: schedules 模組補充測試
- _complete_schedule（DB 邏輯：排程→DONE、loaned 治具→returned）
- _build_running_until（從 cache 建立執行中設備的估算結束時間）
"""
import datetime
import json

from app.models import Schedule, ScheduleStatus, Fixture, FixtureLoan
from app.schedule_service import _complete_schedule, _build_running_until, _release_schedule_fixtures

UTC = datetime.timezone.utc


# ── _complete_schedule ─────────────────────────────────────────────────────


def _seed_schedule(db, status=ScheduleStatus.RUNNING) -> Schedule:
    s = Schedule(
        project_number="P-TEST",
        sample_name="Sample",
        standard="IEC",
        conditions='["sop1"]',
        status=status,
        device_id="CH-01",
        start_time=datetime.datetime(2024, 1, 1),
        end_time=datetime.datetime(2024, 1, 2),
    )
    db.add(s)
    db.flush()
    return s


def _seed_loan(db, schedule_id: int, status: str) -> FixtureLoan:
    f = Fixture(interface_type="USB", form_factor="Desktop", total_quantity=5, shortage=0)
    db.add(f)
    db.flush()
    loan = FixtureLoan(
        fixture_id=f.id,
        schedule_id=schedule_id,
        borrower_name="測試人員",
        quantity=1,
        status=status,
        loan_date=datetime.datetime.now(UTC),
    )
    db.add(loan)
    db.flush()
    return loan


def test_complete_schedule_sets_done(db):
    """_complete_schedule 將排程狀態改為 DONE"""
    s = _seed_schedule(db)
    db.commit()

    now = datetime.datetime.now(UTC)
    _complete_schedule(db, s, now)
    db.commit()

    db.refresh(s)
    assert s.status == ScheduleStatus.DONE


def test_complete_schedule_sets_updated_at(db):
    """_complete_schedule 更新 updated_at"""
    s = _seed_schedule(db)
    db.commit()

    now = datetime.datetime(2024, 6, 1, 12, 0, 0, tzinfo=UTC)
    _complete_schedule(db, s, now)
    db.commit()

    db.refresh(s)
    # SQLite 存入時丟棄 tzinfo，比對用 naive datetime
    assert s.updated_at == now.replace(tzinfo=None)


def test_complete_schedule_returns_loaned_fixtures(db):
    """loaned 治具 → 改為 returned，並記錄 return_date"""
    s = _seed_schedule(db)
    db.commit()

    loan = _seed_loan(db, s.id, "loaned")
    db.commit()

    now = datetime.datetime.now(UTC)
    _complete_schedule(db, s, now)
    db.commit()

    db.refresh(loan)
    assert loan.status == "returned"
    assert loan.return_date is not None


def test_complete_schedule_does_not_affect_non_loaned(db):
    """reserved / returned 狀態治具 → 不被 _complete_schedule 異動"""
    s = _seed_schedule(db)
    db.commit()

    reserved_loan = _seed_loan(db, s.id, "reserved")
    db.commit()

    now = datetime.datetime.now(UTC)
    _complete_schedule(db, s, now)
    db.commit()

    db.refresh(reserved_loan)
    assert reserved_loan.status == "reserved"


def test_release_schedule_fixtures_sets_return_date_for_loaned(db):
    """取消進行中排程時，借出治具要同時標為已歸還並留下歸還時間。"""
    s = _seed_schedule(db)
    db.commit()
    loan = _seed_loan(db, s.id, "loaned")
    loan.return_date = None
    db.commit()
    returned_at = datetime.datetime(2026, 7, 18, 12, 0, 0)

    _release_schedule_fixtures(db, s.id, returned_at, return_loaned=True)
    db.commit()

    db.refresh(loan)
    assert loan.status == "returned"
    assert loan.return_date == returned_at


# ── _build_running_until ───────────────────────────────────────────────────


def test_build_running_until_empty_cache():
    assert _build_running_until({}) == {}


def test_build_running_until_idle_excluded():
    """IDLE 設備不應出現在結果中"""
    cache = {"CH-01": {"status": "IDLE"}}
    result = _build_running_until(cache)
    assert "CH-01" not in result


def test_build_running_until_running_with_end_included():
    """RUNNING 設備有 estimated_end_at → 出現在結果中"""
    future = (datetime.datetime.now(UTC) + datetime.timedelta(hours=2)).isoformat()
    cache = {
        "CH-01": {
            "status": "RUNNING",
            "estimated_end_at": future,
            "started_at": datetime.datetime.now(UTC).isoformat(),
            "active_sop_json": json.dumps({
                "ramp_rate": 2.0, "dwell_time_hours": 1.0,
                "cycles": 1, "high_temperature": 85.0, "low_temperature": None,
            }),
        }
    }
    result = _build_running_until(cache)
    assert "CH-01" in result
    assert isinstance(result["CH-01"], datetime.datetime)


def test_build_running_until_multiple_devices():
    """混合 IDLE + RUNNING → 只有 RUNNING 出現"""
    future = (datetime.datetime.now(UTC) + datetime.timedelta(hours=1)).isoformat()
    cache = {
        "CH-01": {"status": "IDLE"},
        "CH-02": {
            "status": "RUNNING",
            "estimated_end_at": future,
        },
    }
    result = _build_running_until(cache)
    assert "CH-01" not in result
    assert "CH-02" in result


# ── 刪除排程：治具借出歷史要留著 ────────────────────────────────────────────


def test_delete_schedule_keeps_loan_history(db, api_client):
    """刪排程時，借出中的治具要收回並保留紀錄，不能連借用歷史一起硬刪。

    否則查不到那批治具曾被誰借走、何時歸還（稽核追不回來）。
    """
    import app.schedules as schedules_module
    from app.schedules import router as schedules_router

    with api_client(
        schedules_module, schedules_router, role="admin", user_id=1, username="admin",
        app_state={"AICM_CACHE": {}, "DEVICE_LOCKS": {}},
    ) as (client, Session):
        with Session() as s_db:
            sched = _seed_schedule(s_db)
            loan = _seed_loan(s_db, sched.id, "loaned")
            s_db.commit()
            sched_id, loan_id = sched.id, loan.id

        resp = client.delete(f"/api/schedules/{sched_id}")
        assert resp.status_code == 200

        with Session() as s_db:
            kept = s_db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first()
            assert kept is not None, "借出紀錄被硬刪了：查不到治具曾被誰借走"
            assert kept.status == "returned", "刪排程時借出中的治具要收回"
            assert kept.return_date is not None, "歸還時間要留下來"
            assert kept.schedule_id is None, "排程已刪除，借用紀錄不該再指向它"
