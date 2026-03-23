import os
import time
import json
from collections import defaultdict
from fastapi import Request
from fastapi.responses import JSONResponse

DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "")

_fail_tracker: dict = {}
_FAIL_TRACKER_MAXSIZE = 1000

SKIP_PATHS = {"/api/line/webhook", "/docs", "/openapi.json", "/api/latest"}
MAX_ATTEMPTS = 5
BLOCK_SECONDS = 600


def _get_tracker(ip: str) -> dict:
    """取得 IP 的追蹤記錄，超過上限時清理過期封鎖的 IP。"""
    if ip not in _fail_tracker:
        if len(_fail_tracker) >= _FAIL_TRACKER_MAXSIZE:
            now = time.time()
            # 清除已解封且無失敗記錄的 IP
            expired = [
                k
                for k, v in _fail_tracker.items()
                if v["blocked_until"] < now and v["count"] == 0
            ]
            for k in expired:
                del _fail_tracker[k]
            # 若還是超過，清掉最舊的一半
            if len(_fail_tracker) >= _FAIL_TRACKER_MAXSIZE:
                keys_to_remove = list(_fail_tracker.keys())[
                    : _FAIL_TRACKER_MAXSIZE // 2
                ]
                for k in keys_to_remove:
                    del _fail_tracker[k]
        _fail_tracker[ip] = {"count": 0, "blocked_until": 0.0}
    return _fail_tracker[ip]


async def auth_middleware(request: Request, call_next):
    if any(request.url.path.startswith(p) for p in SKIP_PATHS):
        return await call_next(request)

    if request.method == "OPTIONS":
        return await call_next(request)

    if not DEMO_PASSWORD:
        return await call_next(request)

    ip = request.client.host
    tracker = _get_tracker(ip)
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
