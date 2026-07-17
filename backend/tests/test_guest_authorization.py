"""
Guest 越權防護。

安全屬性：guest（唯讀訪客）不得執行任何需要 admin 權限的業務寫入。
AI 查詢、LINE webhook 與 login/logout/demo-login 是公開流程，不屬於這個限制。

用走訪「實際路由表」而非 grep 來確保涵蓋，並直接驗證每個 admin 寫入 route
都宣告 require_admin dependency。這樣不會因缺 body 回 422、資料不存在回 404
而假通過，也不會在權限遺失時誤執行 handler、碰到真實 DB。

排程 PATCH 也沒有例外：確認、取消與內容修改都必須由 admin 執行。
"""
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.middleware.base import BaseHTTPMiddleware

import app.schedules as schedules_module
from app.auth import require_admin
from app.models import Base, Schedule, ScheduleStatus

WRITE_METHODS = {"POST", "PATCH", "PUT", "DELETE"}
# 「不需 admin」的公開寫入 route——與 auth.py 的 SKIP_PATHS（「不需 token」）語意不同，
# 刻意不共用：這裡含需登入的 ai / logout，且不含 SKIP_PATHS 的唯讀 GET 路徑。
PUBLIC_WRITE_ROUTES = {
    ("POST", "/api/ai/standards-query"),
    ("POST", "/api/ai/standards-query-stream"),
    ("POST", "/api/line/webhook"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/demo-login"),
}
# 走訪失效（框架升級改內部結構）時的最低寫入 route 數守衛，兩個列舉測試共用。
MIN_WRITE_ROUTES = 49


def _walk_mounted_routes(routes, prefix=""):
    """遞迴攤平 FastAPI 0.139 的 _IncludedRouter，回傳有效 path 與原始 route。"""
    for route in routes:
        original_router = getattr(route, "original_router", None)
        if original_router is not None:
            include_prefix = route.include_context.prefix
            yield from _walk_mounted_routes(original_router.routes, prefix + include_prefix)
        else:
            yield prefix + getattr(route, "path", ""), route


def _write_routes():
    """從 production app 的實際掛載樹列舉寫入 routes，保留 dependency metadata。

    FastAPI 0.139 / Starlette 1.3 起，include_router 會在 app.routes 放入巢狀
    _IncludedRouter；必須沿 original_router 遞迴，不能只看 app.routes 頂層。
    """
    import app.main as main_module

    seen = {}
    for path, route in _walk_mounted_routes(main_module.app.routes):
        methods = getattr(route, "methods", None) or set()
        for method in methods & WRITE_METHODS:
            seen[(method, path)] = route
    return [(method, path, route) for (method, path), route in sorted(seen.items())]


def test_admin_write_routes_require_admin():
    """所有非公開寫入 route 必須直接宣告 require_admin，不執行 handler。"""
    routes = _write_routes()

    # 自我守衛：列舉若縮水（走訪失效），下面的 require_admin 檢查會對殘缺集合假通過。
    assert len(routes) >= MIN_WRITE_ROUTES, f"寫入路由數異常偏低（{len(routes)}），列舉可能失效"

    route_keys = {(method, path) for method, path, _ in routes}
    assert PUBLIC_WRITE_ROUTES <= route_keys, "公開寫入 route 清單與實際掛載路由不一致"

    missing = []
    for method, path, route in routes:
        if (method, path) in PUBLIC_WRITE_ROUTES:
            continue
        dependencies = {dependency.call for dependency in route.dependant.dependencies}
        if require_admin not in dependencies:
            missing.append(f"{method} {path}")

    assert not missing, "以下 admin 寫入 route 缺少 require_admin：\n" + "\n".join(missing)


def test_write_route_net_covers_mounted_app():
    """確保 production app 的巢狀路由真的被攤平，而非列舉失效後假通過。"""
    routes = _write_routes()
    assert len(routes) >= MIN_WRITE_ROUTES, f"寫入路由數異常偏低（{len(routes)}），列舉可能失效"
    # execution_router 是先前 grep 漏掉的，明確確認它在網內
    assert any("/api/sop-executions" in path for _, path, _ in routes)
    # 另外確認 auth / fixtures / schedules / devices 四大來源都有被涵蓋
    assert any("/api/auth/users" in path for _, path, _ in routes)
    assert any("/api/fixtures" in path for _, path, _ in routes)
    assert any("/api/schedules" in path for _, path, _ in routes)
    assert any(path.startswith(("/api/devices", "/api/stop")) for _, path, _ in routes)


# ── guest 對排程 PATCH 的邊界 ─────────────────────────────────────────────────
# PATCH 是寫入操作，route 必須直接由 require_admin 擋下。這裡 seed 真實排程，
# 避免未來若誤刪權限 dependency，請求只因資料不存在而回 404、讓越權測試假通過。


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

    # 刻意給非 admin 一個 user_id：即使排程 ownership 相符，也必須由 role 在 route 層擋下。
    # 舊死分支會允許這個身分取消自己的待審核排程，因此能形成有效回歸測試。
    GUEST_ID = 5

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


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"status": ScheduleStatus.CONFIRMED}, id="confirm"),
        pytest.param({"status": ScheduleStatus.CANCELLED}, id="cancel"),
        pytest.param({"note": "guest 不得修改"}, id="edit-note"),
    ],
)
def test_guest_cannot_patch_schedule(guest_client, payload):
    """非 admin 即使帶有相符 owner id，任何排程 PATCH 仍由 require_admin 擋下。"""
    client, Session = guest_client
    sid = _seed(Session, applicant_user_id=5)

    resp = client.patch(f"/api/schedules/{sid}", json=payload)

    assert resp.status_code == 403
    assert resp.json() == {"detail": "需要管理者權限"}
    assert _status(Session, sid) == ScheduleStatus.PENDING
