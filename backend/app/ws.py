import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .auth import consume_ws_ticket
from .devices import build_device_list

logger = logging.getLogger("app")
router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self._connections: set[WebSocket] = set()

    async def connect(self, ws: WebSocket, subprotocol: str):
        await ws.accept(subprotocol=subprotocol)
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
            data = await asyncio.to_thread(build_device_list, dict(cache))
            await manager.broadcast(data)
        except Exception as e:
            logger.error(f"[WS] broadcast_loop error: {e}")


_TICKET_PROTOCOL_PREFIX = "dqa-ws-ticket."


def _consume_ticket_protocol(ws: WebSocket) -> str | None:
    # ASGI 伺服器（uvicorn 與測試用的 TestClient）已經把瀏覽器送來的
    # Sec-WebSocket-Protocol 拆好放進 scope，這裡不用自己再切一次字串。
    for protocol in ws.scope.get("subprotocols", []):
        if protocol.startswith(_TICKET_PROTOCOL_PREFIX) and consume_ws_ticket(
            protocol.removeprefix(_TICKET_PROTOCOL_PREFIX)
        ):
            return protocol
    return None


@router.websocket("/ws/devices")
async def ws_devices(ws: WebSocket):
    protocol = _consume_ticket_protocol(ws)
    if not protocol:
        await ws.close(code=4001)
        return

    await manager.connect(ws, subprotocol=protocol)
    try:
        # 連線後立即推一幀，讓前端不用等 1 秒
        data = build_device_list(dict(ws.app.state.AICM_CACHE))
        await ws.send_json(data)
        # 持續接收（維持連線活著，客戶端可發 ping）
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        logger.exception("[WS] ws_devices unexpected error")
        manager.disconnect(ws)
