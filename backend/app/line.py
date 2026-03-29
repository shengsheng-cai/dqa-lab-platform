import os
import hmac
import hashlib
import base64
import httpx
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .models import SessionLocal, User, LineBindRequest, NotificationFailure

# --- Payloads ---
class ApproveBindRequestPayload(BaseModel):
    user_id: int

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


def _log_notif_failure(target: str, text: str, error_msg: str):
    """將推播失敗寫入 notification_failures 表"""
    try:
        with SessionLocal() as db:
            db.add(NotificationFailure(
                notif_type="general",
                target=target,
                message_preview=text[:80] if text else None,
                error_msg=error_msg[:200] if error_msg else None,
            ))
            db.commit()
    except Exception as e:
        logger.error(f"[LINE] 寫入失敗紀錄時例外：{e}")


async def push_message(text: str):
    """主動推播訊息給 env 設定的預設 User ID（供 main.py 緊急通知使用）"""
    token = LINE_CHANNEL_ACCESS_TOKEN
    user_id = LINE_USER_ID

    if not token or not user_id:
        logger.warning("[LINE] 未設定 TOKEN 或 USER_ID，跳過推播")
        _log_notif_failure("(broadcast)", text, "未設定 TOKEN 或 USER_ID")
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
                _log_notif_failure("(broadcast)", text, f"HTTP {res.status_code}: {res.text[:100]}")
        except Exception as e:
            logger.error(f"[LINE] 推播例外：{e}")
            _log_notif_failure("(broadcast)", text, str(e))


async def push_to_user(line_user_id: str, text: str):
    """推播訊息給指定 LINE User ID（供治具通知使用）"""
    token = LINE_CHANNEL_ACCESS_TOKEN

    if not token:
        logger.warning("[LINE] 未設定 CHANNEL_ACCESS_TOKEN，跳過推播")
        _log_notif_failure(line_user_id or "(unknown)", text, "未設定 CHANNEL_ACCESS_TOKEN")
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
                _log_notif_failure(line_user_id, text, f"HTTP {res.status_code}: {res.text[:100]}")
        except Exception as e:
            logger.error(f"[LINE] push_to_user 例外：{e}")
            _log_notif_failure(line_user_id, text, str(e))


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


async def push_sop_notification(operator_user_id: Optional[int], text: str):
    """推播 SOP 通知給操作人員（以 user_id 精確查找），找不到個人 LINE ID 時 fallback 推給環境變數設定的預設帳號。"""
    if operator_user_id:
        try:
            with SessionLocal() as db:
                user = (
                    db.query(User)
                    .filter(User.id == operator_user_id, User.is_active == True)
                    .first()
                )
                if user and user.line_user_id:
                    await push_to_user(user.line_user_id, text)
                    return
        except Exception as e:
            logger.warning(f"[LINE] push_sop_notification 查詢失敗，fallback 廣播：{e}")
    await push_message(text)


# ── 綁定狀態查詢 ────────────────────────────────────────────────

def _get_bound_user(sender_id: str) -> Optional[User]:
    """回傳已綁定此 LINE ID 的 User，否則 None"""
    with SessionLocal() as db:
        return db.query(User).filter(
            User.line_user_id == sender_id, User.is_active == True
        ).first()


def _has_pending_request(sender_id: str) -> bool:
    with SessionLocal() as db:
        return db.query(LineBindRequest).filter(
            LineBindRequest.line_user_id == sender_id,
            LineBindRequest.status.in_(["pending", "awaiting_name"]),
        ).first() is not None


def _has_pending_awaiting_name(sender_id: str) -> bool:
    with SessionLocal() as db:
        return db.query(LineBindRequest).filter(
            LineBindRequest.line_user_id == sender_id,
            LineBindRequest.status == "awaiting_name",
        ).first() is not None


# ── 申請綁定流程 ─────────────────────────────────────────────────

def _start_bind_request(sender_id: str) -> str:
    """使用者點「申請綁定」，建立 awaiting_name 記錄並提示輸入姓名"""
    with SessionLocal() as db:
        # 已綁定
        if db.query(User).filter(User.line_user_id == sender_id, User.is_active == True).first():
            return "✅ 您的帳號已完成綁定，無需重複操作。\n傳「解除綁定」可解除連結。"
        # 已有待審核申請
        existing = db.query(LineBindRequest).filter(
            LineBindRequest.line_user_id == sender_id,
            LineBindRequest.status.in_(["pending", "awaiting_name"]),
        ).first()
        if existing:
            return "⏳ 您已有一筆待審核的申請，請等待管理者確認。"
        # 建立 awaiting_name 記錄
        req = LineBindRequest(
            line_user_id=sender_id,
            requested_name="",
            status="awaiting_name",
        )
        db.add(req)
        db.commit()
    return "請輸入您在系統中的姓名（須與名冊完全相符），例如直接回覆「王小明」\n\n若要取消，請傳「取消申請」。"


def _submit_bind_name(sender_id: str, name: str) -> str:
    """使用者輸入姓名，將 awaiting_name 轉為 pending，通知管理者審核"""
    name = name.strip()
    if not name:
        return "❌ 姓名不可空白，請重新輸入。"
    with SessionLocal() as db:
        req = db.query(LineBindRequest).filter(
            LineBindRequest.line_user_id == sender_id,
            LineBindRequest.status == "awaiting_name",
        ).first()
        if not req:
            return "❓ 請先點擊「申請綁定」按鈕開始流程。"
        # 檢查此 LINE ID 是否已被其他帳號使用
        conflict = db.query(User).filter(
            User.line_user_id == sender_id, User.is_active == True
        ).first()
        if conflict:
            db.delete(req)
            db.commit()
            return f"⚠️ 此 LINE 帳號已綁定至「{conflict.display_name}」，請先解除綁定。"
        # 檢查姓名是否存在（提示但不阻擋，讓管理者確認）
        matches = db.query(User).filter(User.display_name == name, User.is_active == True).all()
        req.requested_name = name
        req.status = "pending"
        db.commit()

    if not matches:
        return (
            f"📩 申請已送出！\n姓名：{name}\n\n"
            "⚠️ 系統中找不到此姓名，管理者審核時會確認。\n請等待通知。"
        )
    if len(matches) > 1:
        return (
            f"📩 申請已送出！\n姓名：{name}\n\n"
            "⚠️ 系統中有多筆同名，管理者將確認後核准。\n請等待通知。"
        )
    return f"📩 申請已送出！\n姓名：{name}\n\n管理者審核後您將收到通知，請稍候。"


def _handle_unbind(sender_id: str) -> str:
    """處理解除綁定"""
    with SessionLocal() as db:
        user = db.query(User).filter(
            User.line_user_id == sender_id, User.is_active == True
        ).first()
        if not user:
            return "⚠️ 您目前尚未綁定任何帳號。"
        name = user.display_name
        user.line_user_id = None
        db.commit()
    return f"✅ 已解除綁定。\n「{name}」與此 LINE 帳號的連結已移除。\n如需重新綁定，請點擊下方「申請綁定」。"


# ── 指令分派（已綁定使用者）────────────────────────────────────

def _dispatch_command(text: str, cache: Dict[str, Any]) -> List[Dict]:
    """解析指令並決定回傳格式（已綁定使用者可用）"""
    cmd = text.strip().lower()
    now_str = datetime.now().strftime("%H:%M:%S")

    if cmd in ("狀態", "status", "s"):
        lines = [f"📊 DQALab 設備概覽 ({now_str})", "━━━━━━━━━━━━━━"]
        if not cache:
            lines.append("❌ 目前無連線設備")
        else:
            for d_id, item in cache.items():
                emoji = STATUS_CONFIG.get(item.get("status"), STATUS_CONFIG["OFFLINE"])["emoji"]
                lines.append(f"{emoji} {d_id}: {item.get('status')}")
        return [{"type": "text", "text": "\n".join(lines), "quickReply": {"items": _get_quick_reply_items(cache)}}]

    for device_id, item in cache.items():
        if cmd in (device_id.lower(),):
            card = _create_flex_detail_card(device_id, item)
            card["quickReply"] = {"items": _get_quick_reply_items(cache)}
            return [card]

    if cmd in ("help", "?", "幫助", "h"):
        return [{
            "type": "text",
            "text": (
                "📋 指令說明：\n"
                "• 狀態 — 所有設備概覽\n"
                "• CH01 / CH02… — 單台設備詳情\n"
                "• 解除綁定 — 解除 LINE 帳號連結\n"
                "• 幫助 — 顯示此說明"
            ),
            "quickReply": {"items": _get_quick_reply_items(cache)},
        }]

    return [{"type": "text", "text": "❓ 未知指令，點擊下方「總覽」開始查詢。", "quickReply": {"items": _get_quick_reply_items(cache)}}]


def _cancel_bind_request(sender_id: str) -> str:
    """使用者取消尚未審核的申請（pending / awaiting_name 均可取消）"""
    with SessionLocal() as db:
        req = db.query(LineBindRequest).filter(
            LineBindRequest.line_user_id == sender_id,
            LineBindRequest.status.in_(["pending", "awaiting_name"]),
        ).first()
        if not req:
            return "ℹ️ 您目前沒有待審核的申請。"
        db.delete(req)
        db.commit()
    return "✅ 已取消申請。\n如需重新申請，請點擊下方「申請綁定」。"


def _unbound_quick_reply() -> List[Dict]:
    return [{"type": "action", "action": {"type": "message", "label": "申請綁定", "text": "申請綁定"}}]


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
        sender_id = event.get("source", {}).get("userId", "")
        reply_token = event.get("replyToken")

        # ── 加好友 ──
        if event_type == "follow":
            bound_user = _get_bound_user(sender_id)
            if bound_user:
                welcome = f"👋 歡迎回來，{bound_user.display_name}！\n\n傳「狀態」查設備概覽，「幫助」查所有指令。"
            else:
                welcome = (
                    "👋 歡迎加入 DQA Lab Bot！\n\n"
                    "⚠️ 您尚未綁定帳號，目前無法使用查詢功能。\n\n"
                    "請點擊下方「申請綁定」，完成後即可接收測試通知與查詢設備狀態。"
                )
            background_tasks.add_task(
                _send_to_line,
                reply_token,
                [{"type": "text", "text": welcome, "quickReply": {"items": _unbound_quick_reply()}}],
                client,
            )
            continue

        # 只處理文字訊息
        if event_type != "message" or event.get("message", {}).get("type") != "text":
            continue

        user_text = event["message"]["text"].strip()
        bound_user = _get_bound_user(sender_id)

        # ── 解除綁定（已綁定才能用）──
        if user_text == "解除綁定":
            reply_text = _handle_unbind(sender_id)
            background_tasks.add_task(
                _send_to_line, reply_token,
                [{"type": "text", "text": reply_text, "quickReply": {"items": _unbound_quick_reply()}}],
                client,
            )
            continue

        # ── 申請綁定流程 ──
        if user_text == "申請綁定":
            reply_text = _start_bind_request(sender_id)
            background_tasks.add_task(
                _send_to_line, reply_token, [{"type": "text", "text": reply_text}], client
            )
            continue

        # ── 取消申請（awaiting_name 或 pending 均可取消）──
        if user_text == "取消申請":
            reply_text = _cancel_bind_request(sender_id)
            background_tasks.add_task(
                _send_to_line, reply_token,
                [{"type": "text", "text": reply_text, "quickReply": {"items": _unbound_quick_reply()}}],
                client,
            )
            continue

        # ── 輸入姓名（awaiting_name 狀態下的任意文字）──
        if not bound_user and _has_pending_awaiting_name(sender_id):
            reply_text = _submit_bind_name(sender_id, user_text)
            background_tasks.add_task(
                _send_to_line, reply_token, [{"type": "text", "text": reply_text}], client
            )
            continue

        # ── 未綁定使用者，封鎖其他指令 ──
        if not bound_user:
            reply_text = "⚠️ 請先完成帳號綁定才能使用查詢功能。"
            background_tasks.add_task(
                _send_to_line, reply_token,
                [{"type": "text", "text": reply_text, "quickReply": {"items": _unbound_quick_reply()}}],
                client,
            )
            continue

        # ── 已綁定：一般指令 ──
        messages = _dispatch_command(user_text, cache)
        background_tasks.add_task(_send_to_line, reply_token, messages, client)

    return JSONResponse(content={"status": "ok"})


# ── 管理者審核 API ───────────────────────────────────────────────

@router.get("/bind-requests")
async def list_bind_requests(request: Request):
    """列出待審核的 LINE 綁定申請（admin only）"""
    if getattr(request.state, "user_role", None) != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    with SessionLocal() as db:
        rows = (
            db.query(LineBindRequest)
            .filter(LineBindRequest.status == "pending")
            .order_by(LineBindRequest.created_at.asc())
            .all()
        )
        return [
            {
                "id": r.id,
                "line_user_id": r.line_user_id,
                "requested_name": r.requested_name,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


@router.post("/bind-requests/{req_id}/approve")
async def approve_bind_request(req_id: int, payload: ApproveBindRequestPayload, request: Request):
    """核准綁定申請（admin only）

    body: { "user_id": <int> }
    """
    if getattr(request.state, "user_role", None) != "admin":
        raise HTTPException(status_code=403, detail="admin only")

    user_id = payload.user_id

    reviewer_id = getattr(request.state, "user_id", None)

    with SessionLocal() as db:
        req = db.query(LineBindRequest).filter(LineBindRequest.id == req_id).first()
        if not req or req.status != "pending":
            raise HTTPException(status_code=404, detail="申請不存在或已處理")

        # 檢查此 LINE ID 是否已被其他帳號使用
        conflict = db.query(User).filter(
            User.line_user_id == req.line_user_id, User.is_active == True
        ).first()
        if conflict:
            raise HTTPException(
                status_code=409,
                detail=f"此 LINE ID 已綁定至「{conflict.display_name}」，請先在人員管理中清除",
            )

        # 查找目標使用者
        target = db.query(User).filter(User.id == user_id, User.is_active == True).first()
        if not target:
            raise HTTPException(status_code=404, detail=f"找不到指定的使用者")

        # 清除該員工的舊 LINE ID（如果有）
        if target.line_user_id and target.line_user_id != req.line_user_id:
            target.line_user_id = None

        target.line_user_id = req.line_user_id
        req.status = "approved"
        req.matched_user_id = target.id
        req.reviewed_by = reviewer_id
        req.reviewed_at = datetime.now(timezone.utc)
        db.commit()
        line_id = req.line_user_id
        name = target.display_name

    # 通知使用者
    import asyncio
    asyncio.create_task(
        push_to_user(line_id, f"✅ 綁定成功！{name} 已連結此 LINE 帳號，往後測試通知將推送至此。")
    )
    return {"status": "approved", "user": name}


@router.post("/bind-requests/{req_id}/reject")
async def reject_bind_request(req_id: int, request: Request):
    """拒絕綁定申請（admin only）"""
    if getattr(request.state, "user_role", None) != "admin":
        raise HTTPException(status_code=403, detail="admin only")

    reviewer_id = getattr(request.state, "user_id", None)

    with SessionLocal() as db:
        req = db.query(LineBindRequest).filter(LineBindRequest.id == req_id).first()
        if not req or req.status != "pending":
            raise HTTPException(status_code=404, detail="申請不存在或已處理")

        req.status = "rejected"
        req.reviewed_by = reviewer_id
        req.reviewed_at = datetime.now(timezone.utc)
        db.commit()
        line_id = req.line_user_id
        name = req.requested_name

    import asyncio
    asyncio.create_task(
        push_to_user(line_id, f"❌ 您的綁定申請（姓名：{name}）已被拒絕，請聯絡管理者確認。")
    )
    return {"status": "rejected"}
