# SOP 模組：提供標準樹與 SOP 列表、啟動 SOP 測試、取得 SOP 執行紀錄等功能

import asyncio
import json
import datetime
import os
import shutil
from fastapi import APIRouter, BackgroundTasks, HTTPException, Body, Request, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from .models import SessionLocal, SopTemplate, DeviceState, SopExecution, StepRecord, User, Schedule, ScheduleStatus, FixtureLoan, DeviceBlockedPeriod
from .standards import STANDARDS_AND_SOPS, get_standard_tree
from .utils import _save_device_state
from .auth import _require_admin
from .line import push_message

PHOTO_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads", "photos")
os.makedirs(PHOTO_UPLOAD_DIR, exist_ok=True)

# 導出 API 路由器
router = APIRouter()
execution_router = APIRouter(prefix="/api/sop-executions", tags=["sop-executions"])

# 定義設備 ID 清單（目前支援的五個設備）
DEVICE_IDS = ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"]

import logging
logger = logging.getLogger("sop")


def _validate_start_sop_input(payload: dict, cache: dict) -> tuple:
    """sop_id / device_id / 設備存在性驗證，回傳 (sop_id, device_id, device)"""
    sop_id: str = payload.get("sop_id", "")
    device_id: str = payload.get("device_id", "CH-01")

    if not sop_id:
        raise HTTPException(status_code=400, detail="sop_id 不能為空")
    if device_id not in DEVICE_IDS:
        raise HTTPException(status_code=400, detail=f"無效的 device_id: {device_id}")

    device = cache.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"設備 {device_id} 不存在")

    return sop_id, device_id, device


# 標準樹與 SOP 列表路由
@router.get("/standards/tree")
def get_standards_tree():
    """完整三層標準樹：法規 → 版本 → 測試條件（不含 steps 欄位，節省傳輸量）"""
    tree = get_standard_tree()
    result = {}
    for std_key, std_data in tree.items():
        result[std_key] = {
            "label": std_data["label"],
            "description": std_data["description"],
            "versions": {},
        }
        for ver_key, ver_data in std_data["versions"].items():
            result[std_key]["versions"][ver_key] = {
                "label": ver_data["label"],
                "description": ver_data["description"],
                "tests": {},
            }
            for test_key, test_data in ver_data["tests"].items():
                result[std_key]["versions"][ver_key]["tests"][test_key] = {
                    "sop_id": test_data["sop_id"],
                    "name": test_data["name"],
                    "description": test_data.get("description", ""),
                    "high_temperature": test_data.get("high_temperature"),
                    "low_temperature": test_data.get("low_temperature"),
                    "target_temperature": test_data.get("target_temperature"),
                    "ramp_rate": test_data.get("ramp_rate"),
                    "dwell_time_hours": test_data.get("dwell_time_hours"),
                    "cycles": test_data.get("cycles"),
                    "humidity_rh_percent": test_data.get("humidity_rh_percent"),
                    "humidity_control": test_data.get("humidity_control", False),
                    "power_on": test_data.get("power_on", False),
                    "reference": test_data.get("reference", ""),
                    "temp_tolerance": test_data.get("temp_tolerance", 2.0),
                    "humi_tolerance": test_data.get("humi_tolerance", 5.0),
                    "steps": test_data.get("steps", []),
                }
    return result


# B5 fix: 移除 list_sops 廢棄端點，前端完全不呼叫


# 啟動 SOP 路由
@router.post("/start")
async def start_sop(request: Request, payload: Dict[str, Any] = Body(...)):
    """啟動指定設備的 SOP 測試（admin 才可操作）"""
    _require_admin(request)

    operator: str = payload.get("operator", "")
    operator_user_id: Optional[int] = getattr(request.state, "user_id", None)

    cache = request.app.state.AICM_CACHE
    sop_id, device_id, device = _validate_start_sop_input(payload, cache)

    # 檢查設備是否在不可用時段內
    now_dt = datetime.datetime.now(datetime.timezone.utc)
    with SessionLocal() as db:
        active_block = db.query(DeviceBlockedPeriod).filter(
            DeviceBlockedPeriod.device_id == device_id,
            DeviceBlockedPeriod.start_time <= now_dt,
            DeviceBlockedPeriod.end_time >= now_dt,
        ).first()
    if active_block:
        reason = active_block.reason or "不可用時段"
        raise HTTPException(status_code=409, detail=f"{device_id} 目前在不可用時段內（{reason}），無法啟動測試")

    # 若前端未填 operator，從登入帳號自動帶入顯示名稱
    if not operator and operator_user_id:
        try:
            with SessionLocal() as db:
                u = db.query(User).filter(User.id == operator_user_id).first()
                if u:
                    operator = u.display_name or ""
        except Exception:
            pass

    std_data = STANDARDS_AND_SOPS.get(sop_id, {})
    sop_name = std_data.get("name", sop_id)

    if sop_name == sop_id:
        with SessionLocal() as db:
            sop = db.query(SopTemplate).filter(SopTemplate.sop_id == sop_id).first()
            if sop:
                sop_name = sop.name

    now = datetime.datetime.now(datetime.timezone.utc)

    # 檢查不可用時段
    with SessionLocal() as db:
        blocked = db.query(DeviceBlockedPeriod).filter(
            DeviceBlockedPeriod.device_id == device_id,
            DeviceBlockedPeriod.start_time <= now,
            DeviceBlockedPeriod.end_time > now,
        ).first()
        if blocked:
            raise HTTPException(
                status_code=409,
                detail=f"{device_id} 目前在不可用時段（{blocked.reason or '已設定封鎖'}），無法啟動測試。"
            )

    active_sop_data = {**std_data, "sop_id": sop_id, "name": sop_name}
    active_sop_json = json.dumps(active_sop_data, ensure_ascii=False)

    async with request.app.state.DEVICE_LOCKS[device_id]:
        if device.get("status") != "IDLE":
            raise HTTPException(
                status_code=400, detail=f"{device_id} 非待機狀態（目前：{device.get('status')}），請先停止現有測試。"
            )
        device.update(
            {
                "status": "RUNNING",
                "running_sop_id": sop_id,
                "running_sop_name": sop_name,
                "standard_id": sop_id,
                "active_sop_json": active_sop_json,
                "completed_steps": 0,
                "started_at": now,
                "total_steps": len(std_data.get("steps", [])),
                "operator": operator.strip() if operator else "",
                "operator_user_id": operator_user_id,
                "sim_phase": "idle",
                "sim_cycle": 0,
            }
        )
        _save_device_state(device_id, device)

    _transfer_reserved_fixtures(device_id, now)
    logger.info(f"[{device_id}] Started SOP: {sop_id} ({sop_name}) by {operator or '未填寫'}")

    return {"status": "success", "message": f"{device_id} 已啟動 {sop_name}"}


def _transfer_reserved_fixtures(device_id: str, now: datetime.datetime):
    """將此設備「已確認」或「進行中」排程的預約治具轉為借出"""
    try:
        with SessionLocal() as db:
            active_schedule = (
                db.query(Schedule)
                .filter(Schedule.device_id == device_id, Schedule.status.in_([ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]))
                .first()
            )
            if active_schedule:
                db.query(FixtureLoan).filter(
                    FixtureLoan.schedule_id == active_schedule.id,
                    FixtureLoan.status == "reserved",
                ).update({"status": "loaned", "loan_date": now}, synchronize_session=False)
                db.commit()
    except Exception as e:
        logger.warning(f"[{device_id}] 治具預約轉借出失敗：{e}")


async def auto_start_sop(device_id: str, sop_id: str, cache: dict, locks: dict, operator: str = "排程系統", skip_fixture_transfer: bool = False):
    """排程到達開始時間時自動啟動 SOP（供 auto_advance_schedules 呼叫）"""
    device = cache.get(device_id)
    if not device:
        logger.warning(f"[auto_start] 設備 {device_id} 不在 cache，跳過")
        return
    if device.get("status") != "IDLE":
        logger.info(f"[auto_start] {device_id} 狀態為 {device.get('status')}，非 IDLE，跳過自動啟動")
        return

    std_data = STANDARDS_AND_SOPS.get(sop_id, {})
    if not std_data:
        logger.warning(f"[auto_start] sop_id={sop_id} 查無法規資料，跳過")
        return

    sop_name = std_data.get("name", sop_id)
    now = datetime.datetime.now(datetime.timezone.utc)
    active_sop_data = {**std_data, "sop_id": sop_id, "name": sop_name}
    active_sop_json = json.dumps(active_sop_data, ensure_ascii=False)

    lock = locks.get(device_id)
    if not lock:
        logger.warning(f"[auto_start] {device_id} 無對應 lock，跳過")
        return

    async with lock:
        if device.get("status") != "IDLE":
            return
        device.update({
            "status": "RUNNING",
            "running_sop_id": sop_id,
            "running_sop_name": sop_name,
            "standard_id": sop_id,
            "active_sop_json": active_sop_json,
            "completed_steps": 0,
            "started_at": now,
            "total_steps": len(std_data.get("steps", [])),
            "operator": operator,
            "operator_user_id": None,
            "sim_phase": "idle",
            "sim_cycle": 0,
        })
        _save_device_state(device_id, device)

    # 建立 SopExecution 記錄，並將 id 存入 device cache 供完成時寫入 test_ended_at
    for _attempt in range(3):
        try:
            with SessionLocal() as db:
                execution = SopExecution(
                    sop_id=sop_id,
                    device_id=device_id,
                    operator=operator,
                    test_started_at=now,
                )
                db.add(execution)
                db.flush()
                execution_id = execution.id
                db.commit()
            async with lock:
                device["active_execution_id"] = execution_id
                _save_device_state(device_id, device)
            break
        except Exception as e:
            logger.error(f"[auto_start] {device_id} 建立 SopExecution 失敗（第{_attempt+1}次）：{e}")
            if _attempt == 2:
                logger.error(f"[auto_start] {device_id} 建立 SopExecution 三次失敗，放棄")

    if not skip_fixture_transfer:
        _transfer_reserved_fixtures(device_id, now)
    logger.info(f"[auto_start] {device_id} 自動啟動 SOP: {sop_id} ({sop_name})")


# SOP 執行紀錄路由
class StepRecordSchema(BaseModel):
    step_id: int
    completed: bool
    parameters: Optional[Dict[str, Any]] = None
    photos: Optional[List[str]] = None


class ExecutionCreate(BaseModel):
    sop_id: str
    device_id: Optional[str] = None
    operator: Optional[str] = None
    test_started_at: Optional[datetime.datetime] = None
    test_ended_at: Optional[datetime.datetime] = None
    steps: List[StepRecordSchema]


class ExecutionResponse(BaseModel):
    id: int
    sop_id: str
    device_id: Optional[str] = None
    operator: Optional[str] = None
    created_at: datetime.datetime
    steps: List[StepRecordSchema]


@execution_router.post("/", response_model=ExecutionResponse)
def create_execution(data: ExecutionCreate, request: Request, background_tasks: BackgroundTasks):
    _require_admin(request)
    operator_user_id = getattr(request.state, "user_id", None)
    with SessionLocal() as db:
        execution = SopExecution(
            sop_id=data.sop_id,
            device_id=data.device_id,
            operator=data.operator,
            operator_user_id=operator_user_id,
            test_started_at=data.test_started_at,
            test_ended_at=data.test_ended_at,
        )
        db.add(execution)
        db.flush()

        records = []
        for step in data.steps:
            record = StepRecord(
                execution_id=execution.id,
                step_id=step.step_id,
                completed=step.completed,
                parameters=json.dumps(step.parameters, ensure_ascii=False)
                if step.parameters
                else None,
                photos=json.dumps(step.photos, ensure_ascii=False)
                if step.photos
                else None,
            )
            db.add(record)
            records.append(record)

        db.commit()
        db.refresh(execution)

        sop_template = db.query(SopTemplate).filter(SopTemplate.sop_id == data.sop_id).first()
        sop_display_name = sop_template.name if sop_template else data.sop_id
        # 有進行中排程時，simulator 完成後會 push；手動啟動無排程才從這裡 push
        has_schedule = db.query(Schedule).filter(
            Schedule.device_id == data.device_id,
            Schedule.status.in_([ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]),
        ).first() is not None
        if not has_schedule:
            background_tasks.add_task(
                push_message,
                f"✅ 測試完成\n設備：{data.device_id}\n測試：{sop_display_name}",
            )

        steps_response = [
            StepRecordSchema(
                step_id=r.step_id,
                completed=r.completed,
                parameters=json.loads(r.parameters) if r.parameters else None,
                photos=json.loads(r.photos) if r.photos else None,
            )
            for r in records
        ]

        return ExecutionResponse(
            id=execution.id,
            sop_id=execution.sop_id,
            device_id=execution.device_id,
            operator=execution.operator,
            created_at=execution.created_at,
            steps=steps_response,
        )


@execution_router.get("/{execution_id}", response_model=ExecutionResponse)
def get_execution(execution_id: int):
    with SessionLocal() as db:
        execution = (
            db.query(SopExecution).filter(SopExecution.id == execution_id).first()
        )
        if not execution:
            raise HTTPException(status_code=404, detail="Execution not found")

        records = (
            db.query(StepRecord).filter(StepRecord.execution_id == execution_id).all()
        )
        steps = [
            StepRecordSchema(
                step_id=r.step_id,
                completed=r.completed,
                parameters=json.loads(r.parameters) if r.parameters else None,
                photos=json.loads(r.photos) if r.photos else None,
            )
            for r in records
        ]
        return ExecutionResponse(
            id=execution.id,
            sop_id=execution.sop_id,
            device_id=execution.device_id,
            operator=execution.operator,
            created_at=execution.created_at,
            steps=steps,
        )


@execution_router.post("/{execution_id}/photos")
async def upload_execution_photo(
    execution_id: int,
    request: Request,
    photo_type: str = Form(...),  # "before" | "after"
    file: UploadFile = File(...),
):
    """補充照片：上架時照片（before）或測試結束照（after）"""
    _require_admin(request)
    if photo_type not in ("before", "after"):
        raise HTTPException(status_code=400, detail="photo_type 必須為 before 或 after")

    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    filename = f"{execution_id}_{photo_type}{ext}"
    dest = os.path.join(PHOTO_UPLOAD_DIR, filename)

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    with SessionLocal() as db:
        execution = (
            db.query(SopExecution).filter(SopExecution.id == execution_id).first()
        )
        if not execution:
            os.remove(dest)
            raise HTTPException(status_code=404, detail="Execution not found")
        if photo_type == "before":
            execution.photo_before_path = filename
        else:
            execution.photo_after_path = filename
        db.commit()

    return {"status": "ok", "filename": filename}
