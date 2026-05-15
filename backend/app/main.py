from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

import os
import asyncio
import datetime
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from .sop import router as sop_router, execution_router, DEVICE_IDS
from .reports import router as reports_router
from .errors import router as errors_router
from .ai import router as ai_router
from .rag import warmup_rag
from .line import router as line_router
from .auth import router as auth_router
from .fixtures import router as fixtures_router
from .purchase_orders import router as purchase_orders_router
from .schedules import (
    router as schedules_router, blocked_router as device_blocked_router,
)
from .schedule_service import auto_advance_schedules
from .models import SessionLocal, DeviceState
from .simulator import data_simulator
from .devices import router as devices_router
from .audit import router as audit_router
from .devices_maintenance import router as devices_maintenance_router
from .ws import router as ws_router, broadcast_loop
from .constants import AMBIENT_TEMP, AMBIENT_HUMIDITY
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
            dwell_high_start = s.dwell_high_start.isoformat() if s.dwell_high_start else None
            dwell_low_start = s.dwell_low_start.isoformat() if s.dwell_low_start else None
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
                "active_execution_id": s.active_execution_id,
                "sim_phase": s.sim_phase or "idle",
                "sim_cycle": s.sim_cycle or 0,
                "dwell_high_start": dwell_high_start,
                "dwell_low_start": dwell_low_start,
            }
            logger.info(f"[{device_id}] 恢復狀態：{s.status}，溫度：{s.temperature}°C")
        else:
            cache[device_id] = {
                "temperature": round(AMBIENT_TEMP + random.uniform(-1.0, 1.0), 2),
                "humidity": round(AMBIENT_HUMIDITY + random.uniform(-2.0, 2.0), 1),
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

    ws_task = asyncio.create_task(broadcast_loop(cache))
    background_tasks.add(ws_task)
    ws_task.add_done_callback(background_tasks.discard)
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
    app.state.scheduler = scheduler

    # 重啟後重新註冊未來的 CONFIRMED 排程 date job
    from .schedule_service import _start_schedule_by_id
    from .models import Schedule, ScheduleStatus
    from .utils import _now_utc_naive
    _now_naive = _now_utc_naive()
    with SessionLocal() as db:
        future_confirmed = db.query(Schedule).filter(
            Schedule.status == ScheduleStatus.CONFIRMED,
            Schedule.start_time > _now_naive,
        ).all()
        for s in future_confirmed:
            start_aware = s.start_time.replace(tzinfo=datetime.timezone.utc)
            scheduler.add_job(
                _start_schedule_by_id,
                trigger="date",
                run_date=start_aware,
                kwargs={"schedule_id": s.id, "cache": app.state.AICM_CACHE, "locks": app.state.DEVICE_LOCKS},
                id=f"sched_{s.id}",
                replace_existing=True,
            )
        if future_confirmed:
            logger.info(f"重新註冊 {len(future_confirmed)} 筆未來排程 date job")

    logger.info("APScheduler 已啟動（精確 date job + 每 5 分鐘 fallback）")

    yield
    scheduler.shutdown()
    await app.state.http_client.aclose()


_is_prod = os.getenv("ENVIRONMENT") == "production"
app = FastAPI(
    title="DQA Lab Platform",
    lifespan=lifespan,
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
)

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
app.include_router(audit_router)
app.include_router(devices_maintenance_router)
app.include_router(ws_router)


_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

from .auth import auth_middleware  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

# 注意：FastAPI middleware 後加先執行（LIFO）
# auth_middleware 先加 → 後執行；CORSMiddleware 後加 → 先執行
# 確保 auth 回傳 401 時，CORS headers 已經由 CORSMiddleware 附加
app.add_middleware(BaseHTTPMiddleware, dispatch=auth_middleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    return PlainTextResponse("User-agent: *\nDisallow: /\n")


# ── 前端靜態檔案（容器化部署時同 origin serve）────────────────────
# 開發時前端走 Vite dev server（5173），靜態資料夾不存在就 skip；
# 部署時 Dockerfile 把 client/dist 複製到 /app/static，這段會生效。
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_static_dir = Path(__file__).parent.parent.parent / "static"
if _static_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="assets")

    _static_dir_resolved = _static_dir.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        target = (_static_dir / full_path).resolve()
        if not target.is_relative_to(_static_dir_resolved):
            raise HTTPException(status_code=404)
        if target.is_file():
            return FileResponse(target)
        return FileResponse(_static_dir / "index.html")
