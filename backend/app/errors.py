from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from .models import SessionLocal, ErrorLog

router = APIRouter(prefix="/api/errors", tags=["errors"])


class ErrorLogResponse(BaseModel):
    id: int
    device_id: str
    error_type: str
    sop_id: Optional[str]
    sop_name: Optional[str]
    temperature: Optional[float]
    humidity: Optional[float]
    note: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


@router.get("/", response_model=list[ErrorLogResponse])
def list_errors():
    """取得所有異常紀錄，最新在前"""
    with SessionLocal() as db:
        logs = db.query(ErrorLog).order_by(ErrorLog.created_at.desc()).all()
        return [
            ErrorLogResponse(
                id=e.id,
                device_id=e.device_id,
                error_type=e.error_type,
                sop_id=e.sop_id,
                sop_name=e.sop_name,
                temperature=e.temperature,
                humidity=e.humidity,
                note=e.note,
                created_at=e.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            )
            for e in logs
        ]
