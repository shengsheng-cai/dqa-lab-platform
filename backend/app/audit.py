import csv
import io
import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from .models import SessionLocal, AuditLog
from .auth import require_admin
from .utils import _now_utc_naive

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])


def log_audit(
    db,
    actor: str,
    role: Optional[str],
    action: str,
    entity_type: str,
    entity_id: str,
    detail: Optional[str] = None,
):
    db.add(AuditLog(
        timestamp=_now_utc_naive(),
        actor=actor,
        role=role,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        detail=detail,
    ))


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
            log.actor,
            log.role or "",
            log.action,
            log.entity_type,
            log.entity_id,
            log.detail or "",
        ])

    output.seek(0)
    filename = f"audit_{datetime.datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
