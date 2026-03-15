from sqlalchemy import (
    create_engine,
    String,
    Integer,
    Float,
    DateTime,
    Text,
    Boolean,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Mapped, mapped_column
import datetime
import os
from typing import Optional

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQLALCHEMY_DATABASE_URL = f"sqlite:///{BASE_DIR}/test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# ---------- SOP 模板 ----------
class SopTemplate(Base):
    __tablename__ = "sop_templates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sop_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    test_type: Mapped[str] = mapped_column(String)
    version: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    steps_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- SOP 執行主表 ----------
class SopExecution(Base):
    __tablename__ = "sop_executions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sop_id: Mapped[str] = mapped_column(String, index=True)
    device_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    operator: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    test_started_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    test_ended_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- SOP 步驟記錄 ----------
class StepRecord(Base):
    __tablename__ = "step_records"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    execution_id: Mapped[int] = mapped_column(
        ForeignKey("sop_executions.id"), index=True
    )
    step_id: Mapped[int] = mapped_column(Integer)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    parameters: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    photos: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


# ---------- 裝置數據記錄 ----------
class DeviceData(Base):
    __tablename__ = "device_data"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    device_id: Mapped[str] = mapped_column(String, index=True)
    timestamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    humidity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    raw_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # fix: 加入 composite index (device_id, timestamp)
    # reports.py 與 history API 都用 device_id + timestamp 範圍查詢
    # 資料量大時避免全表掃描
    __table_args__ = (
        Index("ix_device_data_device_timestamp", "device_id", "timestamp"),
    )


# ---------- 設備狀態持久化 ----------
class DeviceState(Base):
    __tablename__ = "device_states"

    device_id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String, default="IDLE")
    temperature: Mapped[float] = mapped_column(Float, default=25.0)
    humidity: Mapped[float] = mapped_column(Float, default=55.0)
    running_sop_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    running_sop_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    standard_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    active_sop_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    completed_steps: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    # fix: 移除無效的 onupdate lambda（SQLite 不觸發），改由 _save_device_state 手動更新
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )


# ---------- 異常紀錄 ----------
class ErrorLog(Base):
    __tablename__ = "error_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    device_id: Mapped[str] = mapped_column(String, index=True)
    error_type: Mapped[str] = mapped_column(String)
    sop_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sop_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    humidity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- 資料庫初始化 ----------
def init_db():
    Base.metadata.create_all(bind=engine)
