"""共用 pytest fixtures"""
import uuid
from contextlib import ExitStack, contextmanager
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
from starlette.middleware.base import BaseHTTPMiddleware

from app.device_state import DeviceStateManager
from app.models import Base


def _make_memory_db():
    """建一個 in-memory SQLite（含所有表）並回傳 (engine, sessionmaker)。

    用具名 shared-cache 讓每條 thread 使用獨立連線，但仍看見同一個 in-memory DB。
    URI 的 uri=true 必須放在 SQLAlchemy URL 裡；否則 file:... 會被當成實體檔名。
    QueuePool 避免 StaticPool 把同一條 sqlite3 連線同時交給多條 thread。
    三個 fixture（db / api_client / patched_session）共用這一份建置，避免逐檔漂移。
    資料庫的壽命綁在連線上：撐住它的是 create_all 用完還留在池子裡的那條，換成
    NullPool 之類不留連線的池子，表會憑空消失。
    用完由呼叫端負責 engine.dispose()：連線全關，這個具名 DB 就跟著消失，不必 drop_all。
    """
    engine = create_engine(
        f"sqlite:///file:dqa_test_{uuid.uuid4().hex}?mode=memory&cache=shared&uri=true",
        connect_args={"check_same_thread": False},
        poolclass=QueuePool,
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
    engine.dispose()


@pytest.fixture()
def api_client():
    """回傳 context-manager factory：建 in-memory SQLite + role 注入的 TestClient。

    收斂原本 test_fixtures_api / test_maintenance / test_schedule_conflict 各自複製的
    「engine + patch module.SessionLocal + RoleMiddleware + TestClient」建置。

    用法：
        with api_client(module, router, role="admin") as (client, Session):
            resp = client.post(...)

    - module.SessionLocal 導向測試 session，離開 context 還原並清庫
    - role / user_id / username 為 None 時該欄位不注入（沿用 handler 的 getattr 預設）
    - app_state：需掛在 app.state 的額外物件（如排程用的 AICM_CACHE）
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
        if not hasattr(app.state, "DEVICE_STATE"):
            raw_cache = getattr(app.state, "AICM_CACHE", {})
            states = DeviceStateManager(raw_cache)
            app.state.DEVICE_STATE = states
            app.state.AICM_CACHE = states

        try:
            with TestClient(app) as client:
                yield client, TestSession
        finally:
            module.SessionLocal = original_session  # type: ignore[assignment]
            engine.dispose()

    return _make


@pytest.fixture()
def patched_session():
    """回傳 context-manager factory：建 in-memory SQLite 並對傳入的多個模組
    一次 patch 掉 SessionLocal，離開時還原並清庫。給「直接呼叫函式、不經 HTTP」的測試用。

    多模組一起 patch 是重點：一個啟動流程常跨 schedule_service / sop / utils 三個模組寫 DB，
    漏 patch 任一個，那個模組就會寫進真實的 aicm.db。集中在這裡就不會逐檔漏。

    用法：
        with patched_session("app.schedule_service", "app.sop", "app.device_state") as Session:
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
                engine.dispose()

    return _make
