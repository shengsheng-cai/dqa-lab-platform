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
_db_url = os.getenv("DATABASE_URL")
SQLALCHEMY_DATABASE_URL = _db_url if _db_url else f"sqlite:///{BASE_DIR}/test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# ---------- 使用者（多用戶權限）----------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String)
    hashed_password: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="engineer")
    # role: admin / keeper / engineer
    line_user_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    loan_limit: Mapped[int] = mapped_column(Integer, default=10)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # token 持久化（後端重啟不失效）
    current_token: Mapped[Optional[str]] = mapped_column(
        String, nullable=True, index=True
    )
    token_expires_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- 治具基本資料 ----------
class Fixture(Base):
    __tablename__ = "fixtures"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    priority: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    interface_type: Mapped[str] = mapped_column(String)
    form_factor: Mapped[str] = mapped_column(String)
    size: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    purpose: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    estimated_usage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_quantity: Mapped[int] = mapped_column(Integer, default=0)
    shortage: Mapped[int] = mapped_column(Integer, default=0)
    usage_frequency: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    replacement_years: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    keeper_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    keeper_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    deputy_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    vendor: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    model_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    spec: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lead_time: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    unit_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    loan_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )

    __table_args__ = (Index("ix_fixtures_interface_type", "interface_type"),)


# ---------- 治具借出紀錄 ----------
class FixtureLoan(Base):
    __tablename__ = "fixture_loans"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    fixture_id: Mapped[int] = mapped_column(ForeignKey("fixtures.id"), index=True)
    borrower_name: Mapped[str] = mapped_column(String)
    borrower_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    device_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    project_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    loan_date: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )
    due_date: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    return_date: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    status: Mapped[str] = mapped_column(String, default="loaned")
    return_condition: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    extension_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    keeper_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )

    schedule_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("schedules.id"), nullable=True, index=True
    )

    __table_args__ = (
        Index("ix_fixture_loans_status", "status"),
        Index("ix_fixture_loans_due_date", "due_date"),
    )


# ---------- 排程治具關聯（中間表）----------
class ScheduleFixture(Base):
    __tablename__ = "schedule_fixtures"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    schedule_id: Mapped[int] = mapped_column(
        ForeignKey("schedules.id"), index=True
    )
    fixture_id: Mapped[int] = mapped_column(
        ForeignKey("fixtures.id"), index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- 採購紀錄 ----------
class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    fixture_id: Mapped[int] = mapped_column(ForeignKey("fixtures.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vendor: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")
    ordered_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    arrived_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- 訪客 Token ----------
class DemoToken(Base):
    __tablename__ = "demo_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    token: Mapped[str] = mapped_column(String, unique=True, index=True)
    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    expires_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    max_uses: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


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
    operator_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    test_started_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    test_ended_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    photo_before_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    photo_after_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
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

    __table_args__ = (
        Index("ix_device_data_device_timestamp", "device_id", "timestamp"),
    )


# ---------- 設備狀態持久化 ----------
class DeviceState(Base):
    __tablename__ = "device_states"

    # --- 設備核心狀態 ---
    device_id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String, default="IDLE")
    temperature: Mapped[float] = mapped_column(Float, default=25.0)
    humidity: Mapped[float] = mapped_column(Float, default=55.0)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )

    # --- SOP 執行狀態 ---
    running_sop_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    running_sop_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    standard_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    active_sop_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    completed_steps: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )

    # --- 模擬器狀態（物理模擬引擎專用，未來可獨立為 SimulatorState 表）---
    sim_phase: Mapped[Optional[str]] = mapped_column(String, nullable=True, default="idle")
    sim_cycle: Mapped[int] = mapped_column(Integer, default=0)
    dwell_high_start: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    dwell_low_start: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)


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
    completed_steps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_steps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- 排程申請單 ----------
class Schedule(Base):
    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_number: Mapped[str] = mapped_column(String)
    sample_name: Mapped[str] = mapped_column(String)
    applicant_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    applicant_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    device_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    standard: Mapped[str] = mapped_column(String)  # e.g. "IEC 60068"
    conditions: Mapped[str] = mapped_column(Text)  # JSON list of sop_id strings
    start_time: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    end_time: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    # 待審核 / 已確認 / 進行中 / 已完成 / 已取消
    status: Mapped[str] = mapped_column(String, default="待審核")
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    confirmed_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
    )

    __table_args__ = (
        Index("ix_schedules_status", "status"),
        Index("ix_schedules_device_id", "device_id"),
    )


# ---------- 設備不可用時段 ----------
class DeviceBlockedPeriod(Base):
    __tablename__ = "device_blocked_periods"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    device_id: Mapped[str] = mapped_column(String, index=True)
    start_time: Mapped[datetime.datetime] = mapped_column(DateTime)
    end_time: Mapped[datetime.datetime] = mapped_column(DateTime)
    reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- LINE 綁定申請 ----------
class LineBindRequest(Base):
    __tablename__ = "line_bind_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    line_user_id: Mapped[str] = mapped_column(String, index=True)
    requested_name: Mapped[str] = mapped_column(String)  # 使用者填寫的姓名
    # pending / awaiting_name / approved / rejected
    status: Mapped[str] = mapped_column(String, default="pending", index=True)
    matched_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    reviewed_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- LINE 推播失敗紀錄 ----------
class NotificationFailure(Base):
    __tablename__ = "notification_failures"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # sop / fixture / general
    notif_type: Mapped[str] = mapped_column(String, default="general")
    # 方便辨識：device_id 或 user display_name
    target: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    message_preview: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    error_msg: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


# ---------- 資料庫初始化 ----------
def init_db():
    Base.metadata.create_all(bind=engine)
