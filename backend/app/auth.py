import os
import time
import secrets
import datetime
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .models import SessionLocal, User, DemoToken

logger = logging.getLogger("auth")

DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "")

_fail_tracker: dict = {}
_FAIL_TRACKER_MAXSIZE = 1000

TOKEN_TTL = 8 * 60 * 60  # 8 小時

SKIP_PATHS = {
    "/api/line/webhook",
    "/docs",
    "/openapi.json",
    "/api/latest",
    "/health",
    "/api/auth/login",
    "/api/auth/demo-login",
    "/api/auth/guest-hint",
}
MAX_ATTEMPTS = 5
BLOCK_SECONDS = 600

router = APIRouter()


# ---------- 密碼雜湊 ----------
import bcrypt as _bcrypt


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return _bcrypt.checkpw(password.encode(), hashed.encode())


# ---------- Token（存 DB，重啟不失效）----------
def create_token(user: User, db) -> str:
    token = secrets.token_hex(32)
    expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        seconds=TOKEN_TTL
    )
    user.current_token = token
    user.token_expires_at = expires
    db.commit()
    return token


def get_token_info(token: str) -> Optional[dict]:
    if not token:
        return None
    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(
                User.current_token == token,
                User.is_active == True,
            )
            .first()
        )
        if not user:
            return None
        if user.token_expires_at is None:
            return None
        expires = user.token_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=datetime.timezone.utc)
        if expires < datetime.datetime.now(datetime.timezone.utc):
            return None
        return {"user_id": user.id, "role": user.role}
    finally:
        db.close()


def revoke_token(token: str):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.current_token == token).first()
        if user:
            user.current_token = None
            user.token_expires_at = None
            db.commit()
    finally:
        db.close()


# ---------- Rate limiting ----------
def _get_tracker(ip: str) -> dict:
    if ip not in _fail_tracker:
        if len(_fail_tracker) >= _FAIL_TRACKER_MAXSIZE:
            now = time.time()
            expired = [
                k
                for k, v in _fail_tracker.items()
                if v["blocked_until"] < now and v["count"] == 0
            ]
            for k in expired:
                del _fail_tracker[k]
            if len(_fail_tracker) >= _FAIL_TRACKER_MAXSIZE:
                # 按 blocked_until 升序排序，刪除最早到期（最無效）的一半
                sorted_keys = sorted(
                    _fail_tracker, key=lambda k: _fail_tracker[k]["blocked_until"]
                )
                for k in sorted_keys[: _FAIL_TRACKER_MAXSIZE // 2]:
                    del _fail_tracker[k]
        _fail_tracker[ip] = {"count": 0, "blocked_until": 0.0}
    return _fail_tracker[ip]


# ---------- Pydantic Schemas ----------

class UserMeResponse(BaseModel):
    id: int
    display_name: str
    role: str


class UserOut(UserMeResponse):
    is_active: bool
    created_at: Optional[str] = None


# ---------- 登入 API ----------
class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    role: str
    display_name: str
    user_id: int


@router.post("/api/auth/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request):
    ip = request.client.host
    tracker = _get_tracker(ip)
    now = time.time()

    if tracker["blocked_until"] > now:
        remaining = int(tracker["blocked_until"] - now)
        return JSONResponse(
            status_code=429, content={"detail": f"太多次錯誤，請 {remaining} 秒後再試"}
        )

    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(User.username == body.username, User.is_active == True)
            .first()
        )

        if not user or not verify_password(body.password, user.hashed_password):
            tracker["count"] += 1
            if tracker["count"] >= MAX_ATTEMPTS:
                tracker["blocked_until"] = now + BLOCK_SECONDS
                tracker["count"] = 0
                return JSONResponse(
                    status_code=429, content={"detail": "錯誤次數過多，封鎖 10 分鐘"}
                )
            return JSONResponse(status_code=401, content={"detail": "帳號或密碼錯誤"})

        tracker["count"] = 0
        token = create_token(user, db)
        return LoginResponse(
            token=token, role=user.role, display_name=user.display_name, user_id=user.id
        )
    finally:
        db.close()


@router.post("/api/auth/logout")
def logout(request: Request):
    token = request.headers.get("X-User-Token", "")
    if token:
        revoke_token(token)
    return {"ok": True}


@router.get("/api/auth/me", response_model=UserMeResponse)
def get_me(request: Request):
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登入或訪客模式")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
        if not user:
            raise HTTPException(status_code=401, detail="使用者不存在或已停用")
        return {
            "id": user.id,
            "display_name": user.display_name,
            "role": user.role,
        }
    finally:
        db.close()


# ---------- 使用者管理（admin only）----------

def require_admin(request: Request):
    role = getattr(request.state, "user_role", None)
    if role != "admin":
        raise HTTPException(status_code=403, detail="需要管理者權限")


class UserCreateBody(BaseModel):
    display_name: str
    role: str = "admin"


class UserUpdateBody(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/api/auth/users", response_model=list[UserOut])
def list_users(_: None = Depends(require_admin)):
    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.created_at.asc()).all()
        return [
            {
                "id": u.id,
                "display_name": u.display_name,
                "role": u.role,
                "is_active": u.is_active,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ]
    finally:
        db.close()


@router.post("/api/auth/users", status_code=201, response_model=UserMeResponse)
def create_user(body: UserCreateBody, _: None = Depends(require_admin)):
    if not body.role or not body.role.strip():
        raise HTTPException(status_code=400, detail="角色不能為空")
    db = SessionLocal()
    try:
        # username 自動產生，這類使用者不需要登入
        username = f"user_{secrets.token_hex(4)}"
        # 密碼設隨機雜湊，無法用於登入
        dummy_pwd = hash_password(secrets.token_hex(16))
        user = User(
            username=username,
            display_name=body.display_name,
            hashed_password=dummy_pwd,
            role=body.role,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"id": user.id, "display_name": user.display_name, "role": user.role}
    finally:
        db.close()


@router.patch("/api/auth/users/{user_id}")
def update_user(user_id: int, body: UserUpdateBody, _: None = Depends(require_admin)):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="使用者不存在")
        if body.display_name is not None:
            user.display_name = body.display_name
        if body.role is not None:
            if not body.role.strip():
                raise HTTPException(status_code=400, detail="角色不能為空")
            user.role = body.role
        # 使用 __fields_set__ 檢測是否被顯式傳入（包括 null）
        if body.is_active is not None:
            user.is_active = body.is_active
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.delete("/api/auth/users/{user_id}")
def delete_user(user_id: int, request: Request, _: None = Depends(require_admin)):
    # 取得當前登入者 ID，不允許刪除自己
    current_token = request.headers.get("X-User-Token", "")
    db = SessionLocal()
    try:
        current = db.query(User).filter(User.current_token == current_token).first()
        if current and current.id == user_id:
            raise HTTPException(status_code=400, detail="無法刪除自己的帳號")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="使用者不存在")
        db.delete(user)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.get("/api/auth/guest-hint")
def guest_hint():
    """供登入頁顯示一鍵體驗按鈕，DEMO_PASSWORD 有設定時回傳 token 值。"""
    if not DEMO_PASSWORD:
        return {"token": None}
    return {"token": DEMO_PASSWORD}


# ---------- Demo Token ----------

_DEMO_TOKEN_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _gen_demo_token() -> str:
    return "".join(secrets.choice(_DEMO_TOKEN_CHARS) for _ in range(8))


class DemoTokenCreate(BaseModel):
    label: Optional[str] = None
    expires_days: Optional[int] = None  # None = 永不到期
    max_uses: Optional[int] = None      # None = 無限次


@router.get("/api/auth/demo-tokens")
def list_demo_tokens(_: None = Depends(require_admin)):
    db = SessionLocal()
    try:
        rows = db.query(DemoToken).order_by(DemoToken.created_at.desc()).all()
        now = datetime.datetime.now(datetime.timezone.utc)
        result = []
        for t in rows:
            expires_at = t.expires_at
            expired = (
                expires_at is not None
                and expires_at.replace(tzinfo=datetime.timezone.utc) < now
            )
            used_up = t.max_uses is not None and t.use_count >= t.max_uses
            result.append({
                "id": t.id,
                "token": t.token,
                "label": t.label,
                "expires_at": t.expires_at.isoformat() if t.expires_at else None,
                "max_uses": t.max_uses,
                "use_count": t.use_count,
                "is_active": t.is_active,
                "expired": expired,
                "used_up": used_up,
                "created_at": t.created_at.isoformat(),
            })
        return result
    finally:
        db.close()


@router.post("/api/auth/demo-tokens")
def create_demo_token(req: DemoTokenCreate, request: Request, _: None = Depends(require_admin)):
    db = SessionLocal()
    try:
        expires_at = None
        if req.expires_days:
            expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=req.expires_days)
        token_str = _gen_demo_token()
        # 確保唯一
        while db.query(DemoToken).filter(DemoToken.token == token_str).first():
            token_str = _gen_demo_token()
        t = DemoToken(
            token=token_str,
            label=req.label,
            created_by=getattr(request.state, "user_id", None),
            expires_at=expires_at,
            max_uses=req.max_uses,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return {
            "id": t.id,
            "token": t.token,
            "label": t.label,
            "expires_at": t.expires_at.isoformat() if t.expires_at else None,
            "max_uses": t.max_uses,
            "use_count": 0,
            "is_active": True,
        }
    finally:
        db.close()


@router.delete("/api/auth/demo-tokens/{token_id}")
def delete_demo_token(token_id: int, _: None = Depends(require_admin)):
    db = SessionLocal()
    try:
        t = db.query(DemoToken).filter(DemoToken.id == token_id).first()
        if not t:
            raise HTTPException(status_code=404, detail="Token 不存在")
        db.delete(t)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.patch("/api/auth/demo-tokens/{token_id}/toggle")
def toggle_demo_token(token_id: int, _: None = Depends(require_admin)):
    db = SessionLocal()
    try:
        t = db.query(DemoToken).filter(DemoToken.id == token_id).first()
        if not t:
            raise HTTPException(status_code=404, detail="Token 不存在")
        t.is_active = not t.is_active
        db.commit()
        return {"id": t.id, "is_active": t.is_active}
    finally:
        db.close()


def _validate_demo_token(provided: str) -> bool:
    """驗證訪客 token 是否有效（不遞增 use_count，供 middleware 每次 request 呼叫）。"""
    db = SessionLocal()
    try:
        t = db.query(DemoToken).filter(
            DemoToken.token == provided,
            DemoToken.is_active == True,
        ).first()
        if not t:
            return False
        now = datetime.datetime.now(datetime.timezone.utc)
        if t.expires_at and t.expires_at.replace(tzinfo=datetime.timezone.utc) < now:
            return False
        if t.max_uses is not None and t.use_count >= t.max_uses:
            return False
        return True
    except Exception:
        logger.exception("_check_demo_token 驗證失敗")
        return False
    finally:
        db.close()


def _use_demo_token(provided: str) -> bool:
    """驗證訪客 token 並遞增 use_count（僅在登入時呼叫一次）。"""
    db = SessionLocal()
    try:
        # 先驗證 token 是否有效（不遞增 use_count）
        t = db.query(DemoToken).filter(
            DemoToken.token == provided,
            DemoToken.is_active == True,
        ).first()
        if not t:
            return False
        now = datetime.datetime.now(datetime.timezone.utc)
        if t.expires_at and t.expires_at.replace(tzinfo=datetime.timezone.utc) < now:
            return False
        if t.max_uses is not None and t.use_count >= t.max_uses:
            return False

        # SQL-level atomic update，確保 use_count 遞增的原子性
        updated = (
            db.query(DemoToken)
            .filter(
                DemoToken.token == provided,
                DemoToken.is_active == True,
                (DemoToken.max_uses == None) | (DemoToken.use_count < DemoToken.max_uses)
            )
            .update({DemoToken.use_count: DemoToken.use_count + 1}, synchronize_session="fetch")
        )
        db.commit()
        return updated > 0
    except Exception:
        logger.exception("_use_demo_token 更新失敗")
        return False
    finally:
        db.close()


# ---------- 訪客登入端點 ----------

class DemoLoginRequest(BaseModel):
    token: str


@router.post("/api/auth/demo-login")
def demo_login(body: DemoLoginRequest, request: Request):
    ip = request.client.host
    tracker = _get_tracker(ip)
    now = time.time()

    if tracker["blocked_until"] > now:
        remaining = int(tracker["blocked_until"] - now)
        return JSONResponse(
            status_code=429, content={"detail": f"太多次錯誤，請 {remaining} 秒後再試"}
        )

    if _use_demo_token(body.token) or (DEMO_PASSWORD and body.token == DEMO_PASSWORD):
        tracker["count"] = 0
        return {"ok": True}

    tracker["count"] += 1
    if tracker["count"] >= MAX_ATTEMPTS:
        tracker["blocked_until"] = now + BLOCK_SECONDS
        tracker["count"] = 0
        return JSONResponse(status_code=429, content={"detail": "錯誤次數過多，封鎖 10 分鐘"})

    return JSONResponse(status_code=401, content={"detail": "Token 無效、已過期或已達使用上限"})


# ---------- Middleware ----------
async def auth_middleware(request: Request, call_next):
    # 非 API 路徑（前端 SPA 靜態檔案：/, /assets/*, /index.html 等）直接放行
    # 保護範圍僅限 /api/*；登入驗證由前端 LoginPage 把關
    if not request.url.path.startswith("/api/"):
        return await call_next(request)

    if any(request.url.path.startswith(p) for p in SKIP_PATHS):
        return await call_next(request)

    if request.method == "OPTIONS":
        return await call_next(request)

    ip = request.client.host
    tracker = _get_tracker(ip)
    now = time.time()

    if tracker["blocked_until"] > now:
        remaining = int(tracker["blocked_until"] - now)
        return JSONResponse(
            status_code=429, content={"detail": f"太多次錯誤，請 {remaining} 秒後再試"}
        )

    # 檢查雙 token 攻擊（同時送 X-User-Token + X-Demo-Password 是衝突的）
    user_token = request.headers.get("X-User-Token", "")
    demo_token = request.headers.get("X-Demo-Password", "")
    if user_token and demo_token:
        logger.warning(f"[SECURITY] 雙 token 衝突（IP: {ip}）：同時送 X-User-Token + X-Demo-Password")
        return JSONResponse(
            status_code=400, content={"detail": "不能同時使用帳號 Token 與訪客 Token"}
        )

    # 方式一：X-User-Token（帳號登入，查 DB）— 不受 DEMO_PASSWORD 是否設定影響
    if user_token:
        info = get_token_info(user_token)
        if info:
            request.state.user_role = info["role"]
            request.state.user_id = info["user_id"]
            tracker["count"] = 0
            return await call_next(request)
        return JSONResponse(
            status_code=401, content={"detail": "Token 無效或已過期，請重新登入"}
        )

    # 未設定 DEMO_PASSWORD 時放行（開發環境，未設定訪客認證）
    if not DEMO_PASSWORD:
        return await call_next(request)

    # 方式二：X-Demo-Password（訪客模式）
    # 優先查 demo_tokens DB；後備：環境變數 DEMO_PASSWORD（master key）
    if demo_token:
        if _validate_demo_token(demo_token) or (DEMO_PASSWORD and demo_token == DEMO_PASSWORD):
            request.state.user_role = "guest"
            request.state.user_id = None
            tracker["count"] = 0
            return await call_next(request)
        # Token 格式存在但已失效（過期/耗盡/停用）→ 直接 401，不計入失敗次數
        # 避免合法的已過期 session 持續輪詢時封鎖 IP
        return JSONResponse(status_code=401, content={"detail": "Token 已失效，請重新登入"})

    # 完全未提供任何憑證 → 計入失敗次數（防暴力掃描）
    tracker["count"] += 1
    if tracker["count"] >= MAX_ATTEMPTS:
        tracker["blocked_until"] = now + BLOCK_SECONDS
        tracker["count"] = 0
        return JSONResponse(
            status_code=429, content={"detail": "錯誤次數過多，封鎖 10 分鐘"}
        )

    return JSONResponse(status_code=401, content={"detail": "未提供認證"})
