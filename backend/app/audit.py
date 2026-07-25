import csv
import io
import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from .models import SessionLocal, AuditLog
from .auth import require_admin

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])


def _csv_safe(value) -> str:
    """防 CSV formula injection：值開頭是 = + - @ 或 tab/CR 時前置單引號，
    避免試算表把匯出內容當公式執行。"""
    s = "" if value is None else str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timestamp: datetime.datetime
    actor: str
    role: Optional[str] = None
    action: str
    entity_type: str
    entity_id: str
    detail: Optional[str] = None


@router.get("", response_model=list[AuditLogOut])
def list_audit_logs(
    _: None = Depends(require_admin),
    limit: int = 200,
    offset: int = 0,
    entity_type: Optional[str] = None,
):
    with SessionLocal() as db:
        q = db.query(AuditLog).order_by(AuditLog.timestamp.desc())
        if entity_type:
            q = q.filter(AuditLog.entity_type == entity_type)
        return q.offset(offset).limit(limit).all()


@router.get("/export")
def export_audit_logs(_: None = Depends(require_admin)):
    with SessionLocal() as db:
        logs = db.query(AuditLog).order_by(AuditLog.timestamp.asc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["timestamp", "actor", "role", "action", "entity_type", "entity_id", "detail"])
    for log in logs:
        writer.writerow([
            log.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            _csv_safe(log.actor),
            _csv_safe(log.role or ""),
            _csv_safe(log.action),
            _csv_safe(log.entity_type),
            _csv_safe(log.entity_id),
            _csv_safe(log.detail or ""),
        ])

    output.seek(0)
    filename = f"audit_{datetime.datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )
