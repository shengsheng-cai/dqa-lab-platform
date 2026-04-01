"""
T-01: _calc_condition_hours / _calc_total_hours 單元測試
純計算，不需 DB，用 mock 隔離 get_standard。
"""
import pytest
from unittest.mock import patch

from app.schedules import (
    _calc_condition_hours,
    _calc_total_hours,
    STABILIZATION_HOURS,
    INTER_CONDITION_BUFFER_HOURS,
)


# ── _calc_condition_hours ──────────────────────────────────────────────────


def test_unknown_sop_returns_default():
    """不存在的 sop_id 回傳預設 1.0"""
    assert _calc_condition_hours("nonexistent_sop_xyz") == 1.0


def test_high_temp_only():
    """純高溫（無 low_temp）：ramp up + dwell + ramp down + stabilization"""
    # ramp_rate=2°C/min, ambient=25, high=85 → ramp=(85-25)/2=30min
    # total_min = 30 + 60 + 30 = 120min = 2.0h；+ 0.5h stabilization = 2.5h
    mock_std = {
        "ramp_rate": 2.0,
        "dwell_time_hours": 1.0,
        "cycles": 1,
        "high_temperature": 85.0,
        "low_temperature": None,
    }
    with patch("app.schedules.get_standard", return_value=mock_std):
        hours = _calc_condition_hours("sop_test")
    expected = (30.0 + 60.0 + 30.0) / 60.0 + STABILIZATION_HOURS
    assert abs(hours - expected) < 0.01


def test_cold_only_single_point():
    """單點冷測（low_temp < ambient，high ≈ low → ramp_hl < 0.01）"""
    # ambient=25, low=-10, ramp_rate=5 → ramp=(35/5)=7min
    # total_min = 7 + 120 + 7 = 134min；+ 0.5h
    mock_std = {
        "ramp_rate": 5.0,
        "dwell_time_hours": 2.0,
        "cycles": 1,
        "high_temperature": -10.0,
        "low_temperature": -10.0,  # ramp_hl ≈ 0 → 單點冷測分支
    }
    with patch("app.schedules.get_standard", return_value=mock_std):
        hours = _calc_condition_hours("sop_test")
    ramp = abs(25.0 - (-10.0)) / 5.0
    expected = (ramp + 120.0 + ramp) / 60.0 + STABILIZATION_HOURS
    assert abs(hours - expected) < 0.01


def test_thermal_cycle_low_high():
    """溫度循環（low_temp < ambient，high ≠ low）：低↔高多 cycle"""
    # ambient=25, low=-10, high=85, ramp_rate=3, dwell=1h, cycles=2
    mock_std = {
        "ramp_rate": 3.0,
        "dwell_time_hours": 1.0,
        "cycles": 2,
        "high_temperature": 85.0,
        "low_temperature": -10.0,
    }
    with patch("app.schedules.get_standard", return_value=mock_std):
        hours = _calc_condition_hours("sop_test")
    r_lo = abs(25.0 - (-10.0)) / 3.0       # 25→-10
    r_hl = abs(85.0 - (-10.0)) / 3.0       # -10→85
    one_cycle = r_hl + 60.0 + r_hl + 60.0  # dwell_min=60
    total_min = r_lo + one_cycle * 2 + r_lo
    expected = total_min / 60.0 + STABILIZATION_HOURS
    assert abs(hours - expected) < 0.01


def test_ramp_rate_zero_defaults_to_one():
    """ramp_rate=0 時自動使用 1.0 避免除以零"""
    mock_std = {
        "ramp_rate": 0.0,
        "dwell_time_hours": 1.0,
        "cycles": 1,
        "high_temperature": 85.0,
        "low_temperature": None,
    }
    with patch("app.schedules.get_standard", return_value=mock_std):
        hours = _calc_condition_hours("sop_test")
    assert hours > 0


# ── _calc_total_hours ──────────────────────────────────────────────────────


def test_total_hours_empty():
    assert _calc_total_hours([]) == 0.0


def test_total_hours_single_condition():
    """單一條件：總時長 = 條件時長"""
    mock_std = {
        "ramp_rate": 2.0, "dwell_time_hours": 1.0, "cycles": 1,
        "high_temperature": 85.0, "low_temperature": None,
    }
    with patch("app.schedules.get_standard", return_value=mock_std):
        total = _calc_total_hours(["sop1"])
        single = _calc_condition_hours("sop1")
    assert abs(total - single) < 0.01


def test_total_hours_multi_adds_buffer():
    """三個條件之間加 2 個緩衝（0.5h × 2）"""
    mock_std = {
        "ramp_rate": 2.0, "dwell_time_hours": 1.0, "cycles": 1,
        "high_temperature": 85.0, "low_temperature": None,
    }
    with patch("app.schedules.get_standard", return_value=mock_std):
        single = _calc_condition_hours("sop1")
        total = _calc_total_hours(["sop1", "sop2", "sop3"])
    expected = single * 3 + INTER_CONDITION_BUFFER_HOURS * 2
    assert abs(total - round(expected, 2)) < 0.01
