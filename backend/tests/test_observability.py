from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from app.main import observability_middleware


def _make_observed_app():
    test_app = FastAPI()

    @test_app.get("/api/ok")
    def ok():
        return {"ok": True}

    @test_app.get("/api/error")
    def error():
        raise RuntimeError("boom")

    @test_app.get("/health")
    def health():
        return {"status": "ok"}

    @test_app.get("/plain")
    def plain():
        return {"ok": True}

    test_app.add_middleware(BaseHTTPMiddleware, dispatch=observability_middleware)
    return test_app


def _messages(caplog):
    return "\n".join(record.getMessage() for record in caplog.records)


def test_api_and_health_paths_emit_log(caplog):
    app = _make_observed_app()

    with TestClient(app) as client:
        with caplog.at_level("INFO", logger="app"):
            client.get("/api/ok")
            client.get("/health")

    text = _messages(caplog)
    assert "api_request method=GET path=/api/ok status=200" in text
    assert "api_request method=GET path=/health status=200" in text


def test_non_target_paths_do_not_emit_log(caplog):
    app = _make_observed_app()

    with TestClient(app) as client:
        with caplog.at_level("INFO", logger="app"):
            client.get("/plain")
            client.get("/docs")

    assert "api_request" not in _messages(caplog)


def test_exception_response_uses_error_level(caplog):
    app = _make_observed_app()

    with TestClient(app, raise_server_exceptions=False) as client:
        with caplog.at_level("ERROR", logger="app"):
            response = client.get("/api/error")

    assert response.status_code == 500
    record = next(r for r in caplog.records if "api_request" in r.getMessage())
    assert record.levelname == "ERROR"
    assert "path=/api/error status=500" in record.getMessage()


def test_log_does_not_include_query_or_sensitive_headers(caplog):
    app = _make_observed_app()

    with TestClient(app) as client:
        with caplog.at_level("INFO", logger="app"):
            client.get(
                "/api/ok?token=SECRET&key=LEAK",
                headers={"X-User-Token": "HEADER_SECRET"},
            )

    text = _messages(caplog)
    assert "path=/api/ok" in text
    assert "SECRET" not in text
    assert "HEADER_SECRET" not in text
    assert "key=" not in text
    assert "token=" not in text
