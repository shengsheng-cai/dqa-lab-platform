from sqlalchemy import create_engine, String, Integer, Float, DateTime, Text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Mapped, mapped_column
import datetime
from typing import Optional

# 資料庫連線設定
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 現代宣告式基底類別
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
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)

# ---------- SOP 執行主表 ----------
class SopExecution(Base):
    __tablename__ = "sop_executions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sop_id: Mapped[str] = mapped_column(String, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)

# ---------- SOP 步驟記錄 ----------
class StepRecord(Base):
    __tablename__ = "step_records"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    execution_id: Mapped[int] = mapped_column(Integer, index=True)
    step_id: Mapped[int] = mapped_column(Integer)
    completed: Mapped[int] = mapped_column(Integer)
    parameters: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    photos: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

# ---------- 裝置數據記錄（序列埠資料）----------
class DeviceData(Base):
    __tablename__ = "device_data"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    device_id: Mapped[str] = mapped_column(String, index=True)          # 裝置識別碼
    timestamp: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 溫度
    humidity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)     # 濕度
    raw_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)        # 原始資料