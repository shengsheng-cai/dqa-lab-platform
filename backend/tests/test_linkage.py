"""
T-04: 排程選機與停止連動核心邏輯測試
"""
import asyncio
import datetime

from app.device_state import DeviceStateManager
from app.schedule_service import (
    _force_normal_stop,
    _get_emergency_devices,
    _get_stuck_devices,
)

UTC = datetime.timezone.utc


def _past(hours: float) -> datetime.datetime:
    return datetime.datetime.now(UTC) - datetime.timedelta(hours=hours)


def _future(hours: float) -> datetime.datetime:
    return datetime.datetime.now(UTC) + datetime.timedelta(hours=hours)


# ── _get_emergency_devices ─────────────────────────────────────────────────


def test_emergency_devices_empty_cache():
    assert _get_emergency_devices({}) == set()


def test_emergency_devices_filters_correctly():
    cache = {
        "CH-01": {"status": "EMERGENCY"},
        "CH-02": {"status": "RUNNING"},
        "CH-03": {"status": "IDLE"},
        "CH-04": {"status": "EMERGENCY"},
    }
    assert _get_emergency_devices(cache) == {"CH-01", "CH-04"}


def test_emergency_devices_none_emergency():
    cache = {"CH-01": {"status": "RUNNING"}, "CH-02": {"status": "IDLE"}}
    assert _get_emergency_devices(cache) == set()


# ── _get_stuck_devices ─────────────────────────────────────────────────────


def test_stuck_devices_empty_cache():
    assert _get_stuck_devices({}) == set()


def test_stuck_devices_idle_not_stuck():
    assert _get_stuck_devices({"CH-01": {"status": "IDLE"}}) == set()


def test_stuck_devices_running_with_future_end():
    """預估結束在未來 → 不算卡機"""
    cache = {"CH-01": {"status": "RUNNING", "estimated_end_at": _future(2).isoformat()}}
    assert _get_stuck_devices(cache) == set()


def test_stuck_devices_running_overdue_more_than_1h():
    """預估結束已過超過 1 小時 → 視為卡機"""
    cache = {"CH-01": {"status": "RUNNING", "estimated_end_at": _past(2).isoformat()}}
    assert "CH-01" in _get_stuck_devices(cache)


def test_stuck_devices_overdue_less_than_1h_not_stuck():
    """剛過不到 1h → 不算卡機"""
    cache = {"CH-01": {"status": "RUNNING", "estimated_end_at": _past(0.5).isoformat()}}
    assert _get_stuck_devices(cache) == set()


def test_force_normal_stop_sets_skip_push(patched_session):
    cache = {"CH-01": {"status": "RUNNING"}}
    states = DeviceStateManager(cache)

    with patched_session("app.device_state"):
        asyncio.run(_force_normal_stop("CH-01", states))

    device = states["CH-01"]
    assert device["status"] == "FINISHING"
    assert device["sim_phase"] == "ramp_to_ambient"
    assert device["skip_push"] is True
