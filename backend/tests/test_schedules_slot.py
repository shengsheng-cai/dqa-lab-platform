"""
T-01: _find_earliest_slot / _auto_assign 整合測試
使用 in-memory SQLite，直接傳入 db session。
"""
import datetime
import json
from unittest.mock import patch

from app.models import Schedule, ScheduleStatus, DeviceBlockedPeriod
from app.schedule_service import _find_earliest_slot, _auto_assign

UTC = datetime.timezone.utc


def _naive(dt: datetime.datetime) -> datetime.datetime:
    """SQLite 不支援 aware datetime，轉 naive UTC 存入"""
    return dt.replace(tzinfo=None)


def _future(hours: float) -> datetime.datetime:
    return datetime.datetime.now(UTC) + datetime.timedelta(hours=hours)


# ── _find_earliest_slot ────────────────────────────────────────────────────


def test_empty_db_returns_now(db):
    """空 DB：最早可用時間 ≈ now"""
    before = _naive(datetime.datetime.now(UTC))
    result = _find_earliest_slot("CH-01", 2.0, db)
    after = _naive(datetime.datetime.now(UTC))
    assert before <= result <= after + datetime.timedelta(seconds=1)


def test_after_confirmed_schedule(db):
    """有一個已確認排程 → 開始時間必須在它結束後"""
    future_end = _future(6)
    s = Schedule(
        project_number="P001", sample_name="S1",
        standard="IEC", conditions='["sop1"]',
        status=ScheduleStatus.CONFIRMED,
        device_id="CH-01",
        start_time=_naive(_future(2)),
        end_time=_naive(future_end),
    )
    db.add(s)
    db.commit()

    result = _find_earliest_slot("CH-01", 2.0, db)
    assert result >= _naive(future_end - datetime.timedelta(seconds=1))


def test_ignores_cancelled_schedule(db):
    """已取消的排程不影響可用時段"""
    s = Schedule(
        project_number="P002", sample_name="S2",
        standard="IEC", conditions='["sop1"]',
        status=ScheduleStatus.CANCELLED,
        device_id="CH-01",
        start_time=_naive(_future(1)),
        end_time=_naive(_future(10)),
    )
    db.add(s)
    db.commit()

    before = _naive(datetime.datetime.now(UTC))
    result = _find_earliest_slot("CH-01", 2.0, db)
    after = _naive(datetime.datetime.now(UTC))
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
    assert result >= _naive(block_end - datetime.timedelta(seconds=1))


def test_running_until_respected(db):
    """running_until 傳入在執行中的設備 → 從預估結束後排入"""
    live_end = _future(4)
    running_until = {"CH-01": live_end}

    result = _find_earliest_slot("CH-01", 2.0, db, running_until=running_until)
    assert result >= _naive(live_end - datetime.timedelta(seconds=1))


def test_chained_schedules(db):
    """兩個串接排程 → 第三個從最後結束後插入"""
    db.add(Schedule(
        project_number="P1", sample_name="S1", standard="IEC", conditions='["s"]',
        status=ScheduleStatus.CONFIRMED, device_id="CH-01",
        start_time=_naive(_future(2)), end_time=_naive(_future(5)),
    ))
    db.add(Schedule(
        project_number="P2", sample_name="S2", standard="IEC", conditions='["s"]',
        status=ScheduleStatus.CONFIRMED, device_id="CH-01",
        start_time=_naive(_future(5)), end_time=_naive(_future(9)),
    ))
    db.commit()

    result = _find_earliest_slot("CH-01", 1.0, db)
    assert result >= _naive(_future(9) - datetime.timedelta(seconds=1))


# ── _auto_assign ───────────────────────────────────────────────────────────

_MOCK_STD = {
    "ramp_rate": 2.0, "dwell_time_hours": 1.0, "cycles": 1,
    "high_temperature": 85.0, "low_temperature": None,
}


def test_auto_assign_returns_valid_device(db):
    """auto_assign 回傳合法設備 ID"""
    from app.sop import DEVICE_IDS
    with patch("app.schedule_service.get_standard", return_value=_MOCK_STD):
        device_id, start, end = _auto_assign(["sop1"], db)
    assert device_id in DEVICE_IDS
    assert end > start


def test_auto_assign_skips_emergency_and_stuck_devices(db):
    """自動選機要跳過緊急停止與卡機的設備。

    這段排除以前沒有任何測試接到 `_auto_assign` 上：兩條既有測試都沒傳 cache，
    所以那個分支從來沒被執行過，整段拿掉也全綠（BUG-016）。排到壞掉的設備上，
    排程會停在「已確認」、每五分鐘重試一次，永遠不會開始。
    """
    from app.sop import DEVICE_IDS

    # 前四台都不能用：兩台緊急停止，兩台跑超時一小時以上（卡機）
    long_ago = _future(-5)
    stuck = {
        "status": "RUNNING",
        "started_at": long_ago,
        "active_sop_json": json.dumps(_MOCK_STD),
    }
    cache = {
        "CH-01": {"status": "EMERGENCY"},
        "CH-02": {"status": "EMERGENCY"},
        "CH-03": dict(stuck),
        "CH-04": dict(stuck),
        "CH-05": {"status": "IDLE"},
    }

    with patch("app.schedule_service.get_standard", return_value=_MOCK_STD):
        device_id, _start, _end = _auto_assign(["sop1"], db, cache=cache)

    assert device_id == "CH-05", "只剩 CH-05 可用，不應該選到緊急停止或卡機的設備"
    assert device_id in DEVICE_IDS


def test_auto_assign_falls_back_when_every_device_is_excluded(db):
    """全部設備都被排除時要退回全選，不能回 None 讓申請整個做不了。"""
    cache = {did: {"status": "EMERGENCY"} for did in ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"]}

    with patch("app.schedule_service.get_standard", return_value=_MOCK_STD):
        device_id, _start, _end = _auto_assign(["sop1"], db, cache=cache)

    assert device_id is not None


def test_auto_assign_avoids_busy_device(db):
    """CH-01 有一個很長的排程 → auto_assign 選其他設備"""
    db.add(Schedule(
        project_number="P1", sample_name="S1", standard="IEC", conditions='["s"]',
        status=ScheduleStatus.CONFIRMED, device_id="CH-01",
        start_time=_naive(_future(0.5)),
        end_time=_naive(_future(200)),  # 200h 排程
    ))
    db.commit()

    with patch("app.schedule_service.get_standard", return_value=_MOCK_STD):
        device_id, start, end = _auto_assign(["sop1"], db)
    assert device_id != "CH-01"


def test_auto_assign_end_equals_start_plus_hours(db):
    """end_time = start_time + total_hours（基本時間一致性）"""
    with patch("app.schedule_service.get_standard", return_value=_MOCK_STD):
        _, start, end = _auto_assign(["sop1"], db)
        total_hours = (end - start).total_seconds() / 3600
        from app.schedule_service import _calc_total_hours
        expected = _calc_total_hours(["sop1"])
    assert abs(total_hours - expected) < 0.01
