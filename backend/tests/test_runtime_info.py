"""`/api/runtime-info` 對管理者與訪客各給什麼。

訪客要拿得到 ai_enabled，AI 面板才知道該不該把輸入停掉並寫出原因；
但 warnings 那幾句會寫出缺哪個環境變數，其餘能力旗標也是部署細節，一律不給訪客。
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

import app.main as main_module
from app.main import PUBLIC_CAPABILITIES, _runtime_info_for, runtime_info

FAKE_INFO = {
    "environment": "test",
    "platform": {"hf_space": False},
    "capabilities": {
        "ai_enabled": False,
        "line_push_enabled": False,
        "admin_password_configured": False,
        "persistent_db": True,
    },
    "warnings": [
        {"code": "ai_disabled", "message": "AI 諮詢未啟用（缺 GEMINI_API_KEY）。"},
        {"code": "admin_password_missing", "message": "ADMIN_PASSWORD 未設定，……"},
    ],
}


def test_admin_gets_everything():
    assert _runtime_info_for("admin", FAKE_INFO) == FAKE_INFO


def test_guest_gets_exactly_one_flag_and_no_warnings():
    # 用全等而不是逐鍵檢查：多漏出一個鍵就紅，包含沒人想到要檢查的那些
    assert _runtime_info_for("guest", FAKE_INFO) == {
        "capabilities": {"ai_enabled": False},
        "warnings": [],
    }


def test_guest_sees_ai_enabled_when_it_really_is_on():
    info = {**FAKE_INFO, "capabilities": {**FAKE_INFO["capabilities"], "ai_enabled": True}}

    assert _runtime_info_for("guest", info)["capabilities"]["ai_enabled"] is True


def test_unknown_role_is_treated_as_guest():
    # 認證中介層沒設角色時 current_user 會回 None，不能因此退回完整內容
    assert _runtime_info_for(None, FAKE_INFO) == _runtime_info_for("guest", FAKE_INFO)


def test_public_capabilities_never_includes_deployment_details():
    leaky = {"line_push_enabled", "admin_password_configured", "persistent_db"}

    assert PUBLIC_CAPABILITIES.isdisjoint(leaky)


def test_guest_is_not_blocked_from_the_endpoint(monkeypatch):
    """這條盯的是「訪客打得進來」，不是內容——內容由上面那幾條純函式測試顧。

    以前這支端點掛著 `Depends(require_admin)`，訪客會拿到 403 而不是旗標。
    走真的 HTTP 才擋得住那個相依性被加回來。
    """
    monkeypatch.setattr(main_module.app.state, "runtime_info", FAKE_INFO, raising=False)

    app = FastAPI()

    class RoleMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            request.state.user_role = "guest"
            return await call_next(request)

    app.add_middleware(RoleMiddleware)
    app.add_api_route("/api/runtime-info", runtime_info)

    with TestClient(app) as client:
        response = client.get("/api/runtime-info")

    assert response.status_code == 200
    assert response.json()["capabilities"] == {"ai_enabled": False}
