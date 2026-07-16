"""共用 pytest fixtures"""
from contextlib import contextmanager

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.middleware.base import BaseHTTPMiddleware

from app.models import Base


@pytest.fixture()
def db():
    """每個測試一個全新的 in-memory SQLite，測試結束後自動清除"""
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
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
        engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        TestSession = sessionmaker(bind=engine)
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
