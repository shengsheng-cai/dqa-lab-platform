"""
T-01: _find_earliest_slot / _auto_assign 整合測試
使用 in-memory SQLite，直接傳入 db session。
"""
import datetime
import pytest
from unittest.mock import patch

from app.models import Schedule, DeviceBlockedPeriod
from app.schedules import _find_earliest_slot, _auto_assign

UTC = datetime.timezone.utc


def _naive(dt: datetime.datetime) -> datetime.datetime:
    """SQLite 不支援 aware datetime，轉 naive UTC 存入"""
    return dt.replace(tzinfo=None)


def _future(hours: float) -> datetime.datetime:
    return datetime.datetime.now(UTC) + datetime.timedelta(hours=hours)


# ── _find_earliest_slot ────────────────────────────────────────────────────


def test_empty_db_returns_now(db):
    """空 DB：最早可用時間 ≈ now"""
    before = datetime.datetime.now(UTC)
    result = _find_earliest_slot("CH-01", 2.0, db)
    after = datetime.datetime.now(UTC)
    assert before <= result <= after + datetime.timedelta(seconds=1)


def test_after_confirmed_schedule(db):
    """有一個已確認排程 → 開始時間必須在它結束後"""
    future_end = _future(6)
    s = Schedule(
        project_number="P001", sample_name="S1",
        standard="IEC", conditions='["sop1"]',
        status="已確認",
        device_id="CH-01",
        start_time=_naive(_future(2)),
        end_time=_naive(future_end),
    )
    db.add(s)
    db.commit()

    result = _find_earliest_slot("CH-01", 2.0, db)
    assert result >= future_end - datetime.timedelta(seconds=1)


def test_ignores_cancelled_schedule(db):
    """已取消的排程不影響可用時段"""
    s = Schedule(
        project_number="P002", sample_name="S2",
        standard="IEC", conditions='["sop1"]',
        status="已取消",
        device_id="CH-01",
        start_time=_naive(_future(1)),
        end_time=_naive(_future(10)),
    )
    db.add(s)
    db.commit()

    before = datetime.datetime.now(UTC)
    result = _find_earliest_slot("CH-01", 2.0, db)
    after = datetime.datetime.now(UTC)
    # 已取消不算衝突 → 回傳 now
    assert before <= result <= after + datetime.timedelta(seconds=1)


def test_skips_blocked_period(db):
    """不可用時段 → 從時段結束後開始"""
    block_end = _future(6)
    b = DeviceBlockedPeriod(
        device_id="CH-01",
        start_time=_naive(_future(1)),
        end_time=_naive(block_end),
    )
    db.add(b)
    db.commit()

    result = _find_earliest_slot("CH-01", 2.0, db)
    assert result >= block_end - datetime.timedelta(seconds=1)


def test_running_until_respected(db):
    """running_until 傳入在執行中的設備 → 從預估結束後排入"""
    live_end = _future(4)
    running_until = {"CH-01": live_end}

    result = _find_earliest_slot("CH-01", 2.0, db, running_until=running_until)
    assert result >= live_end - datetime.timedelta(seconds=1)


def test_chained_schedules(db):
    """兩個串接排程 → 第三個從最後結束後插入"""
    db.add(Schedule(
        project_number="P1", sample_name="S1", standard="IEC", conditions='["s"]',
        status="已確認", device_id="CH-01",
        start_time=_naive(_future(2)), end_time=_naive(_future(5)),
    ))
    db.add(Schedule(
        project_number="P2", sample_name="S2", standard="IEC", conditions='["s"]',
        status="已確認", device_id="CH-01",
        start_time=_naive(_future(5)), end_time=_naive(_future(9)),
    ))
    db.commit()

    result = _find_earliest_slot("CH-01", 1.0, db)
    assert result >= _future(9) - datetime.timedelta(seconds=1)


# ── _auto_assign ───────────────────────────────────────────────────────────

_MOCK_STD = {
    "ramp_rate": 2.0, "dwell_time_hours": 1.0, "cycles": 1,
    "high_temperature": 85.0, "low_temperature": None,
}


def test_auto_assign_returns_valid_device(db):
    """auto_assign 回傳合法設備 ID"""
    from app.schedules import DEVICE_IDS
    with patch("app.schedules.get_standard", return_value=_MOCK_STD):
        device_id, start, end = _auto_assign(["sop1"], db)
    assert device_id in DEVICE_IDS
    assert end > start


def test_auto_assign_avoids_busy_device(db):
    """CH-01 有一個很長的排程 → auto_assign 選其他設備"""
    db.add(Schedule(
        project_number="P1", sample_name="S1", standard="IEC", conditions='["s"]',
        status="已確認", device_id="CH-01",
        start_time=_naive(_future(0.5)),
        end_time=_naive(_future(200)),  # 200h 排程
    ))
    db.commit()

    with patch("app.schedules.get_standard", return_value=_MOCK_STD):
        device_id, start, end = _auto_assign(["sop1"], db)
    assert device_id != "CH-01"


def test_auto_assign_end_equals_start_plus_hours(db):
    """end_time = start_time + total_hours（基本時間一致性）"""
    with patch("app.schedules.get_standard", return_value=_MOCK_STD):
        _, start, end = _auto_assign(["sop1"], db)
        total_hours = (end - start).total_seconds() / 3600
        from app.schedules import _calc_total_hours
        expected = _calc_total_hours(["sop1"])
    assert abs(total_hours - expected) < 0.01
