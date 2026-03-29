# LINE 推播失敗紀錄 API
from fastapi import APIRouter, HTTPException, Request
from .models import SessionLocal, NotificationFailure

router = APIRouter(prefix="/api/notification-failures", tags=["notification-failures"])


@router.get("/")
def list_failures(request: Request):
    """列出未讀的推播失敗紀錄（admin only）"""
    if getattr(request.state, "user_role", None) != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    with SessionLocal() as db:
        rows = (
            db.query(NotificationFailure)
            .filter(NotificationFailure.is_read == False)
            .order_by(NotificationFailure.created_at.desc())
            .limit(50)
            .all()
        )
        return [
            {
                "id": r.id,
                "notif_type": r.notif_type,
                "target": r.target,
                "message_preview": r.message_preview,
                "error_msg": r.error_msg,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


@router.post("/clear")
def clear_failures(request: Request):
    """將所有未讀失敗標為已讀（admin only）"""
    if getattr(request.state, "user_role", None) != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    with SessionLocal() as db:
        count = (
            db.query(NotificationFailure)
            .filter(NotificationFailure.is_read == False)
            .update({"is_read": True})
        )
        db.commit()
    return {"cleared": count}
