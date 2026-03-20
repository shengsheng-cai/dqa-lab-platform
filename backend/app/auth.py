import os
import time
import json
from collections import defaultdict
from fastapi import Request
from fastapi.responses import JSONResponse

DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "")

_fail_tracker: dict = defaultdict(lambda: {"count": 0, "blocked_until": 0.0})

SKIP_PATHS = {"/api/line/webhook", "/docs", "/openapi.json", "/api/latest"}
MAX_ATTEMPTS = 5
BLOCK_SECONDS = 600


async def auth_middleware(request: Request, call_next):
    if request.url.path in SKIP_PATHS:
        return await call_next(request)

    if request.method == "OPTIONS":
        return await call_next(request)

    if not DEMO_PASSWORD:
        return await call_next(request)

    ip = request.client.host
    tracker = _fail_tracker[ip]
    now = time.time()

    if tracker["blocked_until"] > now:
        remaining = int(tracker["blocked_until"] - now)
        return JSONResponse(
            status_code=429, content={"detail": f"太多次錯誤，請 {remaining} 秒後再試"}
        )

    provided = request.headers.get("X-Demo-Password", "")
    if provided != DEMO_PASSWORD:
        tracker["count"] += 1
        if tracker["count"] >= MAX_ATTEMPTS:
            tracker["blocked_until"] = now + BLOCK_SECONDS
            tracker["count"] = 0
            return JSONResponse(
                status_code=429, content={"detail": "錯誤次數過多，封鎖 10 分鐘"}
            )
        return JSONResponse(status_code=401, content={"detail": "密碼錯誤"})

    tracker["count"] = 0
    return await call_next(request)
