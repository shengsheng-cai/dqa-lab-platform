"""
T-05: auth 模組純函數測試
"""
import time
import pytest
from app.auth import hash_password, verify_password, _get_tracker, _fail_tracker


# ── hash_password / verify_password ───────────────────────────────────────


def test_hash_password_returns_string():
    hashed = hash_password("mypassword")
    assert isinstance(hashed, str)
    assert hashed != "mypassword"


def test_verify_password_correct():
    hashed = hash_password("secret123")
    assert verify_password("secret123", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("secret123")
    assert verify_password("wrongpassword", hashed) is False


def test_verify_password_empty_string():
    hashed = hash_password("secret")
    assert verify_password("", hashed) is False


def test_hash_same_password_gives_different_hash():
    """bcrypt 每次 gensalt 不同，同一密碼不應產生相同 hash"""
    h1 = hash_password("abc")
    h2 = hash_password("abc")
    assert h1 != h2


# ── _get_tracker rate limiting ─────────────────────────────────────────────


@pytest.fixture(autouse=True)
def clean_tracker():
    """每個測試前後清空全域 _fail_tracker，避免測試間互相影響"""
    _fail_tracker.clear()
    yield
    _fail_tracker.clear()


def test_new_ip_starts_with_zero():
    t = _get_tracker("1.2.3.4")
    assert t["count"] == 0


def test_same_ip_returns_same_tracker():
    t1 = _get_tracker("5.5.5.5")
    t1["count"] = 3
    t2 = _get_tracker("5.5.5.5")
    assert t2["count"] == 3


def test_different_ips_are_independent():
    ta = _get_tracker("10.0.0.1")
    tb = _get_tracker("10.0.0.2")
    ta["count"] = 5
    assert tb["count"] == 0


