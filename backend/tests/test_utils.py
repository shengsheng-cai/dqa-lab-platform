"""utils 模組純函數測試"""
import datetime

from app.utils import _parse_conditions, parse_iso_utc


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
