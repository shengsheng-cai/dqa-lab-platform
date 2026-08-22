"""
T-05: 模擬器與排程連動邏輯測試

排程推進的兩個入口住在 schedule_service（設備一報「條件結束了」就呼叫），
本檔對「真的那兩支函式」作證，不再自己重抄一份 DB 操作來測自己：
- advance_running_condition：RUNNING 設備自然完成一個條件 → 只推進索引，等人員確認
- running_schedule_info：RUNNING 設備手動中止收尾 → 排程與治具都不動，只回報還掛著哪一筆
- 兩者都不得用 device_id 誤動同機台「未來的已確認排程」

另含 DeviceBlockedPeriod 查詢時段過濾（與排程啟動時的可用性判斷相關）。
"""
import datetime

import pytest

from app.models import DeviceBlockedPeriod, Schedule, ScheduleStatus, Fixture, FixtureLoan
from app.schedule_service import advance_running_condition, running_schedule_info
from app.utils import device_blocked_reason_now


def _now_naive() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC).replace(tzinfo=None)


# ── DeviceBlockedPeriod 可用性判斷（對真函式 device_blocked_reason_now 作證）──────
# 以前這幾個測試打的是測試檔裡重抄的一段查詢，改壞真函式也照樣全綠。現在直接呼叫
# utils.device_blocked_reason_now（它自己開 SessionLocal，故 patch app.utils）。


def _seed_block(Session, **fields) -> None:
    with Session() as db:
        db.add(DeviceBlockedPeriod(**fields))
        db.commit()


def test_blocked_period_covers_now(patched_session):
    """now 落在封鎖時段內 → 回傳原因字串"""
    with patched_session("app.utils") as Session:
        now = _now_naive()
        _seed_block(
            Session, device_id="CH-01", reason="維修中",
            start_time=now - datetime.timedelta(hours=1),
            end_time=now + datetime.timedelta(hours=1),
        )
        assert device_blocked_reason_now("CH-01") == "維修中"


def test_blocked_period_empty_reason_still_blocked(patched_session):
    """時段存在但沒填原因 → 仍算封鎖，回預設字串（reason 不能拿來當有無封鎖的判準）"""
    with patched_session("app.utils") as Session:
        now = _now_naive()
        _seed_block(
            Session, device_id="CH-01", reason=None,
            start_time=now - datetime.timedelta(hours=1),
            end_time=now + datetime.timedelta(hours=1),
        )
        assert device_blocked_reason_now("CH-01") == "已設定封鎖"


def test_blocked_period_past_not_returned(patched_session):
    """封鎖時段已結束 → None"""
    with patched_session("app.utils") as Session:
        now = _now_naive()
        _seed_block(
            Session, device_id="CH-01",
            start_time=now - datetime.timedelta(hours=2),
            end_time=now - datetime.timedelta(hours=1),
        )
        assert device_blocked_reason_now("CH-01") is None


def test_blocked_period_future_not_returned(patched_session):
    """封鎖時段尚未開始 → None"""
    with patched_session("app.utils") as Session:
        now = _now_naive()
        _seed_block(
            Session, device_id="CH-01",
            start_time=now + datetime.timedelta(hours=1),
            end_time=now + datetime.timedelta(hours=2),
        )
        assert device_blocked_reason_now("CH-01") is None


def test_blocked_period_different_device_not_returned(patched_session):
    """CH-02 的封鎖 → 查 CH-01 時 None"""
    with patched_session("app.utils") as Session:
        now = _now_naive()
        _seed_block(
            Session, device_id="CH-02",
            start_time=now - datetime.timedelta(hours=1),
            end_time=now + datetime.timedelta(hours=1),
        )
        assert device_blocked_reason_now("CH-01") is None


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


def _seed_running_schedule_with_loan(Session, loan_status="loaned") -> tuple[int, int]:
    """建立進行中排程 + 一筆治具借用列，回傳 (schedule_id, loan_id)。
    loan_status="loaned" 為已借出（帶借出時間）；"reserved" 為尚未借出的預約。"""
    with Session() as db:
        f = Fixture(interface_type="USB", form_factor="Desktop", total_quantity=2)
        db.add(f)
        db.flush()
        s = Schedule(
            project_number="P001", sample_name="Sample",
            standard="IEC", conditions='["sop_a", "sop_b"]',
            status=ScheduleStatus.RUNNING, device_id="CH-01",
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


def test_ad_hoc_manual_stop_ignores_future_schedule(patched_session):
    """臨時 SOP 中止收尾時，同機台的未來排程不得被當成「正在跑的那一筆」回報出去。"""
    with patched_session("app.schedule_service") as Session:
        schedule_id = _seed_future_confirmed_schedule(Session)

        result = running_schedule_info("CH-01")

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


# ── 手動中止收尾：排程續為進行中、治具不動 ────────────────────────────────────


@pytest.mark.parametrize("loan_status", ["loaned", "reserved"])
def test_manual_stop_keeps_schedule_running_and_fixture_untouched(patched_session, loan_status):
    """中止不是完成：排程續為進行中，已借出與預約中的治具都不動，只回報身分供通知使用。"""
    with patched_session("app.schedule_service") as Session:
        schedule_id, loan_id = _seed_running_schedule_with_loan(
            Session, loan_status=loan_status
        )

        result = running_schedule_info("CH-01")

        assert result is not None
        assert result.schedule_id == schedule_id
        assert result.project_number == "P001"
        assert result.sample_name == "Sample"
        with Session() as db:
            assert db.get(Schedule, schedule_id).status == ScheduleStatus.RUNNING
            loan = db.get(FixtureLoan, loan_id)
            assert loan.status == loan_status
            assert loan.return_date is None
