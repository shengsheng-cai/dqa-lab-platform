"""
T-04: 三模組連動核心邏輯測試
- _get_emergency_devices / _get_stuck_devices（純 cache dict）
- _activate_schedule_db（mock SessionLocal，驗證排程啟動時 reserved→loaned 治具轉借）
- auto_start_sop（async，驗證 cache 狀態更新與 early-exit 路徑）
"""
import asyncio
import datetime
from unittest.mock import patch, MagicMock

from app.models import Schedule, ScheduleStatus, Fixture, FixtureLoan
from app.schedule_service import (
    _activate_schedule_db,
    _force_normal_stop,
    _get_emergency_devices,
    _get_stuck_devices,
)
from app.sop import auto_start_sop

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


def test_force_normal_stop_sets_skip_push():
    cache = {"CH-01": {"status": "RUNNING"}}
    locks = {"CH-01": asyncio.Lock()}

    with patch("app.schedule_service._save_device_state") as mock_save:
        _run_async(_force_normal_stop("CH-01", cache, locks))

    device = cache["CH-01"]
    assert device["status"] == "FINISHING"
    assert device["sim_phase"] == "ramp_to_ambient"
    assert device["skip_push"] is True
    mock_save.assert_called_once_with("CH-01", device)


# ── _activate_schedule_db：排程啟動時的治具轉借（reserved→loaned）─────────────


def _mock_session_cm(session):
    """建立 context manager mock 讓 SessionLocal() 回傳指定 session"""
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=session)
    cm.__exit__ = MagicMock(return_value=False)
    return cm


def _seed_loan(db, device_id: str, status: str = "reserved") -> FixtureLoan:
    """建立測試用 Fixture + Schedule + FixtureLoan"""
    f = Fixture(
        interface_type="USB", form_factor="Desktop",
        total_quantity=5,
    )
    db.add(f)
    db.flush()

    s = Schedule(
        project_number="P001", sample_name="Sample",
        standard="IEC", conditions='["sop1"]',
        status=ScheduleStatus.CONFIRMED, device_id=device_id,
        start_time=datetime.datetime.now(),
        end_time=datetime.datetime.now() + datetime.timedelta(hours=5),
    )
    db.add(s)
    db.flush()

    loan = FixtureLoan(
        fixture_id=f.id,
        schedule_id=s.id,
        borrower_name="測試人員",
        quantity=1,
        status=status,
        loan_date=datetime.datetime.now(UTC),
    )
    db.add(loan)
    db.commit()
    return loan


def test_activate_turns_reserved_into_loaned(db):
    """排程啟動 → 該排程的 reserved 治具轉為 loaned"""
    loan = _seed_loan(db, "CH-01", status="reserved")

    with patch("app.schedule_service.SessionLocal", return_value=_mock_session_cm(db)):
        _activate_schedule_db(loan.schedule_id)

    db.refresh(loan)
    assert loan.status == "loaned"


def test_activate_does_not_affect_already_loaned(db):
    """轉借只挑 reserved：已是 loaned 的不被觸動（status 維持 loaned，loan_date 不變）"""
    original_date = datetime.datetime(2026, 1, 1)  # naive，SQLite 不存 tz
    loan = _seed_loan(db, "CH-01", status="loaned")
    loan.loan_date = original_date
    db.commit()

    with patch("app.schedule_service.SessionLocal", return_value=_mock_session_cm(db)):
        _activate_schedule_db(loan.schedule_id)

    db.refresh(loan)
    assert loan.status == "loaned"
    assert loan.loan_date == original_date


def test_activate_only_affects_target_schedule(db):
    """同設備多筆已確認排程：只轉借目標排程的預約治具，不誤借其他筆"""
    loan_a = _seed_loan(db, "CH-01", status="reserved")
    loan_b = _seed_loan(db, "CH-01", status="reserved")  # 同設備另一筆已確認排程

    with patch("app.schedule_service.SessionLocal", return_value=_mock_session_cm(db)):
        _activate_schedule_db(loan_a.schedule_id)

    db.refresh(loan_a)
    db.refresh(loan_b)
    assert loan_a.status == "loaned"
    assert loan_b.status == "reserved"  # 另一筆排程的預約未被誤轉


# ── auto_start_sop ─────────────────────────────────────────────────────────

_MOCK_SOP = {
    "name": "Test SOP",
    "ramp_rate": 2.0,
    "dwell_time_hours": 1.0,
    "cycles": 1,
    "high_temperature": 85.0,
    "low_temperature": None,
    "steps": [{"id": 1}, {"id": 2}],
}


def _run_async(coro):
    """在新 event loop 執行 coroutine（Python 3.9 相容）"""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _start_sop(device_id, sop_id, cache, **kwargs):
    lock = asyncio.Lock()
    locks = {device_id: lock}
    await auto_start_sop(device_id, sop_id, cache, locks, **kwargs)


def test_auto_start_sop_device_not_in_cache():
    """設備不在 cache → 直接 return"""
    cache = {}
    with patch("app.sop.STANDARDS_AND_SOPS", {"sop_test": _MOCK_SOP}):
        with patch("app.sop._save_device_state") as mock_save:
            _run_async(_start_sop("CH-01", "sop_test", cache))
            mock_save.assert_not_called()


def test_auto_start_sop_device_not_idle():
    """設備非 IDLE → 跳過"""
    cache = {"CH-01": {"status": "RUNNING"}}
    with patch("app.sop.STANDARDS_AND_SOPS", {"sop_test": _MOCK_SOP}):
        with patch("app.sop._save_device_state") as mock_save:
            _run_async(_start_sop("CH-01", "sop_test", cache))
            mock_save.assert_not_called()
    assert cache["CH-01"]["status"] == "RUNNING"


def test_auto_start_sop_unknown_sop_id():
    """sop_id 不存在 → 跳過"""
    cache = {"CH-01": {"status": "IDLE"}}
    with patch("app.sop.STANDARDS_AND_SOPS", {}):
        with patch("app.sop._save_device_state") as mock_save:
            _run_async(_start_sop("CH-01", "nonexistent", cache))
            mock_save.assert_not_called()


def test_auto_start_sop_happy_path_updates_cache(db):
    """正常啟動 → cache 改為 RUNNING，_save_device_state 至少被呼叫一次"""
    cache = {"CH-01": {"status": "IDLE"}}
    with patch("app.sop.STANDARDS_AND_SOPS", {"sop_test": _MOCK_SOP}):
        with patch("app.sop._save_device_state") as mock_save:
            with patch("app.sop.SessionLocal", return_value=_mock_session_cm(db)):
                _run_async(_start_sop("CH-01", "sop_test", cache))
            assert mock_save.called

    assert cache["CH-01"]["status"] == "RUNNING"
    assert cache["CH-01"]["running_sop_id"] == "sop_test"
    assert cache["CH-01"]["total_steps"] == 2


def test_auto_start_sop_never_touches_fixtures(db):
    """auto_start_sop 不得自行轉借治具。

    治具轉借一律由呼叫方依 schedule_id 精準處理（走 schedule_service._activate_schedule_db）——
    auto_start_sop 本身只管把設備開起來、不碰治具。這裡放一筆 reserved 治具，
    啟動後它必須維持 reserved。
    """
    loan = _seed_loan(db, "CH-01", status="reserved")
    cache = {"CH-01": {"status": "IDLE"}}
    with patch("app.sop.STANDARDS_AND_SOPS", {"sop_test": _MOCK_SOP}):
        with patch("app.sop._save_device_state"):
            with patch("app.sop.SessionLocal", return_value=_mock_session_cm(db)):
                _run_async(_start_sop("CH-01", "sop_test", cache))

    db.refresh(loan)
    assert loan.status == "reserved", "auto_start_sop 不該碰治具"
    assert cache["CH-01"]["status"] == "RUNNING"
