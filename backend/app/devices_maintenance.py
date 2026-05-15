"""
設備校驗 & 維護排程 API
"""
import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from .models import SessionLocal, DeviceCalibration, DeviceMaintenance
from .auth import require_admin
from .utils import _now_utc_naive
from .constants import DEVICE_IDS

router = APIRouter(tags=["maintenance"])


# ── Pydantic Schemas ─────────────────────────────────────────────────────────


class CalibrationCreate(BaseModel):
    calibration_date: datetime.datetime
    next_calibration_date: datetime.datetime
    interval_days: int = 365
    certificate_number: Optional[str] = None
    result: str
    notes: Optional[str] = None
    created_by: str


class CalibrationUpdate(BaseModel):
    calibration_date: Optional[datetime.datetime] = None
    next_calibration_date: Optional[datetime.datetime] = None
    interval_days: Optional[int] = None
    certificate_number: Optional[str] = None
    result: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None


class CalibrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    calibration_date: datetime.datetime
    next_calibration_date: datetime.datetime
    interval_days: int
    certificate_number: Optional[str]
    result: str
    notes: Optional[str]
    created_by: str
    created_at: Optional[datetime.datetime]


class MaintenanceCreate(BaseModel):
    maintenance_date: datetime.datetime
    maintenance_type: str
    description: str
    performed_by: str
    next_maintenance_date: Optional[datetime.datetime] = None


class MaintenanceUpdate(BaseModel):
    maintenance_date: Optional[datetime.datetime] = None
    maintenance_type: Optional[str] = None
    description: Optional[str] = None
    performed_by: Optional[str] = None
    next_maintenance_date: Optional[datetime.datetime] = None


class MaintenanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    maintenance_date: datetime.datetime
    maintenance_type: str
    description: str
    performed_by: str
    next_maintenance_date: Optional[datetime.datetime]
    created_at: Optional[datetime.datetime]


# ── Calibration Endpoints ────────────────────────────────────────────────────


@router.get("/api/devices/{device_id}/calibrations", response_model=List[CalibrationOut])
def list_calibrations(device_id: str):
    with SessionLocal() as db:
        return (
            db.query(DeviceCalibration)
            .filter(DeviceCalibration.device_id == device_id)
            .order_by(DeviceCalibration.id.desc())
            .all()
        )


@router.post("/api/devices/{device_id}/calibrations", response_model=CalibrationOut, status_code=201)
def create_calibration(device_id: str, body: CalibrationCreate, _: None = Depends(require_admin)):
    with SessionLocal() as db:
        cal = DeviceCalibration(
            device_id=device_id,
            calibration_date=body.calibration_date,
            next_calibration_date=body.next_calibration_date,
            interval_days=body.interval_days,
            certificate_number=body.certificate_number,
            result=body.result,
            notes=body.notes,
            created_by=body.created_by,
        )
        db.add(cal)
        db.commit()
        db.refresh(cal)
        return cal


@router.put("/api/devices/{device_id}/calibrations/{cal_id}", response_model=CalibrationOut)
def update_calibration(
    device_id: str,
    cal_id: int,
    body: CalibrationUpdate,
    _: None = Depends(require_admin),
):
    with SessionLocal() as db:
        cal = (
            db.query(DeviceCalibration)
            .filter(DeviceCalibration.id == cal_id, DeviceCalibration.device_id == device_id)
            .first()
        )
        if not cal:
            raise HTTPException(status_code=404, detail="校驗紀錄不存在")
        for field, value in body.model_dump(exclude_none=True).items():
            setattr(cal, field, value)
        db.commit()
        db.refresh(cal)
        return cal


@router.delete("/api/devices/{device_id}/calibrations/{cal_id}")
def delete_calibration(
    device_id: str,
    cal_id: int,
    _: None = Depends(require_admin),
):
    with SessionLocal() as db:
        cal = (
            db.query(DeviceCalibration)
            .filter(DeviceCalibration.id == cal_id, DeviceCalibration.device_id == device_id)
            .first()
        )
        if not cal:
            raise HTTPException(status_code=404, detail="校驗紀錄不存在")
        db.delete(cal)
        db.commit()
        return {"ok": True}


# ── Maintenance Endpoints ────────────────────────────────────────────────────


@router.get("/api/devices/{device_id}/maintenances", response_model=List[MaintenanceOut])
def list_maintenances(device_id: str):
    with SessionLocal() as db:
        return (
            db.query(DeviceMaintenance)
            .filter(DeviceMaintenance.device_id == device_id)
            .order_by(DeviceMaintenance.id.desc())
            .all()
        )


@router.post("/api/devices/{device_id}/maintenances", response_model=MaintenanceOut, status_code=201)
def create_maintenance(device_id: str, body: MaintenanceCreate, _: None = Depends(require_admin)):
    with SessionLocal() as db:
        maint = DeviceMaintenance(
            device_id=device_id,
            maintenance_date=body.maintenance_date,
            maintenance_type=body.maintenance_type,
            description=body.description,
            performed_by=body.performed_by,
            next_maintenance_date=body.next_maintenance_date,
        )
        db.add(maint)
        db.commit()
        db.refresh(maint)
        return maint


@router.put("/api/devices/{device_id}/maintenances/{maint_id}", response_model=MaintenanceOut)
def update_maintenance(
    device_id: str,
    maint_id: int,
    body: MaintenanceUpdate,
    _: None = Depends(require_admin),
):
    with SessionLocal() as db:
        maint = (
            db.query(DeviceMaintenance)
            .filter(DeviceMaintenance.id == maint_id, DeviceMaintenance.device_id == device_id)
            .first()
        )
        if not maint:
            raise HTTPException(status_code=404, detail="維護紀錄不存在")
        for field, value in body.model_dump(exclude_none=True).items():
            setattr(maint, field, value)
        db.commit()
        db.refresh(maint)
        return maint


@router.delete("/api/devices/{device_id}/maintenances/{maint_id}")
def delete_maintenance(
    device_id: str,
    maint_id: int,
    _: None = Depends(require_admin),
):
    with SessionLocal() as db:
        maint = (
            db.query(DeviceMaintenance)
            .filter(DeviceMaintenance.id == maint_id, DeviceMaintenance.device_id == device_id)
            .first()
        )
        if not maint:
            raise HTTPException(status_code=404, detail="維護紀錄不存在")
        db.delete(maint)
        db.commit()
        return {"ok": True}


# ── Calibration Status Summary ───────────────────────────────────────────────


@router.get("/api/maintenance/calibration-status")
def calibration_status():
    """回傳所有設備的校驗狀態摘要"""
    today = _now_utc_naive()
    with SessionLocal() as db:
        subq = (
            db.query(
                DeviceCalibration.device_id,
                func.max(DeviceCalibration.next_calibration_date).label("max_date"),
            )
            .group_by(DeviceCalibration.device_id)
            .subquery()
        )
        rows = (
            db.query(DeviceCalibration)
            .join(
                subq,
                (DeviceCalibration.device_id == subq.c.device_id)
                & (DeviceCalibration.next_calibration_date == subq.c.max_date),
            )
            .all()
        )
        latest_map = {r.device_id: r for r in rows}

    result = {}
    for device_id in DEVICE_IDS:
        latest = latest_map.get(device_id)
        if not latest:
            result[device_id] = {"status": "unknown", "next_calibration_date": None, "days_remaining": None}
            continue
        days_remaining = (latest.next_calibration_date - today).days
        if days_remaining < 0:
            status = "overdue"
        elif days_remaining <= 30:
            status = "due_soon"
        else:
            status = "ok"
        result[device_id] = {
            "status": status,
            "next_calibration_date": latest.next_calibration_date.isoformat(),
            "days_remaining": days_remaining,
        }
    return result
