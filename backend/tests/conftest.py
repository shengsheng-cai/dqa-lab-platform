"""共用 pytest fixtures"""
from contextlib import ExitStack, contextmanager
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.middleware.base import BaseHTTPMiddleware

from app.models import Base


def _make_memory_db():
    """建一個 in-memory SQLite（含所有表）並回傳 (engine, sessionmaker)。

    用 StaticPool 讓所有連線共用同一個 in-memory DB——否則 SQLite 預設是「一條執行緒
    一條連線」，跑在 asyncio.to_thread 裡的 DB 寫入會連到另一個空的 in-memory DB、看不到
    建好的表（auto_start_sop 的執行紀錄就是走 to_thread）。
    三個 fixture（db / api_client / patched_session）共用這一份建置，避免逐檔漂移。
    用完由呼叫端負責 Base.metadata.drop_all(engine)。
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine)


@pytest.fixture()
def db():
    """每個測試一個全新的 in-memory SQLite，測試結束後自動清除。"""
    engine, Session = _make_memory_db()
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture()
def api_client():
    """回傳 context-manager factory：建 in-memory SQLite + role 注入的 TestClient。

    收斂原本 test_fixtures_api / test_maintenance / test_schedule_conflict 各自複製的
    「engine + StaticPool + patch module.SessionLocal + RoleMiddleware + TestClient」建置。

    用法：
        with api_client(module, router, role="admin") as (client, Session):
            resp = client.post(...)

    - module.SessionLocal 導向測試 session，離開 context 還原並清庫
    - role / user_id / username 為 None 時該欄位不注入（沿用 handler 的 getattr 預設）
    - app_state：需掛在 app.state 的額外物件（如排程用的 AICM_CACHE / DEVICE_LOCKS）
    - yield (client, Session)：只需要 client 的呼叫端解包後忽略 Session 即可
    """
    @contextmanager
    def _make(module, router, *, role="admin", user_id=None, username=None, app_state=None):
        # 只 patch 傳入的單一 module；跨多模組寫 DB 的流程請改用 patched_session。
        engine, TestSession = _make_memory_db()
        original_session = module.SessionLocal
        module.SessionLocal = lambda: TestSession()  # type: ignore[assignment]

        app = FastAPI()

        class RoleMiddleware(BaseHTTPMiddleware):
            async def dispatch(self, request: Request, call_next):
                if role is not None:
                    request.state.user_role = role
                if user_id is not None:
                    request.state.user_id = user_id
                if username is not None:
                    request.state.username = username
                return await call_next(request)

        app.add_middleware(RoleMiddleware)
        app.include_router(router)
        for key, value in (app_state or {}).items():
            setattr(app.state, key, value)

        try:
            with TestClient(app) as client:
                yield client, TestSession
        finally:
            module.SessionLocal = original_session  # type: ignore[assignment]
            Base.metadata.drop_all(engine)

    return _make


@pytest.fixture()
def patched_session():
    """回傳 context-manager factory：建 in-memory SQLite（StaticPool）並對傳入的多個模組
    一次 patch 掉 SessionLocal，離開時還原並清庫。給「直接呼叫函式、不經 HTTP」的測試用。

    多模組一起 patch 是重點：一個啟動流程常跨 schedule_service / sop / utils 三個模組寫 DB，
    漏 patch 任一個，那個模組就會寫進真實的 aicm.db。集中在這裡就不會逐檔漏。

    用法：
        with patched_session("app.schedule_service", "app.sop", "app.utils") as Session:
            ...
    """
    @contextmanager
    def _make(*module_paths):
        engine, TestSession = _make_memory_db()
        with ExitStack() as stack:
            for module_path in module_paths:
                stack.enter_context(patch(f"{module_path}.SessionLocal", TestSession))
            try:
                yield TestSession
            finally:
                Base.metadata.drop_all(engine)

    return _make
