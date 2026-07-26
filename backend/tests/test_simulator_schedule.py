"""
T-05: 模擬器與排程連動邏輯測試

排程推進的兩個入口住在 schedule_service（設備一報「條件結束了」就呼叫），
本檔對「真的那兩支函式」作證，不再自己重抄一份 DB 操作來測自己：
- advance_running_condition：RUNNING 設備自然完成一個條件 → 只推進索引，等人員確認
- complete_running_schedule：RUNNING 設備手動收尾 → 排程標已完成 + 借出治具歸還
- 兩者都不得用 device_id 誤動同機台「未來的已確認排程」

另含 DeviceBlockedPeriod 查詢時段過濾（與排程啟動時的可用性判斷相關）。
"""
import datetime

from app.models import DeviceBlockedPeriod, Schedule, ScheduleStatus, Fixture, FixtureLoan
from app.schedule_service import advance_running_condition, complete_running_schedule


def _now_naive() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC).replace(tzinfo=None)


# ── DeviceBlockedPeriod 查詢邏輯 ──────────────────────────────────────────────


def _query_blocked(db, device_id: str, now: datetime.datetime):
    return (
        db.query(DeviceBlockedPeriod)
        .filter(
            DeviceBlockedPeriod.device_id == device_id,
            DeviceBlockedPeriod.start_time <= now,
            DeviceBlockedPeriod.end_time > now,
        )
        .first()
    )


def test_blocked_period_covers_now(db):
    """now 落在封鎖時段內 → 應被查到"""
    now = _now_naive()
    db.add(DeviceBlockedPeriod(
        device_id="CH-01",
        start_time=now - datetime.timedelta(hours=1),
        end_time=now + datetime.timedelta(hours=1),
        reason="維修中",
    ))
    db.commit()

    result = _query_blocked(db, "CH-01", now)
    assert result is not None
    assert result.reason == "維修中"


def test_blocked_period_past_not_returned(db):
    """封鎖時段已結束 → 不應被查到"""
    now = _now_naive()
    db.add(DeviceBlockedPeriod(
        device_id="CH-01",
        start_time=now - datetime.timedelta(hours=2),
        end_time=now - datetime.timedelta(hours=1),
    ))
    db.commit()

    assert _query_blocked(db, "CH-01", now) is None


def test_blocked_period_future_not_returned(db):
    """封鎖時段尚未開始 → 不應被查到"""
    now = _now_naive()
    db.add(DeviceBlockedPeriod(
        device_id="CH-01",
        start_time=now + datetime.timedelta(hours=1),
        end_time=now + datetime.timedelta(hours=2),
    ))
    db.commit()

    assert _query_blocked(db, "CH-01", now) is None


def test_blocked_period_different_device_not_returned(db):
    """CH-02 的封鎖 → 查 CH-01 時不應被查到"""
    now = _now_naive()
    db.add(DeviceBlockedPeriod(
        device_id="CH-02",
        start_time=now - datetime.timedelta(hours=1),
        end_time=now + datetime.timedelta(hours=1),
    ))
    db.commit()

    assert _query_blocked(db, "CH-01", now) is None


# ── 排程推進：只挑 RUNNING，不誤動未來的已確認排程 ────────────────────────────


def _seed_future_confirmed_schedule(Session, device_id="CH-01") -> int:
    with Session() as db:
        schedule = Schedule(
            project_number="FUTURE",
            sample_name="Future sample",
            standard="IEC",
            conditions='["sop_a"]',
            status=ScheduleStatus.CONFIRMED,
            device_id=device_id,
            start_time=_now_naive() + datetime.timedelta(days=7),
            end_time=_now_naive() + datetime.timedelta(days=8),
            current_condition_index=0,
        )
        db.add(schedule)
        db.commit()
        return schedule.id


def _seed_running_schedule_with_loan(
    Session, device_id="CH-01", conditions='["sop_a", "sop_b"]', loan_status="loaned"
) -> tuple[int, int]:
    """建立進行中排程 + 一筆治具借用列，回傳 (schedule_id, loan_id)。
    loan_status="loaned" 為已借出（帶借出時間）；"reserved" 為尚未借出的預約。"""
    with Session() as db:
        f = Fixture(interface_type="USB", form_factor="Desktop", total_quantity=2)
        db.add(f)
        db.flush()
        s = Schedule(
            project_number="P001", sample_name="Sample",
            standard="IEC", conditions=conditions,
            status=ScheduleStatus.RUNNING, device_id=device_id,
            start_time=_now_naive() - datetime.timedelta(hours=2),
            end_time=_now_naive() + datetime.timedelta(hours=1),
            current_condition_index=0,
        )
        db.add(s)
        db.flush()
        loan = FixtureLoan(
            fixture_id=f.id, schedule_id=s.id,
            borrower_name="排程系統", quantity=1,
            status=loan_status,
            loan_date=_now_naive() if loan_status == "loaned" else None,
        )
        db.add(loan)
        db.commit()
        return s.id, loan.id


def test_ad_hoc_natural_completion_does_not_advance_future_schedule(patched_session):
    """臨時 SOP 自然完成時，不得用 device_id 誤改同機台的未來排程。"""
    with patched_session("app.schedule_service") as Session:
        schedule_id = _seed_future_confirmed_schedule(Session)

        result = advance_running_condition("CH-01")

        assert result is None
        with Session() as db:
            schedule = db.get(Schedule, schedule_id)
            assert schedule.status == ScheduleStatus.CONFIRMED
            assert schedule.current_condition_index == 0


def test_ad_hoc_manual_stop_does_not_complete_future_schedule(patched_session):
    """臨時 SOP 手動收尾時，不得把同機台的未來排程直接標成 DONE。"""
    with patched_session("app.schedule_service") as Session:
        schedule_id = _seed_future_confirmed_schedule(Session)

        result = complete_running_schedule("CH-01", _now_naive())

        assert result is None
        with Session() as db:
            schedule = db.get(Schedule, schedule_id)
            assert schedule.status == ScheduleStatus.CONFIRMED
            assert schedule.current_condition_index == 0


# ── 自然完成一個條件：只推進索引，排程續為進行中 ──────────────────────────────


def test_advance_running_condition_bumps_index_without_completing(patched_session):
    """自然完成一個條件 → 索引 +1、回傳結構化進度；排程續為進行中、治具不歸還。"""
    with patched_session("app.schedule_service") as Session:
        schedule_id, loan_id = _seed_running_schedule_with_loan(Session)

        result = advance_running_condition("CH-01")

        assert result is not None
        assert result.schedule_id == schedule_id
        assert result.new_index == 1
        assert result.total == 2
        assert result.project_number == "P001"
        with Session() as db:
            s = db.get(Schedule, schedule_id)
            assert s.status == ScheduleStatus.RUNNING   # 未完成，等人員確認下一步
            assert s.current_condition_index == 1
            assert db.get(FixtureLoan, loan_id).status == "loaned"  # 治具還沒歸還


# ── 手動收尾：排程標已完成 + 借出治具歸還 ─────────────────────────────────────


def test_complete_running_schedule_marks_done_and_returns_fixture(patched_session):
    """手動收尾 → 排程標為已完成、借出治具改 returned，回傳結構化結果。"""
    with patched_session("app.schedule_service") as Session:
        schedule_id, loan_id = _seed_running_schedule_with_loan(Session)

        result = complete_running_schedule("CH-01", _now_naive())

        assert result is not None
        assert result.schedule_id == schedule_id
        assert result.device_id == "CH-01"
        assert result.project_number == "P001"
        assert result.sample_name == "Sample"
        with Session() as db:
            assert db.get(Schedule, schedule_id).status == ScheduleStatus.DONE
            loan = db.get(FixtureLoan, loan_id)
            assert loan.status == "returned"
            assert loan.return_date is not None


def test_complete_running_schedule_leaves_reserved_fixture_released(patched_session):
    """收尾時尚未借出（reserved）的治具要被釋放（刪除預約），不留卡住的占用。"""
    with patched_session("app.schedule_service") as Session:
        schedule_id, reserved_id = _seed_running_schedule_with_loan(
            Session, device_id="CH-02", conditions='["sop_b"]', loan_status="reserved"
        )

        result = complete_running_schedule("CH-02", _now_naive())

        assert result is not None
        with Session() as db:
            assert db.get(Schedule, schedule_id).status == ScheduleStatus.DONE
            assert db.get(FixtureLoan, reserved_id) is None   # 預約被刪除釋放
