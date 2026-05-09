import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .auth import get_token_info, _validate_demo_token, DEMO_PASSWORD
from .devices import build_device_list

logger = logging.getLogger("app")
router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self._connections: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.add(ws)
        logger.info(f"[WS] connected, total={len(self._connections)}")

    def disconnect(self, ws: WebSocket):
        self._connections.discard(ws)
        logger.info(f"[WS] disconnected, total={len(self._connections)}")

    async def broadcast(self, data: list):
        dead: set[WebSocket] = set()
        for ws in list(self._connections):
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.debug(f"[WS] send failed: {e}")
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def count(self) -> int:
        return len(self._connections)


manager = ConnectionManager()


async def broadcast_loop(cache: dict):
    """每 1 秒廣播一次設備狀態給所有連線中的 WS clients。"""
    while True:
        await asyncio.sleep(1)
        if manager.count == 0:
            continue
        try:
            data = build_device_list(cache)
            await manager.broadcast(data)
        except Exception as e:
            logger.error(f"[WS] broadcast_loop error: {e}")


def _authenticate(token: str) -> bool:
    if not token:
        return not DEMO_PASSWORD

    if get_token_info(token):
        return True
    if _validate_demo_token(token):
        return True
    if DEMO_PASSWORD and token == DEMO_PASSWORD:
        return True
    return False


@router.websocket("/ws/devices")
async def ws_devices(ws: WebSocket):
    token = ws.query_params.get("token", "")
    if not _authenticate(token):
        await ws.close(code=4001)
        return

    await manager.connect(ws)
    try:
        # 連線後立即推一幀，讓前端不用等 1 秒
        data = build_device_list(ws.app.state.AICM_CACHE)
        await ws.send_json(data)
        # 持續接收（維持連線活著，客戶端可發 ping）
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)
