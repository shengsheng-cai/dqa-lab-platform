import os
import hmac
import hashlib
import base64
import httpx
import logging
from datetime import datetime
from typing import Dict, Any, List
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse


# --- 設定 ---
logger = logging.getLogger("line_bot")
router = APIRouter(prefix="/api/line", tags=["line"])

LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
LINE_USER_ID = os.getenv("LINE_USER_ID", "")

# LINE API 端點
REPLY_URL = "https://api.line.me/v2/bot/message/reply"
PUSH_URL = "https://api.line.me/v2/bot/message/push"

# 狀態顏色與 Emoji 配置
STATUS_CONFIG = {
    "RUNNING": {"emoji": "🟢", "color": "#28a745"},
    "PAUSED": {"emoji": "🟡", "color": "#ffc107"},
    "EMERGENCY": {"emoji": "🔴", "color": "#dc3545"},
    "FINISHING": {"emoji": "🔵", "color": "#007bff"},
    "IDLE": {"emoji": "⚪", "color": "#6c757d"},
    "OFFLINE": {"emoji": "⚫", "color": "#343a40"},
}


async def push_message(text: str):
    """主動推播訊息給管理者個人（供緊急停止使用）"""
    token = LINE_CHANNEL_ACCESS_TOKEN
    target = LINE_USER_ID

    if not token or not target:
        logger.warning("[LINE] 未設定 TOKEN 或推播目標，跳過推播")
        return

    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(
                PUSH_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "to": target,
                    "messages": [{"type": "text", "text": text}],
                },
                timeout=10.0,
            )
            if res.status_code != 200:
                logger.error(f"[LINE] 推播失敗: {res.status_code} {res.text}")
        except Exception as e:
            logger.error(f"[LINE] 推播例外：{e}")


def _verify_signature(body: bytes, signature: str) -> bool:
    """驗證來自 LINE 的 Webhook 請求簽名"""
    secret = LINE_CHANNEL_SECRET
    if not secret:
        return True
    hash_ = hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).digest()
    expected = base64.b64encode(hash_).decode("utf-8")
    return hmac.compare_digest(expected, signature)


async def _send_to_line(
    reply_token: str, messages: List[Dict], client: httpx.AsyncClient
):
    """異步發送訊息封裝"""
    token = LINE_CHANNEL_ACCESS_TOKEN
    try:
        res = await client.post(
            REPLY_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"replyToken": reply_token, "messages": messages},
            timeout=10.0,
        )
        if res.status_code != 200:
            logger.error(f"[LINE] API 錯誤: {res.text}")
    except Exception as e:
        logger.error(f"[LINE] 連線異常: {e}")


def _get_quick_reply_items(cache: Dict[str, Any]) -> List[Dict]:
    """產生快速回覆按鈕"""
    items = [
        {
            "type": "action",
            "action": {"type": "message", "label": "📊 總覽", "text": "狀態"},
        }
    ]
    for device_id in list(cache.keys())[:10]:
        items.append(
            {
                "type": "action",
                "action": {
                    "type": "message",
                    "label": f"🔍 {device_id}",
                    "text": device_id,
                },
            }
        )
    return items


def _create_flex_detail_card(device_id: str, data: Dict[str, Any]) -> Dict:
    """建立單一設備的 Flex Message 卡片"""
    status = data.get("status", "OFFLINE")
    conf = STATUS_CONFIG.get(status, STATUS_CONFIG["OFFLINE"])
    now_str = datetime.now().strftime("%H:%M:%S")

    return {
        "type": "flex",
        "altText": f"設備 {device_id} 狀態",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": f"📟 {device_id}",
                        "weight": "bold",
                        "color": "#ffffff",
                        "size": "lg",
                    }
                ],
                "backgroundColor": conf["color"],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "text",
                                "text": "目前狀態",
                                "color": "#aaaaaa",
                                "size": "sm",
                            },
                            {
                                "type": "text",
                                "text": f"{conf['emoji']} {status}",
                                "align": "end",
                                "size": "sm",
                                "weight": "bold",
                            },
                        ],
                    },
                    {"type": "separator"},
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {"type": "text", "text": "🌡️ 溫度", "size": "md", "flex": 1},
                            {
                                "type": "text",
                                "text": f"{data.get('temperature', 0.0):.1f} °C",
                                "align": "end",
                                "weight": "bold",
                                "size": "md",
                                "flex": 2,
                            },
                        ],
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "text",
                                "text": "💧 濕度",
                                "size": "md",
                                "flex": 1,
                            },
                            {
                                "type": "text",
                                "text": f"{data.get('humidity', 0.0):.1f} %RH",
                                "align": "end",
                                "weight": "bold",
                                "size": "md",
                                "flex": 2,
                            },
                        ],
                    },
                    {"type": "separator"},
                    {
                        "type": "text",
                        "text": f"📋 測試: {data.get('running_sop_name', '無')}",
                        "size": "xs",
                        "color": "#666666",
                        "style": "italic",
                        "wrap": True,
                    },
                ],
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": f"最後更新於 {now_str}",
                        "size": "xxs",
                        "color": "#aaaaaa",
                        "align": "center",
                    }
                ],
            },
        },
    }


def _dispatch_command(text: str, cache: Dict[str, Any]) -> List[Dict]:
    """解析指令並決定回傳格式"""
    cmd = text.strip().lower()
    now_str = datetime.now().strftime("%H:%M:%S")

    if cmd in ("狀態", "status", "s"):
        lines = [f"📊 DQALab 設備概覽 ({now_str})", "━━━━━━━━━━━━━━"]
        if not cache:
            lines.append("❌ 目前無連線設備")
        else:
            for d_id, item in cache.items():
                emoji = STATUS_CONFIG.get(item.get("status"), STATUS_CONFIG["OFFLINE"])[
                    "emoji"
                ]
                lines.append(f"{emoji} {d_id}: {item.get('status')}")
        return [
            {
                "type": "text",
                "text": "\n".join(lines),
                "quickReply": {"items": _get_quick_reply_items(cache)},
            }
        ]

    for device_id, item in cache.items():
        if cmd in (device_id.lower(),):
            card = _create_flex_detail_card(device_id, item)
            card["quickReply"] = {"items": _get_quick_reply_items(cache)}
            return [card]

    if cmd in ("help", "?", "幫助", "h"):
        return [
            {
                "type": "text",
                "text": (
                    "📋 指令說明：\n"
                    "• 狀態 — 所有設備概覽\n"
                    "• CH01 — 單台設備詳情\n"
                    "• CH02 — 單台設備詳情\n"
                    "• CH03 — 單台設備詳情\n"
                    "• CH04 — 單台設備詳情\n"
                    "• CH05 — 單台設備詳情\n"
                    "• 幫助 — 顯示此說明"
                ),
                "quickReply": {"items": _get_quick_reply_items(cache)},
            }
        ]

    return [
        {
            "type": "text",
            "text": "❓ 未知指令，點擊下方「總覽」開始查詢。",
            "quickReply": {"items": _get_quick_reply_items(cache)},
        }
    ]


# ── Webhook ─────────────────────────────────────────────────────


@router.post("/webhook")
async def webhook(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    signature = request.headers.get("X-Line-Signature", "")

    if not _verify_signature(body, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    data = await request.json()
    cache = getattr(request.app.state, "AICM_CACHE", {})
    client = request.app.state.http_client

    for event in data.get("events", []):
        event_type = event.get("type")
        reply_token = event.get("replyToken")

        # 加好友 / Bot 加入群組
        if event_type in ("follow", "join"):
            background_tasks.add_task(
                _send_to_line,
                reply_token,
                [
                    {
                        "type": "text",
                        "text": (
                            "👋 DQA Lab Bot 已就緒！\n\n"
                            "傳「狀態」查設備概覽，「幫助」查所有指令。"
                        ),
                        "quickReply": {"items": _get_quick_reply_items(cache)},
                    }
                ],
                client,
            )
            continue

        # 只處理文字訊息
        if event_type != "message" or event.get("message", {}).get("type") != "text":
            continue

        user_text = event["message"]["text"].strip()
        messages = _dispatch_command(user_text, cache)
        background_tasks.add_task(_send_to_line, reply_token, messages, client)

    return JSONResponse(content={"status": "ok"})
