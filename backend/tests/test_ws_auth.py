"""WebSocket 短效 ticket 的認證邊界。"""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.websockets import WebSocketDisconnect

import app.auth as auth_module
import app.ws as ws_module


@pytest.fixture()
def ws_client(patched_session, monkeypatch):
    """掛真實 auth middleware 的 TestClient；DB 走 in-memory，不碰開發用的 aicm.db。"""
    monkeypatch.setattr(auth_module, "DEMO_PASSWORD", "test-master-key")
    monkeypatch.setattr(ws_module, "build_device_list", lambda _: [{"device_id": "CH-01"}])
    auth_module._fail_tracker.clear()
    auth_module._ws_tickets.clear()
    ws_module.manager._connections.clear()

    with patched_session("app.auth"):
        app = FastAPI()
        app.include_router(auth_module.router)
        app.include_router(ws_module.router)
        app.add_middleware(BaseHTTPMiddleware, dispatch=auth_module.auth_middleware)
        app.state.AICM_CACHE = {}

        with TestClient(app) as client:
            yield client

    auth_module._fail_tracker.clear()
    auth_module._ws_tickets.clear()
    ws_module.manager._connections.clear()


def _issue_ticket(client: TestClient) -> str:
    response = client.post(
        "/api/auth/ws-ticket",
        headers={"X-Demo-Password": "test-master-key"},
    )
    assert response.status_code == 200
    assert response.json()["expires_in"] == auth_module.WS_TICKET_TTL_SECONDS
    return response.json()["ticket"]


def _assert_rejected(client: TestClient, path: str, subprotocols=None):
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(path, subprotocols=subprotocols):
            pass
    assert exc_info.value.code == 4001


def test_ticket_endpoint_requires_existing_http_auth_and_ws_url_has_no_credential(ws_client):
    unauthenticated = ws_client.post("/api/auth/ws-ticket")
    assert unauthenticated.status_code == 401

    ticket = _issue_ticket(ws_client)
    protocol = f"{ws_module._TICKET_PROTOCOL_PREFIX}{ticket}"
    with ws_client.websocket_connect("/ws/devices", subprotocols=[protocol]) as websocket:
        assert websocket.accepted_subprotocol == protocol
        assert websocket.receive_json() == [{"device_id": "CH-01"}]


def test_ticket_is_one_time_and_long_lived_query_token_is_rejected(ws_client):
    ticket = _issue_ticket(ws_client)
    protocol = f"{ws_module._TICKET_PROTOCOL_PREFIX}{ticket}"

    with ws_client.websocket_connect("/ws/devices", subprotocols=[protocol]) as websocket:
        assert websocket.receive_json() == [{"device_id": "CH-01"}]

    _assert_rejected(ws_client, "/ws/devices", subprotocols=[protocol])
    _assert_rejected(ws_client, "/ws/devices?token=long-lived-admin-token")


def test_expired_ticket_is_rejected(ws_client, monkeypatch):
    now = 100.0
    monkeypatch.setattr(auth_module.time, "monotonic", lambda: now)
    ticket = _issue_ticket(ws_client)

    now += auth_module.WS_TICKET_TTL_SECONDS + 1
    protocol = f"{ws_module._TICKET_PROTOCOL_PREFIX}{ticket}"
    _assert_rejected(ws_client, "/ws/devices", subprotocols=[protocol])


def test_concurrent_ticket_replay_has_exactly_one_winner():
    auth_module._ws_tickets.clear()
    ticket = auth_module._issue_ws_ticket()

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: auth_module.consume_ws_ticket(ticket), range(8)))

    assert results.count(True) == 1
    assert results.count(False) == 7
    auth_module._ws_tickets.clear()
