# SOP 模組：提供標準樹與 SOP 列表、啟動 SOP 測試、取得 SOP 執行紀錄等功能

import asyncio
import json
import datetime
import logging
import os
import shutil
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Body, Request, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Callable
from .models import (
    SessionLocal, SopTemplate, SopExecution, StepRecord,
    User, Schedule, ScheduleStatus, DeviceBlockedPeriod,
)
from .standards import STANDARDS_AND_SOPS, get_standard_tree
from .constants import DEVICE_IDS
from .schedule_service import (
    ScheduleStartActor,
    running_schedule_for_device,
    start_schedule as start_schedule_service,
)
from .schedule_api import schedule_start_http_error
from .utils import _now_utc, _now_utc_naive, _to_naive_utc, _parse_conditions
from . import device_state
from .auth import require_admin, current_user
from .line import push_message

logger = logging.getLogger("sop")

PHOTO_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads", "photos")
os.makedirs(PHOTO_UPLOAD_DIR, exist_ok=True)

# 導出 API 路由器
router = APIRouter()
execution_router = APIRouter(prefix="/api/sop-executions", tags=["sop"])


def _validate_start_sop_input(payload: dict, cache: dict) -> tuple:
    """sop_id / device_id / 設備存在性驗證，回傳 (sop_id, device_id, device)"""
    sop_id: str = payload.get("sop_id", "")
    device_id: str = payload.get("device_id", DEVICE_IDS[0])

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
                    "humi_tolerance": test_data.get("humi_tolerance", 3.0),
                    "steps": test_data.get("steps", []),
                }
    return result


# B5 fix: 移除 list_sops 廢棄端點，前端完全不呼叫


def _create_execution_id_db(
    db, sop_id: str, device_id: str, operator: str, now: datetime.datetime,
    operator_user_id: Optional[int] = None,
    schedule_id: Optional[int] = None,
) -> Optional[int]:
    """在 DeviceStateManager.start 的同一 transaction 建 SopExecution。

    ad-hoc start_sop 與排程 start_schedule 共用——兩條路徑的建立語意必須一致。
    sync DB I/O 與 commit 都由 DeviceStateManager.start 在 worker thread 內處理。

    schedule_id 讓報告印得出受測樣品與案號；臨時測試沒有排程，維持 None。
    """
    execution = SopExecution(
        sop_id=sop_id,
        device_id=device_id,
        operator=operator,
        operator_user_id=operator_user_id,
        test_started_at=now,
        schedule_id=schedule_id,
    )
    db.add(execution)
    db.flush()
    return execution.id


def _find_origin_schedule_id_db(
    db, device_id: Optional[str], test_started_at: Optional[datetime.datetime],
) -> Optional[int]:
    """一次測試會留下兩列：測試開始時建一列，SOP 頁面存紀錄時再建一列。
    報告兩列都印得到，所以第二列也要知道自己屬於哪個案件。

    做法是用「同一台設備 + 同一個開始時刻」認回開始那列，直接繼承它的 schedule_id。
    不用「這台設備現在正在跑哪張排程」反推：那是代理指標，舊測試存檔前若同台機器
    已經開始下一張排程，會接到別人的樣品——印錯樣品比留白更糟。認不回來就回 None，
    報告據此印「無對應案件」，失敗方向永遠是留白。
    """
    if not device_id or test_started_at is None:
        return None
    origin = (
        db.query(SopExecution)
        .filter(
            SopExecution.device_id == device_id,
            SopExecution.test_started_at == test_started_at,
        )
        .order_by(SopExecution.id.asc())
        .first()
    )
    return origin.schedule_id if origin else None


async def _start_device_sop(
    states: device_state.DeviceStateManager,
    device_id: str,
    sop_id: str,
    sop_name: str,
    std_data: dict,
    operator: str,
    operator_user_id: int | None,
    before_commit: Callable[[Any, Any], None] | None = None,
    schedule_id: int | None = None,
) -> device_state.TransitionResult:
    started_at = _now_utc()
    # 同一個開始時刻，兩種表示：cache 留 aware（API／排程用），DB 欄位存 naive。
    # 刻意共用同一個瞬間而不各自呼叫 now()——測試結束後存的那列要靠這個時間戳認回
    # 這一列來繼承案件（見 _find_origin_schedule_id_db），差幾微秒就認不回來了。
    execution_started_at = started_at.replace(tzinfo=None)
    active_sop_json = json.dumps(
        {**std_data, "sop_id": sop_id, "name": sop_name},
        ensure_ascii=False,
    )
    return await states.start(
        device_id,
        sop_id=sop_id,
        sop_name=sop_name,
        active_sop_json=active_sop_json,
        total_steps=len(std_data.get("steps", [])),
        operator=operator,
        operator_user_id=operator_user_id,
        started_at=started_at,
        create_execution=lambda db: _create_execution_id_db(
            db,
            sop_id,
            device_id,
            operator,
            execution_started_at,
            operator_user_id,
            schedule_id,
        ),
        before_commit=before_commit,
    )


# 啟動 SOP 路由
@router.post("/start")
async def start_sop(request: Request, payload: Dict[str, Any] = Body(...), _: None = Depends(require_admin)):
    """啟動指定設備的 SOP 測試（admin 才可操作）"""

    operator: str = payload.get("operator", "")
    user = current_user(request)
    operator_user_id = user.user_id

    states = request.app.state.DEVICE_STATE
    sop_id, device_id, _device = _validate_start_sop_input(payload, states)

    std_data = STANDARDS_AND_SOPS.get(sop_id, {})
    sop_name = std_data.get("name", sop_id)
    # 法規表查不到名稱時才需要回頭查 SOP 範本表
    need_template_name = sop_name == sop_id

    def _load_start_context() -> dict:
        """啟動前一次查完：進行中排程、吻合的到期排程、操作者、範本與維護時段。

        手動 ad-hoc SOP 只能認領「已到開始時間且目前條件相同」的排程；
        未來或條件不同的排程必須保持已確認，不能被這次操作提早啟動。
        """
        with SessionLocal() as db:
            now = _now_utc_naive()
            running = running_schedule_for_device(db, device_id)
            running_info = None
            if running:
                running_info = {
                    "conditions": running.conditions,
                    "current_condition_index": running.current_condition_index,
                }

            matching_schedule_id = None
            confirmed = (
                db.query(
                    Schedule.id,
                    Schedule.conditions,
                    Schedule.current_condition_index,
                )
                .filter(
                    Schedule.device_id == device_id,
                    Schedule.status == ScheduleStatus.CONFIRMED,
                    Schedule.start_time <= now,
                )
                .order_by(Schedule.start_time.asc(), Schedule.id.asc())
            )
            for candidate_id, candidate_conditions, current_index in confirmed:
                conditions = _parse_conditions(candidate_conditions)
                index = current_index or 0
                if (
                    isinstance(conditions, list)
                    and 0 <= index < len(conditions)
                    and conditions[index] == sop_id
                ):
                    matching_schedule_id = candidate_id
                    break

            display_name = None
            if not operator and operator_user_id:
                u = db.query(User).filter(User.id == operator_user_id).first()
                display_name = (u.display_name or "") if u else None

            template_name = None
            if need_template_name:
                tpl = db.query(SopTemplate).filter(SopTemplate.sop_id == sop_id).first()
                template_name = tpl.name if tpl else None

            blocked = db.query(DeviceBlockedPeriod).filter(
                DeviceBlockedPeriod.device_id == device_id,
                DeviceBlockedPeriod.start_time <= now,
                DeviceBlockedPeriod.end_time > now,
            ).first()

            return {
                "running": running_info,
                "matching_schedule_id": matching_schedule_id,
                "display_name": display_name,
                "template_name": template_name,
                "blocked_reason": (blocked.reason or "已設定封鎖") if blocked else None,
            }

    ctx = await asyncio.to_thread(_load_start_context)

    # 檢查設備是否有排程進行中（IDLE 條件間隙仍不允許手動啟動）
    if ctx["running"]:
        total = len(_parse_conditions(ctx["running"]["conditions"]))
        idx = (ctx["running"]["current_condition_index"] or 0) + 1
        raise HTTPException(
            status_code=409,
            detail=f"{device_id} 正在執行排程（第 {idx}/{total} 條件），請透過排程頁面操作"
        )

    # 若前端未填 operator，從登入帳號自動帶入顯示名稱
    if ctx["display_name"]:
        operator = ctx["display_name"]
    if ctx["template_name"]:
        sop_name = ctx["template_name"]

    operator = operator.strip() if operator else ""
    if ctx["matching_schedule_id"] is not None:
        schedule_result = await start_schedule_service(
            ctx["matching_schedule_id"],
            ScheduleStartActor(
                actor=str(operator_user_id or "unknown"),
                role=user.role,
                action="START",
                operator=operator or user.username or "管理員",
                operator_user_id=operator_user_id,
            ),
            states,
        )
        if not schedule_result.started:
            raise schedule_start_http_error(schedule_result)
        logger.info(
            "[%s] 透過排程 #%s 啟動 SOP: %s",
            device_id,
            ctx["matching_schedule_id"],
            sop_id,
        )
        return {"status": "success", "message": f"{device_id} 已啟動 {sop_name}"}

    if ctx["blocked_reason"] is not None:
        raise HTTPException(
            status_code=409,
            detail=f"{device_id} 目前在不可用時段（{ctx['blocked_reason']}），無法啟動測試。"
        )

    result = await _start_device_sop(
        states,
        device_id,
        sop_id,
        sop_name,
        std_data,
        operator,
        operator_user_id,
    )
    if result.reason == "invalid_status":
        raise HTTPException(
            status_code=400,
            detail=f"{device_id} 非待機狀態（目前：{result.before.get('status')}），請先停止現有測試。",
        )
    if result.reason == "execution_failed":
        logger.error(f"[{device_id}] 建立執行紀錄失敗，設備維持待機")
        raise HTTPException(status_code=500, detail=f"{device_id} 啟動失敗：無法建立執行紀錄，請稍後再試")
    if not result.changed:
        raise HTTPException(status_code=404, detail=f"設備 {device_id} 不存在")

    logger.info(f"[{device_id}] Started SOP: {sop_id} ({sop_name}) by {operator or '未填寫'}")

    return {"status": "success", "message": f"{device_id} 已啟動 {sop_name}"}


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
    manual_mode: bool = False
    steps: List[StepRecordSchema]


class ExecutionResponse(BaseModel):
    id: int
    sop_id: str
    device_id: Optional[str] = None
    operator: Optional[str] = None
    created_at: datetime.datetime
    test_started_at: Optional[datetime.datetime] = None
    test_ended_at: Optional[datetime.datetime] = None
    steps: List[StepRecordSchema]


@execution_router.post("/", response_model=ExecutionResponse)
def create_execution(
    data: ExecutionCreate, request: Request,
    background_tasks: BackgroundTasks, _: None = Depends(require_admin),
):
    operator_user_id = current_user(request).user_id
    with SessionLocal() as db:
        test_started_at = _to_naive_utc(data.test_started_at)
        execution = SopExecution(
            sop_id=data.sop_id,
            device_id=data.device_id,
            operator=data.operator,
            operator_user_id=operator_user_id,
            test_started_at=test_started_at,
            test_ended_at=_to_naive_utc(data.test_ended_at),
            schedule_id=_find_origin_schedule_id_db(db, data.device_id, test_started_at),
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
        # 有排程時，完成通知由人員在排程頁面確認後從 schedules.py 發；這裡只管無排程的臨時測試
        # 手動模式（除錯）完全不推播，避免消耗 LINE 200/月額度
        has_schedule = db.query(Schedule).filter(
            Schedule.device_id == data.device_id,
            Schedule.status.in_([ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]),
        ).first() is not None
        if not has_schedule and not data.manual_mode:
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
            test_started_at=execution.test_started_at,
            test_ended_at=execution.test_ended_at,
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
            test_started_at=execution.test_started_at,
            test_ended_at=execution.test_ended_at,
            steps=steps,
        )


@execution_router.post("/{execution_id}/photos")
def upload_execution_photo(
    execution_id: int,
    photo_type: str = Form(...),  # "before" | "after"
    file: UploadFile = File(...),
    _: None = Depends(require_admin),
):
    """補充照片：上架時照片（before）或測試結束照（after）"""
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
