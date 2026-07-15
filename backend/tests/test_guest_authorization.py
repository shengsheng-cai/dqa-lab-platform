"""
Guest 越權防護。

安全屬性：guest（唯讀訪客）不得成功執行任何寫入操作。

用走訪「實際路由表」而非 grep 來確保涵蓋——先前用 grep 掃描曾漏掉整個
execution_router（正則只比對 @router.，沒比對 @execution_router.）。走訪路由表
不管路由掛在哪個變數名都涵蓋得到，是唯一可靠的回歸網。

唯一允許 guest 寫入的例外：取消自己的待審核排程。其完整語義由 test_guest_may_cancel_*
一組測試釘住。
"""
import re

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.middleware.base import BaseHTTPMiddleware

import app.schedules as schedules_module
from app.models import Base, Schedule, ScheduleStatus

WRITE_METHODS = {"POST", "PATCH", "PUT", "DELETE"}


def _all_write_routers():
    """所有帶寫入端點的 router（含非 `router` 變數名的，例如 execution_router）。"""
    import app.devices as devices
    import app.devices_maintenance as maintenance
    import app.fixtures as fixtures
    import app.purchase_orders as purchase_orders
    import app.schedules as schedules
    import app.sop as sop
    return [
        fixtures.router,
        purchase_orders.router,
        schedules.router,
        schedules.blocked_router,
        sop.router,
        sop.execution_router,
        devices.router,
        maintenance.router,
    ]


def _make_guest_app(routers, session=None):
    app = FastAPI()

    class GuestMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            request.state.user_role = "guest"
            request.state.user_id = None
            request.state.username = None
            return await call_next(request)

    app.add_middleware(GuestMiddleware)
    for r in routers:
        app.include_router(r)
    app.state.AICM_CACHE = {}
    app.state.DEVICE_LOCKS = {}
    return app


def _write_routes(app):
    """(method, concrete_path)：把 {param} 代成 1。"""
    seen = []
    for route in app.routes:
        methods = getattr(route, "methods", None) or set()
        for m in methods & WRITE_METHODS:
            path = re.sub(r"\{[^}]+\}", "1", route.path)
            seen.append((m, path))
    return sorted(set(seen))


def test_guest_cannot_write_any_endpoint():
    """走訪每個寫入路由，guest 一律不得拿到 2xx。"""
    app = _make_guest_app(_all_write_routers())
    client = TestClient(app)

    leaks = []
    for method, path in _write_routes(app):
        resp = client.request(method, path)
        if 200 <= resp.status_code < 300:
            leaks.append(f"{method} {path} → {resp.status_code}")

    assert not leaks, "guest 成功寫入了以下端點（缺 require_admin）：\n" + "\n".join(leaks)


def test_write_route_net_is_non_empty():
    """確保上面的走訪真的掃到了端點，而不是路由表為空的假通過。"""
    app = _make_guest_app(_all_write_routers())
    routes = _write_routes(app)
    assert len(routes) >= 20, f"寫入路由數異常偏低（{len(routes)}），走訪可能沒掛到 router"
    # execution_router 是先前 grep 漏掉的，明確確認它在網內
    assert any("/api/sop-executions" in p for _, p in routes)


# ── guest 對排程 PATCH 的邊界 ─────────────────────────────────────────────────
#
# 觀察：route 層「非取消一律 403」暗示 guest 能取消自己的排程，但下游
# _patch_schedule_db 的第一道檢查是「user_id is None → 403」。現行 2 角色模型下
# guest 的 user_id 恆為 None，所以 guest 連取消都做不到——完全唯讀。
# 這是 fail-closed（安全），但兩層意圖不一致；「取消自己排程」的成功路徑實際上
# 只有具 user_id 的非 admin 登入者可達，而該角色目前不存在。已記入 CLAUDE.local.md。


@pytest.fixture()
def guest_client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine)

    original = schedules_module.SessionLocal
    schedules_module.SessionLocal = lambda: TestSession()  # type: ignore[assignment]

    GUEST_ID = None  # guest 的 user_id 一律為 None

    app = FastAPI()

    class GuestMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            request.state.user_role = "guest"
            request.state.user_id = GUEST_ID
            request.state.username = None
            return await call_next(request)

    app.add_middleware(GuestMiddleware)
    app.include_router(schedules_module.router)
    app.state.AICM_CACHE = {}
    app.state.DEVICE_LOCKS = {}

    with TestClient(app) as client:
        yield client, TestSession

    schedules_module.SessionLocal = original  # type: ignore[assignment]
    Base.metadata.drop_all(engine)


def _seed(Session, applicant_user_id, status=ScheduleStatus.PENDING) -> int:
    with Session() as db:
        s = Schedule(
            project_number="P-001",
            sample_name="樣品",
            applicant_user_id=applicant_user_id,
            standard="IEC 60068",
            conditions='["iec60068_ab_-40_16h"]',
            status=status,
        )
        db.add(s)
        db.commit()
        return s.id


def _status(Session, sid) -> str:
    with Session() as db:
        return db.query(Schedule).filter(Schedule.id == sid).first().status


def test_guest_cannot_do_non_cancel_patch(guest_client):
    """guest 對排程做「取消以外」的變更（例如審核確認）→ 403。"""
    client, Session = guest_client
    sid = _seed(Session, applicant_user_id=None)

    resp = client.patch(f"/api/schedules/{sid}", json={"status": ScheduleStatus.CONFIRMED})

    assert resp.status_code == 403
    assert _status(Session, sid) == ScheduleStatus.PENDING


def test_guest_cannot_cancel_someone_elses_schedule(guest_client):
    """guest 不得取消他人（applicant_user_id=5）的排程 → 403。"""
    client, Session = guest_client
    sid = _seed(Session, applicant_user_id=5)

    resp = client.patch(f"/api/schedules/{sid}", json={"status": ScheduleStatus.CANCELLED})

    assert resp.status_code == 403
    assert _status(Session, sid) == ScheduleStatus.PENDING


def test_guest_cannot_cancel_even_ownerless_schedule(guest_client):
    """即使排程 applicant_user_id 也是 None，guest 仍不得取消 → 403。

    釘住「guest 完全唯讀」：下游 `user_id is None → 403` 最先觸發，
    所以 guest 對排程的任何 PATCH（含取消）都被擋，不會走到狀態/歸屬判斷。
    """
    client, Session = guest_client
    sid = _seed(Session, applicant_user_id=None)

    resp = client.patch(f"/api/schedules/{sid}", json={"status": ScheduleStatus.CANCELLED})

    assert resp.status_code == 403
    assert _status(Session, sid) == ScheduleStatus.PENDING
