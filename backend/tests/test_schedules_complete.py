"""
T-09: schedules 模組補充測試
- _complete_schedule（DB 邏輯：排程→DONE、loaned 治具→returned）
- _build_running_until（從 cache 建立執行中設備的估算結束時間）
"""
import datetime
import json

from app.models import Schedule, ScheduleStatus, Fixture, FixtureLoan
from app.schedule_service import (
    _complete_schedule, _build_running_until, _release_schedule_fixtures,
    _est_end_from_device,
)

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


def test_complete_schedule_releases_reserved_fixture(db):
    """尚未借出的 reserved 治具也要釋放，避免直接完成舊資料時永久占用庫存。"""
    s = _seed_schedule(db)
    db.commit()

    reserved_loan = _seed_loan(db, s.id, "reserved")
    reserved_loan_id = reserved_loan.id
    db.commit()

    now = datetime.datetime.now(UTC)
    _complete_schedule(db, s, now)
    db.commit()

    assert db.get(FixtureLoan, reserved_loan_id) is None


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


def _running_sop_json() -> str:
    return json.dumps({
        "ramp_rate": 2.0, "dwell_time_hours": 1.0,
        "cycles": 1, "high_temperature": 85.0, "low_temperature": None,
    })


def test_build_running_until_running_with_end_included():
    """RUNNING 設備能算出結束時間 → 出現在結果中（走 started_at + active_sop_json 真路徑，
    不再餵生產環境從不寫進 cache 的 estimated_end_at）"""
    cache = {
        "CH-01": {
            "status": "RUNNING",
            "started_at": datetime.datetime.now(UTC).isoformat(),
            "active_sop_json": _running_sop_json(),
        }
    }
    result = _build_running_until(cache)
    assert "CH-01" in result
    assert isinstance(result["CH-01"], datetime.datetime)


def test_build_running_until_multiple_devices():
    """混合 IDLE + RUNNING → 只有 RUNNING 出現"""
    cache = {
        "CH-01": {"status": "IDLE"},
        "CH-02": {
            "status": "RUNNING",
            "started_at": datetime.datetime.now(UTC).isoformat(),
            "active_sop_json": _running_sop_json(),
        },
    }
    result = _build_running_until(cache)
    assert "CH-01" not in result
    assert "CH-02" in result


# ── _est_end_from_device：暫停時間要扣回去 ──────────────────────────────────────

# 曲線時長 = 2h（high==ambient 不升降溫，只有 2h dwell）
_PAUSE_SOP = json.dumps({
    "ramp_rate": 1.0, "dwell_time_hours": 2.0, "cycles": 1,
    "high_temperature": 25.0, "low_temperature": None,
})


def test_est_end_settled_pause_pushes_end_out():
    """已結算的暫停（pause_accum_seconds）要讓估算結束時間往後移一樣長"""
    started = datetime.datetime.now(UTC) - datetime.timedelta(hours=1)
    base = {"status": "RUNNING", "started_at": started.isoformat(), "active_sop_json": _PAUSE_SOP}
    est_no_pause = _est_end_from_device(base)
    est_with_pause = _est_end_from_device({**base, "pause_accum_seconds": 1800.0})
    assert abs((est_with_pause - est_no_pause).total_seconds() - 1800.0) < 1.0


def test_est_end_live_pause_grows_with_elapsed():
    """目前仍在暫停：估算要加上這次尚未結算的暫停時間，才不會早排下一筆"""
    now = datetime.datetime.now(UTC)
    started = now - datetime.timedelta(hours=1)
    base = {"status": "RUNNING", "started_at": started.isoformat(), "active_sop_json": _PAUSE_SOP}
    est_running = _est_end_from_device(base)
    paused = {
        **base,
        "status": "PAUSED",
        "paused_at": (now - datetime.timedelta(minutes=20)).isoformat(),
    }
    est_paused = _est_end_from_device(paused)
    # 已暫停約 20 分鐘 → 估算比未暫停版本晚約 20 分鐘
    assert abs((est_paused - est_running).total_seconds() - 1200.0) < 5.0


# ── 刪除排程：治具借出歷史要留著 ────────────────────────────────────────────


def test_delete_schedule_keeps_loan_history(db, api_client):
    """刪排程時，借出中的治具要收回並保留紀錄，不能連借用歷史一起硬刪。

    否則查不到那批治具曾被誰借走、何時歸還（稽核追不回來）。
    """
    import app.schedules as schedules_module
    from app.schedules import router as schedules_router

    with api_client(
        schedules_module, schedules_router, role="admin", user_id=1, username="admin",
            app_state={"AICM_CACHE": {}},
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
