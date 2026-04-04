"""
T-05: 模擬器與排程連動邏輯測試
- DeviceBlockedPeriod 查詢時段過濾
- 多條件排程 next_sop_id 索引計算（純 Python）
- 最後條件完成 → 排程標「已完成」+ 治具自動歸還（DB 操作）
"""
import datetime

from app.models import DeviceBlockedPeriod, Schedule, Fixture, FixtureLoan


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


# ── 多條件排程 next_sop_id 索引計算 ───────────────────────────────────────────


def _find_next(conditions: list, prev_sop_id: str):
    """模擬 simulator.py done block 的 next_sop_id 查找邏輯"""
    try:
        idx = conditions.index(prev_sop_id)
        return conditions[idx + 1] if idx + 1 < len(conditions) else None
    except ValueError:
        return None


def test_next_condition_first_of_three():
    assert _find_next(["sop_a", "sop_b", "sop_c"], "sop_a") == "sop_b"


def test_next_condition_middle_of_three():
    assert _find_next(["sop_a", "sop_b", "sop_c"], "sop_b") == "sop_c"


def test_next_condition_last_returns_none():
    assert _find_next(["sop_a", "sop_b"], "sop_b") is None


def test_next_condition_single_item_returns_none():
    assert _find_next(["sop_a"], "sop_a") is None


def test_next_condition_not_in_list_returns_none():
    assert _find_next(["sop_a", "sop_b"], "sop_x") is None


def test_next_condition_empty_list_returns_none():
    assert _find_next([], "sop_a") is None


# ── 最後條件完成 → 排程標已完成 + 治具歸還 ────────────────────────────────────


def _seed_running_schedule(db, device_id: str) -> tuple:
    """建立進行中排程 + 借出治具，回傳 (schedule, loan)"""
    f = Fixture(interface_type="USB", form_factor="Desktop", total_quantity=2)
    db.add(f)
    db.flush()

    s = Schedule(
        project_number="P001", sample_name="Sample",
        standard="IEC", conditions='["sop_a"]',
        status="進行中", device_id=device_id,
        start_time=_now_naive() - datetime.timedelta(hours=2),
        end_time=_now_naive() + datetime.timedelta(hours=1),
    )
    db.add(s)
    db.flush()

    loan = FixtureLoan(
        fixture_id=f.id, schedule_id=s.id,
        borrower_name="排程系統", quantity=1,
        status="loaned", loan_date=_now_naive(),
    )
    db.add(loan)
    db.commit()
    return s, loan


def test_schedule_marked_done_and_fixture_returned(db):
    """最後條件完成 → 排程改為已完成，loaned 治具改為 returned"""
    now = _now_naive()
    s, loan = _seed_running_schedule(db, "CH-01")

    # 模擬 simulator done block 的 DB 操作
    s.status = "已完成"
    s.updated_at = now
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == s.id,
        FixtureLoan.status == "loaned",
    ).update(
        {"status": "returned", "return_date": now},
        synchronize_session=False,
    )
    db.commit()

    db.refresh(s)
    db.refresh(loan)
    assert s.status == "已完成"
    assert loan.status == "returned"
    assert loan.return_date == now


def test_reserved_fixture_not_affected_on_done(db):
    """還沒借出（reserved）的治具不應被歸還操作影響"""
    now = _now_naive()
    f = Fixture(interface_type="USB", form_factor="Desktop", total_quantity=2)
    db.add(f)
    db.flush()

    s = Schedule(
        project_number="P002", sample_name="Sample",
        standard="IEC", conditions='["sop_b"]',
        status="進行中", device_id="CH-02",
        start_time=_now_naive() - datetime.timedelta(hours=1),
        end_time=_now_naive() + datetime.timedelta(hours=2),
    )
    db.add(s)
    db.flush()

    loan = FixtureLoan(
        fixture_id=f.id, schedule_id=s.id,
        borrower_name="排程系統", quantity=1,
        status="reserved",
    )
    db.add(loan)
    db.commit()

    # 只更新 loaned → returned，reserved 不動
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == s.id,
        FixtureLoan.status == "loaned",
    ).update({"status": "returned", "return_date": now}, synchronize_session=False)
    db.commit()

    db.refresh(loan)
    assert loan.status == "reserved"
