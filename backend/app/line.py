import os
import hmac
import hashlib
import base64
import httpx
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from .models import SessionLocal, User

# --- 設定 ---
logger = logging.getLogger("line_bot")
router = APIRouter(prefix="/api/line", tags=["line"])

LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")

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
    """主動推播訊息給 env 設定的預設 User ID（供 main.py 緊急通知使用）"""
    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
    user_id = os.getenv("LINE_USER_ID", "")

    if not token or not user_id:
        logger.warning("[LINE] 未設定 TOKEN 或 USER_ID，跳過推播")
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
                    "to": user_id,
                    "messages": [{"type": "text", "text": text}],
                },
                timeout=10.0,
            )
            if res.status_code != 200:
                logger.error(f"[LINE] 推播失敗: {res.status_code} {res.text}")
        except Exception as e:
            logger.error(f"[LINE] 推播例外：{e}")


async def push_to_user(line_user_id: str, text: str):
    """推播訊息給指定 LINE User ID（供治具通知使用）"""
    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")

    if not token:
        logger.warning("[LINE] 未設定 CHANNEL_ACCESS_TOKEN，跳過推播")
        return
    if not line_user_id:
        logger.warning("[LINE] push_to_user: line_user_id 為空，跳過")
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
                    "to": line_user_id,
                    "messages": [{"type": "text", "text": text}],
                },
                timeout=10.0,
            )
            if res.status_code != 200:
                logger.error(
                    f"[LINE] push_to_user 失敗 ({line_user_id}): "
                    f"{res.status_code} {res.text}"
                )
        except Exception as e:
            logger.error(f"[LINE] push_to_user 例外：{e}")


def _verify_signature(body: bytes, signature: str) -> bool:
    """驗證來自 LINE 的 Webhook 請求簽名"""
    secret = os.getenv("LINE_CHANNEL_SECRET", "")
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
    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
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
    items = []
    items.append(
        {
            "type": "action",
            "action": {"type": "message", "label": "📊 總覽", "text": "狀態"},
        }
    )
    for device_id in list(cache.keys())[:10]:
        short_id = device_id
        items.append(
            {
                "type": "action",
                "action": {
                    "type": "message",
                    "label": f"🔍 {short_id}",
                    "text": short_id,
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


async def push_sop_notification(operator_name: str, text: str):
    """推播 SOP 通知給操作人員，找不到個人 LINE ID 時 fallback 推給環境變數設定的預設帳號。"""
    if operator_name:
        try:
            with SessionLocal() as db:
                user = (
                    db.query(User)
                    .filter(User.display_name == operator_name, User.is_active == True)
                    .first()
                )
                if user and user.line_user_id:
                    await push_to_user(user.line_user_id, text)
                    return
        except Exception as e:
            logger.warning(f"[LINE] push_sop_notification 查詢失敗，fallback 廣播：{e}")
    await push_message(text)


def _handle_bind_command(sender_id: str, name: str) -> str:
    """處理「綁定 姓名」指令，將 LINE User ID 寫入工程師帳號"""
    name = name.strip()
    if not name:
        return "❌ 請輸入姓名，例如：綁定 張三"

    with SessionLocal() as db:
        user = db.query(User).filter(User.display_name == name).first()
        if not user:
            return f"❌ 找不到「{name}」，請確認姓名是否正確（須與系統中的顯示名稱完全相符）"
        if user.line_user_id == sender_id:
            return "✅ 已完成綁定，無需重複操作"
        user.line_user_id = sender_id
        db.commit()
        return f"✅ 綁定成功！{name} 已連結此 LINE 帳號，往後測試通知將推送至此。"


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
        short_id = device_id.lower()
        if cmd in (device_id.lower(), short_id):
            card = _create_flex_detail_card(device_id, item)
            card["quickReply"] = {"items": _get_quick_reply_items(cache)}
            return [card]

    if cmd in ("help", "?", "幫助", "h"):
        return [
            {
                "type": "text",
                "text": "📋 指令說明：\n1. 輸入「狀態」查總覽\n2. 輸入「CH01」查詳情\n3. 點擊下方按鈕直接操作",
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
        sender_id = event.get("source", {}).get("userId", "")
        reply_token = event.get("replyToken")

        # 加好友事件：發送歡迎訊息與綁定說明
        if event_type == "follow":
            welcome = (
                "👋 歡迎加入 DQA Lab Bot！\n\n"
                "若要接收測試通知，請傳送：\n"
                "綁定 你的姓名\n\n"
                "例如：綁定 張三\n\n"
                "其他指令：\n"
                "• 狀態 — 查設備概覽\n"
                "• 幫助 — 查所有指令"
            )
            background_tasks.add_task(
                _send_to_line, reply_token, [{"type": "text", "text": welcome}], client
            )
            continue

        # 只處理文字訊息
        if event_type != "message" or event.get("message", {}).get("type") != "text":
            continue

        user_text = event["message"]["text"].strip()

        # 綁定指令
        if user_text.startswith("綁定"):
            name = user_text[2:].strip()
            reply_text = _handle_bind_command(sender_id, name)
            background_tasks.add_task(
                _send_to_line, reply_token, [{"type": "text", "text": reply_text}], client
            )
            continue

        # 一般指令
        messages = _dispatch_command(user_text, cache)
        background_tasks.add_task(_send_to_line, reply_token, messages, client)

    return JSONResponse(content={"status": "ok"})
