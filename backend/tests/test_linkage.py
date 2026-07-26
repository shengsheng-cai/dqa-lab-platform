"""
T-04: 排程選機與停止連動核心邏輯測試
"""
import asyncio
import datetime
import json

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


def _running_item(
    started_at: datetime.datetime, dwell_hours: float, status: str = "RUNNING",
) -> dict:
    """組一個走「真正估算路徑」的 cache item（started_at + active_sop_json）。

    high==ambient、無 low、dwell=dwell_hours → 曲線時長 = dwell_hours，
    est_end = started_at + dwell_hours。不再像舊測試那樣直接餵 estimated_end_at
    ——那個 key 生產環境從不寫進 cache，餵它等於測一條死路。
    """
    sop = {
        "ramp_rate": 1.0,
        "dwell_time_hours": dwell_hours,
        "cycles": 1,
        "high_temperature": 25.0,
        "low_temperature": None,
    }
    return {"status": status, "started_at": started_at, "active_sop_json": json.dumps(sop)}


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
    cache = {"CH-01": _running_item(_past(0), dwell_hours=2)}
    assert _get_stuck_devices(cache) == set()


def test_stuck_devices_running_overdue_more_than_1h():
    """預估結束已過超過 1 小時 → 視為卡機"""
    cache = {"CH-01": _running_item(_past(2), dwell_hours=0)}
    assert "CH-01" in _get_stuck_devices(cache)


def test_stuck_devices_overdue_less_than_1h_not_stuck():
    """剛過不到 1h → 不算卡機"""
    cache = {"CH-01": _running_item(_past(0.5), dwell_hours=0)}
    assert _get_stuck_devices(cache) == set()


def test_stuck_devices_paused_never_stuck():
    """PAUSED 不算卡機：暫停是刻意的，est 又沒扣暫停時間，久停也不能被誤踢出自動選機"""
    cache = {"CH-01": _running_item(_past(5), dwell_hours=0, status="PAUSED")}
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
