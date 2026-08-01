"""一鍵訪客 Token 的登入與唯讀存取回歸測試。"""

import datetime
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

import app.auth as auth_module
from app.models import DemoToken
from app.utils import _now_utc_naive


@pytest.fixture()
def guest_app(patched_session, monkeypatch):
    """以真實 auth middleware 驗證一鍵登入後的後續 API 請求。"""
    monkeypatch.setattr(auth_module, "DEMO_PASSWORD", "test-master-key")
    auth_module._fail_tracker.clear()

    with patched_session("app.auth") as Session:
        app = FastAPI()

        @app.get("/api/protected-read")
        def protected_read(request: Request):
            return {"role": getattr(request.state, "user_role", None)}

        @app.post("/api/protected-write")
        def protected_write(_: None = Depends(auth_module.require_admin)):
            return {"ok": True}

        app.include_router(auth_module.router)
        app.add_middleware(BaseHTTPMiddleware, dispatch=auth_module.auth_middleware)

        with TestClient(app) as client:
            yield client, Session

    auth_module._fail_tracker.clear()


def test_one_click_guest_can_read_after_login_but_cannot_write(guest_app):
    client, Session = guest_app

    hint_response = client.get("/api/auth/guest-hint")
    assert hint_response.status_code == 200
    token = hint_response.json()["token"]

    login_response = client.post("/api/auth/demo-login", json={"token": token})
    assert login_response.status_code == 200

    headers = {"X-Demo-Password": token}
    read_response = client.get("/api/protected-read", headers=headers)
    write_response = client.post("/api/protected-write", headers=headers)

    assert read_response.status_code == 200
    assert read_response.json() == {"role": "guest"}
    assert write_response.status_code == 403
    assert write_response.json() == {"detail": "需要管理者權限"}

    with Session() as db:
        saved = db.query(DemoToken).filter(DemoToken.token == token).one()
        assert saved.max_uses is None
        assert saved.use_count == 1


def test_guest_hint_reuses_active_auto_token_and_only_removes_expired_auto_tokens(guest_app):
    client, Session = guest_app
    now = _now_utc_naive()

    with Session() as db:
        db.add_all([
            DemoToken(
                token="ACTIVE01",
                label="auto-hint",
                expires_at=now + datetime.timedelta(minutes=30),
            ),
            DemoToken(
                token="EXPIRED1",
                label="auto-hint",
                expires_at=now - datetime.timedelta(minutes=1),
            ),
            DemoToken(
                token="MANUAL01",
                label="manual",
                expires_at=now - datetime.timedelta(minutes=1),
            ),
        ])
        db.commit()

    response = client.get("/api/auth/guest-hint")
    assert response.status_code == 200
    returned_token = response.json()["token"]

    with Session() as db:
        tokens = {row.token: row for row in db.query(DemoToken).all()}

    assert "ACTIVE01" in tokens
    assert "EXPIRED1" not in tokens
    assert "MANUAL01" in tokens
    assert returned_token == "ACTIVE01"
    assert set(tokens) == {"ACTIVE01", "MANUAL01"}

    repeated_response = client.get("/api/auth/guest-hint")
    assert repeated_response.json()["token"] == "ACTIVE01"
    with Session() as db:
        assert db.query(DemoToken).count() == 2


def test_concurrent_guest_hint_requests_share_one_token(guest_app):
    client, Session = guest_app

    with ThreadPoolExecutor(max_workers=8) as executor:
        responses = list(executor.map(lambda _: client.get("/api/auth/guest-hint"), range(8)))

    assert all(response.status_code == 200 for response in responses)
    tokens = {response.json()["token"] for response in responses}
    assert len(tokens) == 1
    with Session() as db:
        assert db.query(DemoToken).filter(DemoToken.label == "auto-hint").count() == 1
