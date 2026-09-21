"""LINE webhook 的簽章驗證。

`POST /api/line/webhook` 是全專案唯一不經 require_admin、由外部直接呼叫的端點，
擋在前面的只有這道 HMAC-SHA256 簽章。以前它兩個方向都沒有測試（BUG-016）。

這裡刻意每條測試都自己設 `LINE_CHANNEL_SECRET`：沒設 secret 時 `_verify_signature`
會直接 return True，所以不設而測「過了」，測到的是放行分支、不是驗證本身。
E2E 環境正是沒設 secret 的（`tests/e2e/run-e2e.sh`），那邊驗不到這段。
"""
import base64
import hashlib
import hmac
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.line as line_module
from app.line import router as line_router

SECRET = "test-channel-secret"
BODY = json.dumps({"events": []}).encode()


def _sign(body: bytes, secret: str) -> str:
    digest = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


@pytest.fixture()
def client(monkeypatch):
    """掛上 webhook 路由的 TestClient，並設好 secret 與 app.state。

    webhook 會讀 app.state.http_client 與 AICM_CACHE；events 給空陣列就不會走到
    回覆流程，所以放替身即可。
    """
    monkeypatch.setattr(line_module, "LINE_CHANNEL_SECRET", SECRET)
    app = FastAPI()
    app.include_router(line_router)
    app.state.http_client = object()
    app.state.AICM_CACHE = {}
    with TestClient(app) as c:
        yield c


def test_valid_signature_is_accepted(client):
    resp = client.post(
        "/api/line/webhook",
        content=BODY,
        headers={"X-Line-Signature": _sign(BODY, SECRET)},
    )
    assert resp.status_code == 200


def test_wrong_signature_is_rejected(client):
    """用別的 secret 簽出來的請求要被擋下來。"""
    resp = client.post(
        "/api/line/webhook",
        content=BODY,
        headers={"X-Line-Signature": _sign(BODY, "someone-elses-secret")},
    )
    assert resp.status_code == 400


def test_missing_signature_header_is_rejected(client):
    resp = client.post("/api/line/webhook", content=BODY)
    assert resp.status_code == 400


def test_tampered_body_is_rejected(client):
    """簽章是對的，但內容被改過——簽章綁的是 body，改了就對不上。"""
    tampered = json.dumps({"events": [{"type": "message"}]}).encode()
    resp = client.post(
        "/api/line/webhook",
        content=tampered,
        headers={"X-Line-Signature": _sign(BODY, SECRET)},
    )
    assert resp.status_code == 400


def test_unset_secret_lets_everything_through(client, monkeypatch):
    """沒設 secret 時一律放行——這是刻意的，但要釘住，不要哪天變成「沒設就全擋」
    而讓本機與 Demo 環境的 webhook 整條不能用。

    這條同時說明為什麼上面每條都要自己設 secret：在這個分支底下，任何簽章都會過。
    `_verify_signature` 是在呼叫當下才讀那個變數，所以在 fixture 之後再蓋成空字串
    就會生效，不必自己再建一次 app。
    """
    monkeypatch.setattr(line_module, "LINE_CHANNEL_SECRET", "")

    resp = client.post(
        "/api/line/webhook",
        content=BODY,
        headers={"X-Line-Signature": "obviously-not-a-real-signature"},
    )
    assert resp.status_code == 200
