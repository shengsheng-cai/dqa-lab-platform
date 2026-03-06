from fastapi import APIRouter, HTTPException, Body, Request
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import json
from datetime import datetime
from .models import SessionLocal, SopTemplate, DeviceState, SopExecution, StepRecord
from .standards import STANDARDS_AND_SOPS, get_standard_tree

router = APIRouter()
execution_router = APIRouter(prefix="/api/sop-executions", tags=["sop-executions"])

DEVICE_IDS = ["KSON_CH01", "KSON_CH02", "KSON_CH03", "KSON_CH04", "KSON_CH05"]


class SopResponse(BaseModel):
    sop_id: str
    name: str
    test_type: str
    version: str
    steps: List[dict]
    description: Optional[str] = ""


@router.get("/standards/tree")
def get_standards_tree():
    """完整三層標準樹：法規 → 版本 → 測試條件"""
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


@router.get("/", response_model=List[SopResponse])
def list_sops():
    """SOP 列表（從 STANDARD_TREE 自動展開 + 資料庫客製 SOP）"""
    sops: List[SopResponse] = [
        SopResponse(
            sop_id=std_data.get("sop_id", sop_id),
            name=std_data.get("name", ""),
            test_type=std_data.get("test_type", "chamber"),
            version=std_data.get("version", ""),
            description=std_data.get("description", ""),
            steps=std_data.get("steps", [])
            if isinstance(std_data.get("steps"), list)
            else [],
        )
        for sop_id, std_data in STANDARDS_AND_SOPS.items()
    ]

    with SessionLocal() as db:
        existing_ids = {s.sop_id for s in sops}
        for s in db.query(SopTemplate).all():
            if s.sop_id not in existing_ids:
                sops.append(
                    SopResponse(
                        sop_id=s.sop_id,
                        name=s.name,
                        test_type=s.test_type,
                        version=s.version,
                        steps=json.loads(s.steps_json) if s.steps_json else [],
                    )
                )

    return sops


@router.post("/start")
async def start_sop(request: Request, payload: Dict[str, Any] = Body(...)):
    """啟動指定設備的 SOP 測試"""
    sop_id: str = payload.get("sop_id", "")
    device_id: str = payload.get("device_id", "KSON_CH01")

    if not sop_id:
        raise HTTPException(status_code=400, detail="sop_id 不能為空")
    if device_id not in DEVICE_IDS:
        raise HTTPException(status_code=400, detail=f"無效的 device_id: {device_id}")

    cache = request.app.state.AICM_CACHE
    device = cache.get(device_id)

    if not device:
        raise HTTPException(status_code=404, detail=f"設備 {device_id} 不存在")
    if device.get("status") == "RUNNING":
        raise HTTPException(
            status_code=400, detail=f"{device_id} 正在執行中，請先停止。"
        )

    std_data = STANDARDS_AND_SOPS.get(sop_id, {})
    sop_name = std_data.get("name", sop_id)

    if sop_name == sop_id:
        with SessionLocal() as db:
            sop = db.query(SopTemplate).filter(SopTemplate.sop_id == sop_id).first()
            if sop:
                sop_name = sop.name

    device.update(
        {
            "status": "RUNNING",
            "running_sop_id": sop_id,
            "running_sop_name": sop_name,
            "standard_id": sop_id,
        }
    )

    # 把 active_sop 資料存入 DeviceState 供前端重啟後恢復
    import datetime as dt

    active_sop_data = {**std_data, "sop_id": sop_id, "name": sop_name}
    active_sop_json = json.dumps(active_sop_data, ensure_ascii=False)
    device["active_sop_json"] = active_sop_json
    with SessionLocal() as db:
        state = db.get(DeviceState, device_id)
        if state is None:
            state = DeviceState(device_id=device_id)
            db.add(state)
        state.status = "RUNNING"
        state.running_sop_id = sop_id
        state.running_sop_name = sop_name
        state.standard_id = sop_id
        state.active_sop_json = active_sop_json
        state.updated_at = dt.datetime.now(dt.timezone.utc)
        db.commit()

    print(f"🔥 [{device_id}] Started SOP: {sop_id} ({sop_name})")
    return {"status": "success", "message": f"{device_id} 已啟動 {sop_name}"}


# ============================================================
# SOP 執行紀錄（原 sop_execution.py）
# ============================================================


class StepRecordSchema(BaseModel):
    step_id: int
    completed: bool
    parameters: Optional[Dict[str, Any]] = None
    photos: Optional[List[str]] = None


class ExecutionCreate(BaseModel):
    sop_id: str
    steps: List[StepRecordSchema]


class ExecutionResponse(BaseModel):
    id: int
    sop_id: str
    created_at: datetime
    steps: List[StepRecordSchema]


@execution_router.post("/", response_model=ExecutionResponse)
def create_execution(data: ExecutionCreate):
    db = SessionLocal()
    try:
        execution = SopExecution(sop_id=data.sop_id)
        db.add(execution)
        db.commit()
        db.refresh(execution)

        steps_response = []
        for step in data.steps:
            record = StepRecord(
                execution_id=execution.id,
                step_id=step.step_id,
                completed=1 if step.completed else 0,
                parameters=json.dumps(step.parameters, ensure_ascii=False)
                if step.parameters
                else None,
                photos=json.dumps(step.photos, ensure_ascii=False)
                if step.photos
                else None,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            steps_response.append(
                StepRecordSchema(
                    step_id=record.step_id,
                    completed=bool(record.completed),
                    parameters=json.loads(record.parameters)
                    if record.parameters
                    else None,
                    photos=json.loads(record.photos) if record.photos else None,
                )
            )

        return ExecutionResponse(
            id=execution.id,
            sop_id=execution.sop_id,
            created_at=execution.created_at,
            steps=steps_response,
        )
    finally:
        db.close()


@execution_router.get("/{execution_id}", response_model=ExecutionResponse)
def get_execution(execution_id: int):
    db = SessionLocal()
    try:
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
                completed=bool(r.completed),
                parameters=json.loads(r.parameters) if r.parameters else None,
                photos=json.loads(r.photos) if r.photos else None,
            )
            for r in records
        ]
        return ExecutionResponse(
            id=execution.id,
            sop_id=execution.sop_id,
            created_at=execution.created_at,
            steps=steps,
        )
    finally:
        db.close()
