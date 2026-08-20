import asyncio
import logging
from types import SimpleNamespace

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.schedulers.base import STATE_PAUSED, STATE_RUNNING, STATE_STOPPED
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.main as main_module
from app.main import (
    _cancel_background_tasks,
    _health_checks,
    _start_background_task,
    health,
)


class _TaskState:
    def __init__(self, *, done: bool):
        self._done = done

    def done(self) -> bool:
        return self._done


def _health_client(*, simulator_done: bool, scheduler_state: int) -> TestClient:
    app = FastAPI()
    app.state.background_tasks = {"simulator": _TaskState(done=simulator_done)}
    app.state.scheduler = SimpleNamespace(state=scheduler_state)
    app.add_api_route("/health", health)
    return TestClient(app)


def test_health_is_ok_when_core_background_services_are_running():
    with _health_client(simulator_done=False, scheduler_state=STATE_RUNNING) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_reports_simulator_failure():
    with _health_client(simulator_done=True, scheduler_state=STATE_RUNNING) as client:
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "unhealthy",
        "checks": {"simulator": "stopped", "scheduler": "running"},
    }


def test_health_reports_scheduler_not_running():
    for scheduler_state in (STATE_PAUSED, STATE_STOPPED):
        with _health_client(simulator_done=False, scheduler_state=scheduler_state) as client:
            response = client.get("/health")

        assert response.status_code == 503
        assert response.json()["checks"] == {
            "simulator": "running",
            "scheduler": "stopped",
        }


def test_background_task_exception_is_retrieved_and_logged(caplog):
    async def exercise():
        app = FastAPI()
        app.state.background_tasks = {}

        async def fail() -> None:
            raise RuntimeError("simulator exploded")

        task = _start_background_task(app, "simulator", fail())
        await asyncio.sleep(0)
        await asyncio.sleep(0)  # 讓 done callback 讀取並記錄 exception
        return app, task

    with caplog.at_level(logging.ERROR, logger="app"):
        app, task = asyncio.run(exercise())

    assert task.done()
    assert isinstance(task.exception(), RuntimeError)
    assert "Background task simulator failed: simulator exploded" in caplog.text
    # 死掉的工作要離開名冊，health 才會把它算成 stopped
    assert app.state.background_tasks == {}
    assert _health_checks(app)["simulator"] == "stopped"


def test_shutdown_cancels_and_awaits_background_tasks():
    cancelled = False

    async def exercise() -> asyncio.Task:
        nonlocal cancelled
        app = FastAPI()
        app.state.background_tasks = {}

        async def wait_forever() -> None:
            nonlocal cancelled
            try:
                await asyncio.Event().wait()
            finally:
                cancelled = True

        task = _start_background_task(app, "simulator", wait_forever())
        await asyncio.sleep(0)
        await _cancel_background_tasks(app)
        return task

    task = asyncio.run(exercise())

    assert cancelled is True
    assert task.cancelled()


def test_lifespan_starts_healthy_and_cleans_up_core_services(monkeypatch, patched_session):
    cancelled = set()

    async def wait_until_cancelled(name: str) -> None:
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.add(name)

    async def simulator(_states) -> None:
        await wait_until_cancelled("simulator")

    async def websocket(_states) -> None:
        await wait_until_cancelled("websocket")

    async def warmup() -> None:
        return None

    class FakeHttpClient:
        def __init__(self):
            self.closed = False

        async def aclose(self):
            self.closed = True

    fake_http_client = FakeHttpClient()
    monkeypatch.setattr("app.models.init_db", lambda: None)
    monkeypatch.setattr(
        main_module.device_state.DeviceStateManager,
        "restore",
        lambda _device_ids: {},
    )
    monkeypatch.setattr(main_module, "data_simulator", simulator)
    monkeypatch.setattr(main_module, "broadcast_loop", websocket)
    monkeypatch.setattr(main_module, "warmup_rag", warmup)
    monkeypatch.setattr(
        main_module._httpx,
        "AsyncClient",
        lambda *, timeout: fake_http_client,
    )

    async def exercise():
        app = FastAPI()
        async with main_module.lifespan(app):
            await asyncio.sleep(0)
            assert main_module._health_checks(app) == {
                "simulator": "running",
                "scheduler": "running",
            }
            scheduler = app.state.scheduler
            tasks = dict(app.state.background_tasks)

        return scheduler, tasks

    # lifespan 會真的查一次未來的 CONFIRMED 排程，走 in-memory SQLite 而不是假 session
    with patched_session("app.main"):
        scheduler, tasks = asyncio.run(exercise())

    assert isinstance(scheduler, AsyncIOScheduler)
    assert fake_http_client.closed is True
    assert cancelled == {"simulator", "websocket"}
    assert tasks["simulator"].cancelled()
    assert tasks["websocket"].cancelled()
