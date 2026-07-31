"""utils 模組純函數測試"""
import datetime
import json

import pytest

from app.utils import (
    _parse_conditions, finishing_end, parse_iso_utc, ramp_rate_from_sop,
)


# ──────────────────────────────────────────
# _parse_conditions
# ──────────────────────────────────────────

def test_parse_conditions_none():
    assert _parse_conditions(None) == []


def test_parse_conditions_empty_string():
    assert _parse_conditions("") == []


def test_parse_conditions_valid_json():
    assert _parse_conditions('["sop1","sop2"]') == ["sop1", "sop2"]


def test_parse_conditions_bad_json():
    assert _parse_conditions("not-json") == []


# ──────────────────────────────────────────
# parse_iso_utc
# ──────────────────────────────────────────

def test_parse_iso_utc_z_suffix():
    dt = parse_iso_utc("2024-01-01T00:00:00Z")
    assert dt.tzinfo is not None
    assert dt.utcoffset() == datetime.timedelta(0)


def test_parse_iso_utc_plus_zero():
    dt = parse_iso_utc("2024-01-01T00:00:00+00:00")
    assert dt.tzinfo is not None
    assert dt.utcoffset() == datetime.timedelta(0)


def test_parse_iso_utc_plus_eight():
    dt = parse_iso_utc("2024-06-01T12:00:00+08:00")
    assert dt.tzinfo is not None
    assert dt.utcoffset() == datetime.timedelta(hours=8)


# ──────────────────────────────────────────
# ramp_rate_from_sop（模擬器降溫與估算共用同一份速率）
# ──────────────────────────────────────────

@pytest.mark.parametrize("active_sop_json,expected", [
    (json.dumps({"ramp_rate": 2.5}), 2.5),
    (json.dumps({"ramp_rate": 0}), 1.0),        # 0 會讓降溫永遠跑不完
    (json.dumps({"ramp_rate": -3.0}), 1.0),     # 負值會往反方向跑
    (json.dumps({}), 1.0),
    (None, 1.0),                                # 緊急停止已清掉 sop
    ("not-json", 1.0),
])
def test_ramp_rate_from_sop(active_sop_json, expected):
    assert ramp_rate_from_sop(active_sop_json) == expected


# ──────────────────────────────────────────
# finishing_end
# ──────────────────────────────────────────

_NOW = datetime.datetime(2024, 6, 1, 10, 0, 0, tzinfo=datetime.timezone.utc)


def test_finishing_end_uses_ramp_rate():
    """85°C 以 2°C/min 降回 25°C → 還要 30 分鐘"""
    item = {"temperature": 85.0, "active_sop_json": json.dumps({"ramp_rate": 2.0})}
    assert finishing_end(item, _NOW) == _NOW + datetime.timedelta(minutes=30)


def test_finishing_end_zero_degrees_is_a_real_reading():
    """0°C 是低溫測試的合法讀值，不能被當成「沒有溫度」而誤判為已在常溫"""
    item = {"temperature": 0.0, "active_sop_json": json.dumps({"ramp_rate": 1.0})}
    assert finishing_end(item, _NOW) == _NOW + datetime.timedelta(minutes=25)


@pytest.mark.parametrize("active_sop_json", [None, "not-json"])
def test_finishing_end_without_usable_sop_still_estimates(active_sop_json):
    """緊急停止清掉 sop、或資料壞掉：都要用預設速率給出估算，不能回「現在就有空」"""
    item = {"temperature": 85.0, "active_sop_json": active_sop_json}
    assert finishing_end(item, _NOW) == _NOW + datetime.timedelta(minutes=60)


def test_finishing_end_at_ambient_is_now():
    item = {"temperature": 25.0, "active_sop_json": json.dumps({"ramp_rate": 1.0})}
    assert finishing_end(item, _NOW) == _NOW
