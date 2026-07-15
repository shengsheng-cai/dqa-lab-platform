import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException

import app.ai as ai_module
from app.ai import QueryRequest


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()


def _messages(caplog):
    return "\n".join(record.getMessage() for record in caplog.records)


def _query_request():
    return QueryRequest(message="高溫", history=[])


async def _fake_context(_message, _history=None):
    return "- [S:SOP-A] 測試條件", ["SOP-A"]


def _patch_common(monkeypatch):
    monkeypatch.setattr(ai_module, "_build_context", _fake_context)
    monkeypatch.setattr(ai_module, "_get_api_key", lambda: "SECRET_KEY")
    monkeypatch.setattr(ai_module, "get_all_sop_ids", lambda: {"SOP-A"})


class FakeJsonResponse:
    def __init__(self, status_code=200, payload=None, raise_status=False):
        self.status_code = status_code
        self._payload = payload or {
            "candidates": [{"content": {"parts": [{"text": "建議測試 [APPLY:SOP-A]"}]}}]
        }
        self._raise_status = raise_status

    def raise_for_status(self):
        if self._raise_status:
            request = httpx.Request(
                "POST",
                "https://generativelanguage.googleapis.com/fake?key=SECRET_KEY",
            )
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("upstream failed", request=request, response=response)

    def json(self):
        return self._payload


class FakePostClient:
    def __init__(self, response=None, exc=None, **_kwargs):
        self.response = response or FakeJsonResponse()
        self.exc = exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, *_args, **_kwargs):
        if self.exc:
            raise self.exc
        return self.response


class FakeStreamResponse:
    def __init__(self, status_code=200, lines=None):
        self.status_code = status_code
        self.lines = lines or []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def aiter_lines(self):
        for line in self.lines:
            yield line


class FakeStreamClient:
    def __init__(self, response=None, exc=None, **_kwargs):
        self.response = response or FakeStreamResponse()
        self.exc = exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    def stream(self, *_args, **_kwargs):
        if self.exc:
            raise self.exc
        return self.response


def _sse_text(text):
    return "data: " + json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}}]})


async def _collect_stream(response):
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
    return "".join(chunks)


async def _call_and_collect_stream(request):
    response = await ai_module.standards_query_stream(request)
    return await _collect_stream(response)


def test_standards_query_logs_success(monkeypatch, caplog):
    _patch_common(monkeypatch)
    monkeypatch.setattr(ai_module.httpx, "AsyncClient", FakePostClient)

    with caplog.at_level("INFO", logger="ai"):
        response = _run_async(ai_module.standards_query(_query_request()))

    assert response.reply == "建議測試 [APPLY:SOP-A]"
    text = _messages(caplog)
    assert "ai_call endpoint=standards-query outcome=success" in text
    assert "status_code=200" in text


def test_standards_query_logs_http_error_without_url(monkeypatch, caplog):
    _patch_common(monkeypatch)
    response = FakeJsonResponse(status_code=503, raise_status=True)
    monkeypatch.setattr(ai_module.httpx, "AsyncClient", lambda **kwargs: FakePostClient(response=response, **kwargs))

    with caplog.at_level("ERROR", logger="ai"):
        with pytest.raises(HTTPException) as exc:
            _run_async(ai_module.standards_query(_query_request()))

    text = _messages(caplog)
    assert exc.value.detail == "AI 服務錯誤：503"
    assert "outcome=http_error" in text
    assert "status_code=503" in text
    assert "https://generativelanguage" not in text
    assert "key=" not in text


def test_standards_query_timeout_returns_503(monkeypatch, caplog):
    """Gemini 逾時 → 使用者拿到乾淨的 503「逾時」，非 500 崩潰；log 標記 outcome=timeout。"""
    _patch_common(monkeypatch)
    monkeypatch.setattr(
        ai_module.httpx, "AsyncClient",
        lambda **kwargs: FakePostClient(exc=httpx.TimeoutException("timed out"), **kwargs),
    )

    with caplog.at_level("ERROR", logger="ai"):
        with pytest.raises(HTTPException) as exc:
            _run_async(ai_module.standards_query(_query_request()))

    assert exc.value.status_code == 503
    assert exc.value.detail == "AI 服務逾時，請稍後再試"
    assert "outcome=timeout" in _messages(caplog)


def test_standards_query_logs_unavailable_without_exception_detail(monkeypatch, caplog):
    _patch_common(monkeypatch)
    monkeypatch.setattr(
        ai_module,
        "_get_api_key",
        lambda: (_ for _ in ()).throw(
            RuntimeError("https://generativelanguage.googleapis.com/fake?key=SECRET_KEY")
        ),
    )

    with caplog.at_level("ERROR", logger="ai"):
        with pytest.raises(HTTPException) as exc:
            _run_async(ai_module.standards_query(_query_request()))

    text = _messages(caplog)
    assert exc.value.detail == "AI 服務不可用，請稍後再試"
    assert "outcome=unavailable" in text
    assert "https://generativelanguage" not in text
    assert "key=" not in text


def test_stream_logs_success_and_meta(monkeypatch, caplog):
    _patch_common(monkeypatch)
    stream_response = FakeStreamResponse(
        lines=[_sse_text("建議測試 [APPLY:SOP-A]"), "data: [DONE]"],
    )
    monkeypatch.setattr(ai_module.httpx, "AsyncClient", lambda **kwargs: FakeStreamClient(stream_response, **kwargs))

    with caplog.at_level("INFO", logger="ai"):
        body = _run_async(_call_and_collect_stream(_query_request()))

    assert "建議測試" in body
    assert "[META:" in body
    assert "outcome=success" in _messages(caplog)


def test_stream_logs_stream_error_without_exception_detail_or_meta(monkeypatch, caplog):
    _patch_common(monkeypatch)

    def _client_factory(**kwargs):
        return FakeStreamClient(
            exc=RuntimeError("https://generativelanguage.googleapis.com/fake?key=SECRET_KEY"),
            **kwargs,
        )

    monkeypatch.setattr(ai_module.httpx, "AsyncClient", _client_factory)

    with caplog.at_level("ERROR", logger="ai"):
        body = _run_async(_call_and_collect_stream(_query_request()))

    text = _messages(caplog)
    assert "AI 服務不可用，請稍後再試" in body
    assert "[META:" not in body
    assert "outcome=stream_error" in text
    assert "https://generativelanguage" not in text
    assert "key=" not in text
