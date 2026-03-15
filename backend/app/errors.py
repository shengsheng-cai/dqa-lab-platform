import datetime
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from .models import SessionLocal, ErrorLog

router = APIRouter(prefix="/api/errors", tags=["errors"])


class ErrorLogResponse(BaseModel):
    id: int
    device_id: str
    error_type: str
    sop_id: Optional[str] = None
    sop_name: Optional[str] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    note: Optional[str] = None
    # 統一用 datetime，由 FastAPI 自動序列化為 ISO 8601
    created_at: datetime.datetime

    class Config:
        from_attributes = True


@router.get("/", response_model=list[ErrorLogResponse])
def list_errors():
    """取得所有異常紀錄，最新在前"""
    with SessionLocal() as db:
        logs = db.query(ErrorLog).order_by(ErrorLog.created_at.desc()).all()
        return logs
