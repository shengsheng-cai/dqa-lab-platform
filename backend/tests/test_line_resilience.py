"""
LINE 推播韌性：外部服務失敗不得影響觸發它的業務流程。

push_message 一律以 asyncio.create_task fire-and-forget 呼叫（緊急停止、條件完成、
測試完成）。它必須自行吞下所有失敗——未設定、非 200、網路例外——絕不向外拋，
否則會變成未處理的 task 例外，或讓緊急停止等關鍵操作連帶失敗。
"""
import asyncio

import httpx

import app.line as line_module
from app.line import push_message


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _FakeClient:
    """替身 httpx.AsyncClient：post 依設定回傳指定狀態碼或拋例外。"""
    def __init__(self, status_code=200, exc=None):
        self._status_code = status_code
        self._exc = exc
        self.called = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def post(self, *_a, **_kw):
        self.called = True
        if self._exc:
            raise self._exc
        return httpx.Response(self._status_code, request=httpx.Request("POST", "https://api.line.me"))


def _configure(monkeypatch, token="tok", target="U123"):
    monkeypatch.setattr(line_module, "LINE_CHANNEL_ACCESS_TOKEN", token)
    monkeypatch.setattr(line_module, "LINE_USER_ID", target)


def test_push_unconfigured_returns_without_calling(monkeypatch):
    """未設定 token/目標 → 直接跳過，不呼叫 httpx、不拋例外。"""
    _configure(monkeypatch, token="", target="")
    fake = _FakeClient()
    monkeypatch.setattr(line_module.httpx, "AsyncClient", lambda *a, **k: fake)

    _run(push_message("測試"))  # 不得拋例外

    assert fake.called is False, "未設定時不應發出任何 HTTP 請求"


def test_push_non_200_is_swallowed(monkeypatch):
    """LINE 回非 200 → 記 log 但不拋，觸發流程不受影響。"""
    _configure(monkeypatch)
    fake = _FakeClient(status_code=500)
    monkeypatch.setattr(line_module.httpx, "AsyncClient", lambda *a, **k: fake)

    _run(push_message("測試"))  # 不得拋例外

    assert fake.called is True


def test_push_network_exception_is_swallowed(monkeypatch):
    """網路層例外（連線失敗/逾時）→ 被吞掉，不向外傳播。"""
    _configure(monkeypatch)
    fake = _FakeClient(exc=httpx.ConnectError("connection refused"))
    monkeypatch.setattr(line_module.httpx, "AsyncClient", lambda *a, **k: fake)

    # 若 push_message 讓例外逸出，這裡會 raise，測試失敗
    _run(push_message("測試"))


def test_push_timeout_is_swallowed(monkeypatch):
    """逾時例外同樣不得逸出。"""
    _configure(monkeypatch)
    fake = _FakeClient(exc=httpx.TimeoutException("timed out"))
    monkeypatch.setattr(line_module.httpx, "AsyncClient", lambda *a, **k: fake)

    _run(push_message("測試"))
