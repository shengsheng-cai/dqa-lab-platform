"""
排程狀態必須與設備真實狀態一致。

APScheduler 到點觸發 _start_schedule_by_id 時，若設備當下不是 IDLE
（上一個測試仍在收尾、人工接管、EMERGENCY），auto_start_sop 會跳過啟動。
此時排程不得停留在「進行中」——否則畫面顯示測試中，設備卻是空的，
且 5 分鐘 fallback 不會再重試（fallback 只掃 CONFIRMED）。
"""
import asyncio
import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Fixture, FixtureLoan, Schedule, ScheduleStatus
from app.schedule_service import _start_schedule_by_id, auto_advance_schedules, try_start_schedule
from app.utils import _now_utc_naive

# 啟動流程會跨三個模組寫 DB：schedule_service（排程）、sop（SopExecution）、
# utils（device_states）。三個都要攔，否則測試會寫進真實的 aicm.db。
_SESSION_TARGETS = (
    "app.schedule_service.SessionLocal",
    "app.sop.SessionLocal",
    "app.utils.SessionLocal",
)


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine)

    with patch(_SESSION_TARGETS[0], TestSession), \
         patch(_SESSION_TARGETS[1], TestSession), \
         patch(_SESSION_TARGETS[2], TestSession):
        yield TestSession

    Base.metadata.drop_all(engine)


def _seed_confirmed(Session, device_id="CH-01", start=None) -> int:
    """start 預設為過去時間，讓 fallback（只撈 start_time <= now）也能撈到。"""
    start = start or _now_utc_naive() - datetime.timedelta(minutes=10)
    with Session() as db:
        s = Schedule(
            project_number="P-001",
            sample_name="樣品",
            device_id=device_id,
            standard="IEC 60068",
            conditions='["iec60068_ab_-40_16h"]',
            start_time=start,
            end_time=start + datetime.timedelta(hours=8),
            status=ScheduleStatus.CONFIRMED,
        )
        db.add(s)
        db.commit()
        return s.id


def _status(Session, sid) -> str:
    with Session() as db:
        return db.query(Schedule).filter(Schedule.id == sid).first().status


def _busy_cache(status="FINISHING"):
    """設備正在收尾，不是 IDLE。"""
    return {"CH-01": {"status": status, "sim_phase": "ramp_to_ambient"}}


def test_start_does_not_mark_running_when_device_busy(session_factory):
    """設備非 IDLE → 排程必須留在「已確認」，讓 fallback 稍後重試。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    cache = _busy_cache()
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(_start_schedule_by_id(sid, cache, locks))

    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "設備仍在收尾，排程卻已標為進行中：畫面顯示測試中但設備是空的，"
        "且 fallback 只掃 CONFIRMED，不會再重試"
    )
    assert cache["CH-01"]["status"] == "FINISHING", "不得覆蓋設備既有狀態"


def test_start_marks_running_when_device_idle(session_factory):
    """設備 IDLE → 正常啟動，排程轉進行中、設備轉 RUNNING。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    cache = {"CH-01": {"status": "IDLE"}}
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(_start_schedule_by_id(sid, cache, locks))

    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert cache["CH-01"]["status"] == "RUNNING"


def test_fallback_retries_after_device_frees_up(session_factory):
    """設備忙 → 排程留 CONFIRMED；設備空出來後，fallback 應能成功啟動。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    locks = {"CH-01": asyncio.Lock()}

    busy = _busy_cache()
    asyncio.run(auto_advance_schedules(busy, locks))
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED

    idle = {"CH-01": {"status": "IDLE"}}
    asyncio.run(auto_advance_schedules(idle, locks))
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert idle["CH-01"]["status"] == "RUNNING"


# ── 治具轉借必須認排程，不能認設備 ────────────────────────────────────────────


def _seed_reserved_fixture(Session, schedule_id: int) -> int:
    with Session() as db:
        f = Fixture(interface_type="USB", form_factor="Desktop", total_quantity=5, is_active=True)
        db.add(f)
        db.flush()
        loan = FixtureLoan(
            fixture_id=f.id,
            borrower_name="排程系統",
            quantity=1,
            status="reserved",
            schedule_id=schedule_id,
        )
        db.add(loan)
        db.commit()
        return loan.id


def _loan_status(Session, loan_id: int) -> str:
    with Session() as db:
        return db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first().status


def test_start_loans_only_its_own_fixtures(session_factory):
    """同一台設備上有另一筆已確認排程時，不得把治具借給那一筆。"""
    Session = session_factory
    other = _seed_confirmed(Session)           # 同設備、較早建立的另一筆已確認排程
    target = _seed_confirmed(Session)
    other_loan = _seed_reserved_fixture(Session, other)
    target_loan = _seed_reserved_fixture(Session, target)

    cache = {"CH-01": {"status": "IDLE"}}
    locks = {"CH-01": asyncio.Lock()}
    asyncio.run(try_start_schedule(target, "CH-01", ["iec60068_ab_-40_16h"], cache, locks))

    assert _loan_status(Session, target_loan) == "loaned", "啟動的排程治具應轉為借出"
    assert _loan_status(Session, other_loan) == "reserved", (
        "治具被借給了同設備上的另一筆排程——轉借依 device_id 猜排程會借錯人"
    )


# ── 手動「▶ 立即開始」（POST /{id}/start）─────────────────────────────────────


def _make_client(TestSession, cache):
    """掛 schedules router 的 admin TestClient，注入指定的設備 cache。"""
    from fastapi import FastAPI, Request
    from fastapi.testclient import TestClient
    from starlette.middleware.base import BaseHTTPMiddleware

    from app.schedules import router as schedules_router

    app = FastAPI()

    class RoleMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            request.state.user_role = "admin"
            request.state.user_id = 1
            request.state.username = "admin"
            return await call_next(request)

    app.add_middleware(RoleMiddleware)
    app.include_router(schedules_router)
    app.state.AICM_CACHE = cache
    app.state.DEVICE_LOCKS = {d: asyncio.Lock() for d in cache}
    return TestClient(app)


def test_manual_start_rejects_busy_device(session_factory):
    """設備非 IDLE → 手動啟動回 409，排程維持「已確認」等 fallback 重試。"""
    Session = session_factory
    sid = _seed_confirmed(Session)

    with patch("app.schedules.SessionLocal", Session):
        client = _make_client(Session, _busy_cache())
        resp = client.post(f"/api/schedules/{sid}/start")

    assert resp.status_code == 409, f"設備忙碌時不得回報啟動成功，實際 {resp.status_code}"
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "啟動失敗卻把排程標為進行中：畫面顯示測試中但設備沒動，且 fallback 不會重試"
    )


def test_manual_start_succeeds_on_idle_device(session_factory):
    """設備 IDLE → 正常啟動，排程轉進行中。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    cache = {"CH-01": {"status": "IDLE"}}

    with patch("app.schedules.SessionLocal", Session):
        client = _make_client(Session, cache)
        resp = client.post(f"/api/schedules/{sid}/start")

    assert resp.status_code == 200
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert cache["CH-01"]["status"] == "RUNNING"
