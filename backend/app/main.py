from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

import os
import asyncio
import time
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from .sop import router as sop_router, execution_router
from .constants import DEVICE_IDS
from . import device_state
from .reports import router as reports_router
from .errors import router as errors_router
from .ai import router as ai_router
from .rag import warmup_rag
from .line import router as line_router
from .auth import router as auth_router, require_admin
from .fixtures import router as fixtures_router
from .purchase_orders import router as purchase_orders_router
from .schedules import (
    router as schedules_router, blocked_router as device_blocked_router,
)
from .schedule_service import auto_advance_schedules
from .models import SessionLocal, SQLALCHEMY_DATABASE_URL
from .simulator import data_simulator
from .devices import router as devices_router
from .audit import router as audit_router
from .devices_maintenance import router as devices_maintenance_router
from .ws import router as ws_router, broadcast_loop
import httpx as _httpx
import logging

logger = logging.getLogger("app")
background_tasks = set()
SLOW_REQUEST_MS = 2000


async def observability_middleware(request: Request, call_next):
    path = request.url.path
    if not (path.startswith("/api/") or path == "/health"):
        return await call_next(request)

    start = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        duration_ms = (time.perf_counter() - start) * 1000
        msg = "api_request method=%s path=%s status=%s duration_ms=%.1f"
        args = (request.method, path, status_code, duration_ms)
        if status_code >= 500:
            logger.error(msg, *args)
        elif duration_ms > SLOW_REQUEST_MS:
            logger.warning(msg, *args)
        else:
            logger.info(msg, *args)


def _has_env(name: str) -> bool:
    return bool(os.getenv(name, "").strip())


def _is_ephemeral_sqlite(url: str) -> bool:
    lower = url.lower()
    return lower.startswith("sqlite") and (":memory:" in lower or "/tmp/" in lower)


def _build_runtime_info() -> dict:
    is_hf_space = bool(os.getenv("SPACE_ID") or os.getenv("HF_SPACE_ID"))
    capabilities = {
        "ai_enabled": _has_env("GEMINI_API_KEY"),
        "line_push_enabled": _has_env("LINE_CHANNEL_ACCESS_TOKEN") and _has_env("LINE_USER_ID"),
        "admin_password_configured": _has_env("ADMIN_PASSWORD"),
        "persistent_db": not _is_ephemeral_sqlite(SQLALCHEMY_DATABASE_URL),
    }

    warnings = []
    checks = [
        (
            "admin_password_missing",
            not capabilities["admin_password_configured"],
            "ADMIN_PASSWORD 未設定，管理者密碼不會在啟動時自動同步。",
        ),
        ("ai_disabled", not capabilities["ai_enabled"], "AI 諮詢未啟用（缺 GEMINI_API_KEY）。"),
        (
            "line_push_disabled",
            not capabilities["line_push_enabled"],
            "LINE 推播未啟用（缺 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_USER_ID）。",
        ),
        (
            "sqlite_ephemeral",
            not capabilities["persistent_db"],
            "目前資料庫為暫存（SQLite /tmp 或 in-memory），服務重啟後會清空。",
        ),
    ]
    for code, enabled, message in checks:
        if enabled:
            warnings.append({"code": code, "message": message})

    return {
        "environment": os.getenv("ENVIRONMENT", "development"),
        "platform": {"hf_space": is_hf_space},
        "capabilities": capabilities,
        "warnings": warnings,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .models import init_db

    runtime_info = _build_runtime_info()
    app.state.runtime_info = runtime_info
    for item in runtime_info["warnings"]:
        logger.warning("[startup-check] %s", item["message"])

    init_db()

    states = device_state.DeviceStateManager.restore(DEVICE_IDS)
    app.state.DEVICE_STATE = states
    # 舊的讀取端仍以 AICM_CACHE 命名；值是只回 snapshot 的 Mapping，不再是可寫 live dict。
    app.state.AICM_CACHE = states
    for device_id, item in states.items():
        logger.info(
            f"[{device_id}] 恢復狀態：{item.get('status')}，"
            f"溫度：{item.get('temperature')}°C"
        )

    sim_task = asyncio.create_task(data_simulator(states))
    background_tasks.add(sim_task)
    sim_task.add_done_callback(background_tasks.discard)

    ws_task = asyncio.create_task(broadcast_loop(states))
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
        kwargs={"states": states},
    )
    scheduler.start()
    app.state.scheduler = scheduler

    # 重啟後重新註冊未來的 CONFIRMED 排程 date job
    from .schedule_service import _register_schedule_start_job
    from .models import Schedule, ScheduleStatus
    from .utils import _now_utc_naive
    _now_naive = _now_utc_naive()
    with SessionLocal() as db:
        future_confirmed = db.query(Schedule).filter(
            Schedule.status == ScheduleStatus.CONFIRMED,
            Schedule.start_time > _now_naive,
        ).all()
        for s in future_confirmed:
            _register_schedule_start_job(
                scheduler,
                s.id,
                states,
                s.start_time,
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


_openapi_tags = [
    {"name": "auth", "description": "登入、Token 管理"},
    {"name": "devices", "description": "設備狀態查詢、緊急停止、感測器歷史"},
    {"name": "maintenance", "description": "設備校驗 & 維護紀錄"},
    {"name": "schedules", "description": "測試排程 CRUD、不可用時段管理"},
    {"name": "sop", "description": "法規條件選擇、SOP 啟動、步驟確認、照片上傳、執行紀錄"},
    {"name": "reports", "description": "PDF / CSV 報告下載"},
    {"name": "fixtures", "description": "治具借還、盤點、採購、Excel 匯入"},
    {"name": "purchase-orders", "description": "治具採購單"},
    {"name": "ai", "description": "AI 法規諮詢（Gemini + RAG）"},
    {"name": "audit", "description": "稽核日誌"},
    {"name": "errors", "description": "設備異常紀錄"},
    {"name": "line", "description": "LINE Bot Webhook"},
    {"name": "ws", "description": "WebSocket 即時推播"},
]


def _custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes, tags=_openapi_tags)
    schema.setdefault("components", {})["securitySchemes"] = {
        "AdminToken": {
            "type": "apiKey",
            "in": "header",
            "name": "X-User-Token",
            "description": "管理員 token（POST /api/auth/login 取得）",
        },
        "GuestPassword": {
            "type": "apiKey",
            "in": "header",
            "name": "X-Demo-Password",
            "description": "訪客密碼（DEMO_PASSWORD 環境變數）",
        },
    }
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            if isinstance(operation, dict):
                operation.setdefault("security", [{"AdminToken": []}, {"GuestPassword": []}])
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = _custom_openapi
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
app.include_router(ws_router, tags=["ws"])


_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

from .auth import auth_middleware  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

# 注意：FastAPI middleware 後加先執行（LIFO）
# 實際順序：CORSMiddleware → observability_middleware → auth_middleware → routes
# 確保 auth 回傳 401 時，CORS headers 已經由 CORSMiddleware 附加
app.add_middleware(BaseHTTPMiddleware, dispatch=auth_middleware)
app.add_middleware(BaseHTTPMiddleware, dispatch=observability_middleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


@app.get("/api/runtime-info", include_in_schema=False)
def runtime_info(request: Request, _: None = Depends(require_admin)):
    info = getattr(app.state, "runtime_info", None) or _build_runtime_info()
    return info


@app.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    return PlainTextResponse("User-agent: *\nDisallow: /\n")


# ── 前端靜態檔案（容器化部署時同 origin serve）────────────────────
# 開發時前端走 Vite dev server（5173），靜態資料夾不存在就 skip；
# 部署時 Dockerfile 把 client/dist 複製到 /app/static，這段會生效。
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_static_dir = Path(v) if (v := os.environ.get("STATIC_DIR")) else Path(__file__).parent.parent.parent / "static"
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
