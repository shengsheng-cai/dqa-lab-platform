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
    # fix #9: 新增步驟進度欄位
    completed_steps: Optional[int] = None
    total_steps: Optional[int] = None
    created_at: datetime.datetime


@router.get("/", response_model=list[ErrorLogResponse])
def list_errors():
    """取得異常紀錄，最新在前，最多 500 筆"""
    with SessionLocal() as db:
        # fix #8: 加上 limit(500) 避免長期運行後全表掃描
        logs = db.query(ErrorLog).order_by(ErrorLog.created_at.desc()).limit(500).all()
        return logs
