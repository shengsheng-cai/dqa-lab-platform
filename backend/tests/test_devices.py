"""
T-08: devices 模組純函數測試
- _make_description（純函數）
- _calc_estimated_end_at（時間計算，FINISHING 分支 mock _now_utc）
"""
import datetime
import json
import pytest
from unittest.mock import patch

from app.devices import _make_description, _calc_estimated_end_at

UTC = datetime.timezone.utc


# ── _make_description ──────────────────────────────────────────────────────


def test_description_running():
    result = _make_description("RUNNING", "Test Ab")
    assert "Test Ab" in result
    assert "執行" in result


def test_description_paused():
    result = _make_description("PAUSED", "Test Bb")
    assert "Test Bb" in result
    assert "暫停" in result


def test_description_emergency():
    result = _make_description("EMERGENCY", "任何名稱")
    assert "緊急" in result


def test_description_finishing():
    result = _make_description("FINISHING", "任何名稱")
    assert "降溫" in result or "結束" in result


def test_description_idle():
    result = _make_description("IDLE", "STANDBY")
    assert "待機" in result


def test_description_unknown_status():
    """未知 status → 回傳 fallback 字串，不拋例外"""
    result = _make_description("UNKNOWN_XYZ", "xxx")
    assert isinstance(result, str)


# ── _calc_estimated_end_at ─────────────────────────────────────────────────


def test_calc_end_at_idle_returns_none():
    assert _calc_estimated_end_at({"status": "IDLE"}) is None


def test_calc_end_at_missing_started_at_returns_none():
    item = {"status": "RUNNING", "started_at": None, "active_sop_json": None}
    assert _calc_estimated_end_at(item) is None


def test_calc_end_at_invalid_json_returns_none():
    item = {
        "status": "RUNNING",
        "started_at": datetime.datetime(2024, 1, 1, tzinfo=UTC),
        "active_sop_json": "not-valid-json",
    }
    assert _calc_estimated_end_at(item) is None


def test_calc_end_at_high_temp_only():
    """高溫測試：ramp_rate=2°C/min, high=85°C, dwell=1h → 計算 estimated_end"""
    sop = {
        "ramp_rate": 2.0,
        "dwell_time_hours": 1.0,
        "cycles": 1,
        "high_temperature": 85.0,
        "low_temperature": None,
    }
    started = datetime.datetime(2024, 6, 1, 8, 0, 0, tzinfo=UTC)
    item = {
        "status": "RUNNING",
        "started_at": started,
        "active_sop_json": json.dumps(sop),
    }
    result = _calc_estimated_end_at(item)
    assert result is not None

    # ramp=(85-25)/2=30min，total=(30+60+30)min+30min穩定=150min=2.5h
    expected = started + datetime.timedelta(hours=2.5)
    actual = datetime.datetime.fromisoformat(result)
    assert abs((actual - expected).total_seconds()) < 60  # 誤差 < 1 分鐘


def test_calc_end_at_finishing_returns_future():
    """FINISHING 分支：從當前溫度算降回 25°C，結果應在未來"""
    fake_now = datetime.datetime(2024, 6, 1, 10, 0, 0, tzinfo=UTC)
    item = {
        "status": "FINISHING",
        "temperature": 85.0,
        "active_sop_json": json.dumps({"ramp_rate": 1.0}),
    }
    with patch("app.devices._now_utc", return_value=fake_now):
        result = _calc_estimated_end_at(item)

    assert result is not None
    actual = datetime.datetime.fromisoformat(result)
    assert actual > fake_now
