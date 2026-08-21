"""外鍵不是宣告好看的：刪掉被引用的資料，子表不能留下指向不存在資料的 ID。

SQLite 預設不檢查外鍵，所以這些行為以前全部不成立——刪掉一個使用者，治具上的保管人
欄位仍留著那個已經不存在的 ID。連線那端現在一律開 PRAGMA foreign_keys=ON，
刪除行為則寫在 schema 裡，這個檔案驗的就是那份宣告真的有作用。
"""
import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import (
    DemoToken,
    DeviceBlockedPeriod,
    Fixture,
    FixtureLoan,
    Schedule,
    ScheduleFixture,
    SopExecution,
    StepRecord,
    User,
)


def _make_user(db, name="王小明") -> User:
    user = User(
        username=f"u_{name}",
        display_name=name,
        hashed_password="x",
        role="admin",
    )
    db.add(user)
    db.flush()
    return user


def _make_fixture(db, total=5) -> Fixture:
    fixture = Fixture(
        interface_type="USB",
        form_factor="Desktop",
        total_quantity=total,
        shortage=0,
        is_active=True,
    )
    db.add(fixture)
    db.flush()
    return fixture


def _make_schedule(db, **kwargs) -> Schedule:
    schedule = Schedule(
        project_number="P-1",
        sample_name="樣品",
        standard="IEC 60068",
        conditions='["iec60068_ab_-40_16h"]',
        **kwargs,
    )
    db.add(schedule)
    db.flush()
    return schedule


def test_foreign_key_enforcement_is_on(db):
    """借用紀錄指到不存在的使用者要當場被擋，不是安靜寫進去。"""
    fixture = _make_fixture(db)
    db.add(
        FixtureLoan(
            fixture_id=fixture.id,
            borrower_name="查無此人",
            borrower_user_id=999,
            quantity=1,
        )
    )

    with pytest.raises(IntegrityError):
        db.commit()


def test_deleting_user_clears_references_but_keeps_history(db):
    """刪使用者不該卡在歷史資料上，但也不能留下孤兒 ID：引用一律清成空的，紀錄本身留著。"""
    user = _make_user(db)
    fixture = _make_fixture(db)
    fixture.keeper_user_id = user.id
    fixture.keeper_name = user.display_name
    schedule = _make_schedule(
        db,
        applicant_user_id=user.id,
        created_by=user.id,
        confirmed_by=user.id,
    )
    loan = FixtureLoan(
        fixture_id=fixture.id,
        borrower_name=user.display_name,
        borrower_user_id=user.id,
        quantity=1,
    )
    now = datetime.datetime(2026, 8, 21, 0, 0)
    blocked = DeviceBlockedPeriod(
        device_id="CH-01",
        start_time=now,
        end_time=now + datetime.timedelta(hours=2),
        created_by=user.id,
    )
    token = DemoToken(token="demo-token", created_by=user.id)
    db.add_all((loan, blocked, token))
    db.commit()

    db.delete(user)
    db.commit()

    assert db.query(User).count() == 0
    # 引用清空，但顯示用的姓名快照與紀錄本身都還在
    assert fixture.keeper_user_id is None
    assert fixture.keeper_name == "王小明"
    assert (schedule.applicant_user_id, schedule.created_by, schedule.confirmed_by) == (
        None,
        None,
        None,
    )
    assert loan.borrower_user_id is None and loan.borrower_name == "王小明"
    assert blocked.created_by is None
    assert token.created_by is None


def test_deleting_schedule_leaves_no_orphan_execution(db):
    """刪排程時，執行紀錄與借用紀錄改成沒有排程，中間表跟著消失。"""
    fixture = _make_fixture(db)
    schedule = _make_schedule(db)
    execution = SopExecution(sop_id="iec60068_ab_-40_16h", schedule_id=schedule.id)
    loan = FixtureLoan(
        fixture_id=fixture.id,
        borrower_name="借用人",
        quantity=1,
        schedule_id=schedule.id,
    )
    db.add_all(
        (
            execution,
            loan,
            ScheduleFixture(schedule_id=schedule.id, fixture_id=fixture.id, quantity=1),
        )
    )
    db.commit()

    db.delete(schedule)
    db.commit()

    assert db.query(SopExecution).count() == 1
    assert execution.schedule_id is None
    assert loan.schedule_id is None
    assert db.query(ScheduleFixture).count() == 0


def test_deleting_execution_takes_its_step_records(db):
    """步驟紀錄離開執行紀錄沒有意義，跟著一起走。"""
    execution = SopExecution(sop_id="iec60068_ab_-40_16h")
    db.add(execution)
    db.flush()
    db.add(StepRecord(execution_id=execution.id, step_id=1, completed=True))
    db.commit()

    db.delete(execution)
    db.commit()

    assert db.query(StepRecord).count() == 0


def test_fixture_with_loans_cannot_be_hard_deleted(db):
    """治具走軟刪除（is_active=False）；真的下 DELETE 要被擋下來。"""
    fixture = _make_fixture(db)
    db.add(
        FixtureLoan(
            fixture_id=fixture.id,
            borrower_name="借用人",
            quantity=1,
            status="loaned",
        )
    )
    db.commit()

    db.delete(fixture)
    with pytest.raises(IntegrityError):
        db.commit()
