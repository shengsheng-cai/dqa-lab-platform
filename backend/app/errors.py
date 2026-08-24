import datetime
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from typing import Optional
from .models import SessionLocal, ErrorLog

router = APIRouter(prefix="/api/errors", tags=["errors"])


class ErrorLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    error_type: str
    sop_id: Optional[str] = None
    sop_name: Optional[str] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    note: Optional[str] = None
    completed_steps: Optional[int] = None
    total_steps: Optional[int] = None
    created_at: datetime.datetime


@router.get("/", response_model=list[ErrorLogResponse])
def list_errors():
    """取得異常紀錄，最新在前，最多 500 筆"""
    with SessionLocal() as db:
        # 固定查詢上限，避免長時間運行後每次開頁都載入整張表。
        logs = db.query(ErrorLog).order_by(ErrorLog.created_at.desc()).limit(500).all()
        return logs
