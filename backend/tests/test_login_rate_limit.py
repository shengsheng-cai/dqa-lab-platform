"""
登入失敗鎖定的端點行為。

「連錯 5 次鎖 10 分鐘」原本只有規則檔用一句話描述，程式碼裡沒有任何測試守著，
改壞不會有東西紅。這裡把它釘住。

最後一條驗的是殺傷範圍：封鎖檢查排在驗證憑證之前，所以計數一滿，連帶著有效憑證、
正在操作的訪客也會被擋掉。HF 上少了代理來源設定時，所有人共用同一個計數器，就是
靠這條路變成「一個人失敗、全站十分鐘不能用」（見 test_deploy_config.py）。
"""
import bcrypt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

import app.auth as auth_module
from app.models import User

PASSWORD = "correct-horse"
GUEST_TOKEN = "test-master-key"

# 正式環境的雜湊成本是 12，算一次要 0.2 秒，而這個檔案會驗二十幾次密碼。成本記在
# 雜湊字串本身，所以調低它不會繞過任何東西：真的端點、真的 verify_password、真的
# bcrypt 比對都照跑，只是少做幾輪延展。密碼錯的時候一樣會錯。
_STORED_HASH = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()


@pytest.fixture()
def login_client(patched_session, monkeypatch):
    """掛真的登入端點與 auth middleware，DB 走 in-memory。"""
    monkeypatch.setattr(auth_module, "DEMO_PASSWORD", GUEST_TOKEN)
    auth_module._fail_tracker.clear()

    with patched_session("app.auth") as Session:
        with Session() as db:
            db.add(
                User(
                    id=1,
                    username="admin",
                    display_name="管理者",
                    hashed_password=_STORED_HASH,
                    role="admin",
                )
            )
            db.commit()

        app = FastAPI()

        @app.get("/api/protected-read")
        def protected_read():
            return {"ok": True}

        app.include_router(auth_module.router)
        app.add_middleware(BaseHTTPMiddleware, dispatch=auth_module.auth_middleware)

        with TestClient(app) as client:
            yield client

    auth_module._fail_tracker.clear()


def _login(client, password):
    return client.post("/api/auth/login", json={"username": "admin", "password": password})


def test_repeated_wrong_passwords_end_in_a_block(login_client):
    """前幾次是 401，第 MAX_ATTEMPTS 次才轉成 429。"""
    for _ in range(auth_module.MAX_ATTEMPTS - 1):
        assert _login(login_client, "wrong").status_code == 401

    blocked = _login(login_client, "wrong")
    assert blocked.status_code == 429
    assert "封鎖" in blocked.json()["detail"]


def test_correct_password_is_still_refused_while_blocked(login_client):
    """封鎖期間連正確密碼都進不去，所以鎖住的十分鐘是真的沒有路。"""
    for _ in range(auth_module.MAX_ATTEMPTS):
        _login(login_client, "wrong")

    refused = _login(login_client, PASSWORD)
    assert refused.status_code == 429
    assert "秒後再試" in refused.json()["detail"]


def test_successful_login_clears_the_failure_count(login_client):
    """成功一次就歸零，否則偶爾打錯的人會被慢慢累積到封鎖。"""
    for _ in range(auth_module.MAX_ATTEMPTS - 1):
        assert _login(login_client, "wrong").status_code == 401

    assert _login(login_client, PASSWORD).status_code == 200

    # 再錯滿 MAX_ATTEMPTS - 1 次都還是 401，證明計數真的回到 0，不只是掉到門檻以下
    for _ in range(auth_module.MAX_ATTEMPTS - 1):
        assert _login(login_client, "wrong").status_code == 401


def test_block_also_shuts_out_a_guest_holding_a_valid_token(login_client):
    """封鎖檢查排在驗證憑證之前，所以被鎖到的不只是失敗的那個人。"""
    headers = {"X-Demo-Password": GUEST_TOKEN}
    assert login_client.get("/api/protected-read", headers=headers).status_code == 200

    # 完全不帶憑證的請求會累積失敗次數（防暴力掃描）
    for _ in range(auth_module.MAX_ATTEMPTS):
        login_client.get("/api/protected-read")

    shut_out = login_client.get("/api/protected-read", headers=headers)
    assert shut_out.status_code == 429
