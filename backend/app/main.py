from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

import asyncio
import datetime
import os
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .sop import router as sop_router, execution_router, DEVICE_IDS
from .reports import router as reports_router
from .errors import router as errors_router
from .ai import router as ai_router
from .rag import warmup_rag
from .line import router as line_router
from .auth import router as auth_router
from .fixtures import router as fixtures_router
from .purchase_orders import router as purchase_orders_router
from .schedules import router as schedules_router, blocked_router as device_blocked_router, auto_advance_schedules
from .models import SessionLocal, DeviceState
from .simulator import data_simulator
from .devices import router as devices_router
import httpx as _httpx
import logging

logger = logging.getLogger("app")
background_tasks = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .models import init_db

    init_db()

    with SessionLocal() as db:
        saved_states = {s.device_id: s for s in db.query(DeviceState).all()}

    cache = {}
    for device_id in DEVICE_IDS:
        s = saved_states.get(device_id)
        if s:
            started_at = s.started_at
            if started_at is not None and started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=datetime.timezone.utc)
            cache[device_id] = {
                "temperature": s.temperature,
                "humidity": s.humidity,
                "status": s.status,
                "running_sop_name": s.running_sop_name or "STANDBY",
                "running_sop_id": s.running_sop_id,
                "standard_id": s.standard_id,
                "active_sop_json": s.active_sop_json,
                "completed_steps": s.completed_steps or 0,
                "started_at": started_at,
                "operator": "",
                "operator_user_id": None,
                "sim_phase": s.sim_phase or "idle",
                "sim_cycle": s.sim_cycle or 0,
                "dwell_high_start": s.dwell_high_start.isoformat() if s.dwell_high_start else None,
                "dwell_low_start": s.dwell_low_start.isoformat() if s.dwell_low_start else None,
            }
            logger.info(f"[{device_id}] 恢復狀態：{s.status}，溫度：{s.temperature}°C")
        else:
            cache[device_id] = {
                "temperature": round(25.0 + random.uniform(-1.0, 1.0), 2),
                "humidity": round(55.0 + random.uniform(-2.0, 2.0), 1),
                "status": "IDLE",
                "running_sop_name": "STANDBY",
                "running_sop_id": None,
                "standard_id": None,
                "active_sop_json": None,
                "completed_steps": 0,
                "started_at": None,
                "operator": "",
                "operator_user_id": None,
                "sim_phase": "idle",
                "sim_cycle": 0,
            }

    app.state.AICM_CACHE = cache
    app.state.DEVICE_LOCKS = {device_id: asyncio.Lock() for device_id in DEVICE_IDS}

    sim_task = asyncio.create_task(data_simulator(cache, app.state.DEVICE_LOCKS))
    background_tasks.add(sim_task)
    sim_task.add_done_callback(background_tasks.discard)
    logger.info(f"System initialized with {len(DEVICE_IDS)} devices: {DEVICE_IDS}")

    task = asyncio.create_task(warmup_rag())
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
    app.state.http_client = _httpx.AsyncClient(timeout=10.0)

    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    scheduler = AsyncIOScheduler(timezone="Asia/Taipei")
    scheduler.add_job(
        auto_advance_schedules, "interval", minutes=5,
        kwargs={"cache": app.state.AICM_CACHE, "locks": app.state.DEVICE_LOCKS},
    )
    scheduler.start()
    logger.info("APScheduler 已啟動（每 5 分鐘推進排程狀態）")

    yield
    scheduler.shutdown()
    await app.state.http_client.aclose()


app = FastAPI(title="DQA Lab Digital Twin", lifespan=lifespan, redirect_slashes=False)

app.include_router(sop_router, prefix="/api/sop", tags=["sop"])
app.include_router(execution_router)
app.include_router(reports_router)
app.include_router(errors_router)
app.include_router(ai_router)
app.include_router(line_router)
app.include_router(auth_router)
app.include_router(fixtures_router)
app.include_router(purchase_orders_router)
app.include_router(schedules_router)
app.include_router(device_blocked_router)
app.include_router(devices_router)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .auth import auth_middleware
from starlette.middleware.base import BaseHTTPMiddleware

app.add_middleware(BaseHTTPMiddleware, dispatch=auth_middleware)


@app.get("/health")
async def health():
    return {"status": "ok"}
