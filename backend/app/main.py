import asyncio
import datetime
import json
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from .sop import router as sop_router, execution_router, DEVICE_IDS
from .reports import router as reports_router
from .errors import router as errors_router
from .ai import router as ai_router, _warmup_ollama
from .models import SessionLocal, DeviceData, ErrorLog, DeviceState
from .standards import get_ramp_rate, get_standard

background_tasks = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .models import init_db

    init_db()

    with SessionLocal() as db:
        saved_states = {s.device_id: s for s in db.query(DeviceState).all()}

    cache = {}
    for device_id in DEVICE_IDS:
        s = saved_states.get(device_id)
        if s:
            # fix: started_at 統一轉為 UTC aware datetime，避免後續型別不一致
            started_at = s.started_at
            if started_at is not None and started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=datetime.timezone.utc)

            cache[device_id] = {
                "temperature": s.temperature,
                "humidity": s.humidity,
                "status": s.status,
                "running_sop_name": s.running_sop_name or "STANDBY",
                "running_sop_id": s.running_sop_id,
                "standard_id": s.standard_id,
                "active_sop_json": s.active_sop_json,
                "completed_steps": s.completed_steps or 0,
                "started_at": started_at,
            }
            print(f"🔄 [{device_id}] 恢復狀態：{s.status}，溫度：{s.temperature}°C")
        else:
            cache[device_id] = {
                "temperature": round(25.0 + random.uniform(-1.0, 1.0), 2),
                "humidity": round(55.0 + random.uniform(-2.0, 2.0), 1),
                "status": "IDLE",
                "running_sop_name": "STANDBY",
                "running_sop_id": None,
                "standard_id": None,
                "active_sop_json": None,
                "completed_steps": 0,
                "started_at": None,
            }

    app.state.AICM_CACHE = cache

    sim_task = asyncio.create_task(data_simulator())
    background_tasks.add(sim_task)
    sim_task.add_done_callback(background_tasks.discard)
    print(f"✅ System initialized with {len(DEVICE_IDS)} devices: {DEVICE_IDS}")

    await _warmup_ollama()

    yield


app = FastAPI(title="KSON AICM Digital Twin Server", lifespan=lifespan)

app.include_router(sop_router, prefix="/api/sop", tags=["sop"])
app.include_router(execution_router)
app.include_router(reports_router)
app.include_router(errors_router)
app.include_router(ai_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 工具函式
# ============================================================


def _now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _save_device_state(device_id: str, item: dict):
    """將目前設備狀態寫回 DB，供重啟後恢復使用"""
    with SessionLocal() as db:
        state = db.get(DeviceState, device_id)
        if state is None:
            state = DeviceState(device_id=device_id)
            db.add(state)
        state.status = item.get("status", "IDLE")
        state.temperature = item.get("temperature", 25.0)
        state.humidity = item.get("humidity", 55.0)
        state.running_sop_id = item.get("running_sop_id")
        state.running_sop_name = item.get("running_sop_name")
        state.standard_id = item.get("standard_id")
        state.active_sop_json = item.get("active_sop_json")
        state.completed_steps = item.get("completed_steps", 0)
        state.started_at = item.get("started_at")
        state.updated_at = _now_utc()
        db.commit()


def _get_device(device_id: str) -> dict:
    device = app.state.AICM_CACHE.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"設備 {device_id} 不存在")
    return device


def _make_description(status: str, sop_name: str) -> str:
    return {
        "RUNNING": f"正在執行：{sop_name}。溫度按標準速率變化。",
        "PAUSED": f"已暫停：{sop_name}。點擊暫停切換可繼續。",
        "EMERGENCY": "⚠️ 緊急停止已觸發，請確認設備安全後按正常停止。",
        "FINISHING": "測試已結束，正在自動降溫到 25°C，請稍候...",
        "IDLE": "系統待機中，請選擇 SOP 後點擊啟動。",
    }.get(status, "等待連線...")


def _calc_estimated_end_at(item: dict) -> Optional[str]:
    status = item.get("status")
    if status not in ("RUNNING", "PAUSED"):
        return None

    started_at = item.get("started_at")
    active_sop_json = item.get("active_sop_json")
    if not started_at or not active_sop_json:
        return None

    try:
        sop = json.loads(active_sop_json)
    except Exception:
        return None

    ramp_rate = sop.get("ramp_rate") or 1.0
    dwell_hours = sop.get("dwell_time_hours") or 0.0
    dwell_min = dwell_hours * 60.0
    cycles = sop.get("cycles") or 1

    high_temp = sop.get("high_temperature") or sop.get("target_temperature") or 25.0
    low_temp = sop.get("low_temperature")
    ambient = 25.0

    # fix: 低溫測試從 ambient 先降至 low_temp，再升至 high_temp
    if low_temp is not None:
        if low_temp < ambient:
            # 低溫測試：ambient → low → high → dwell → low → ... → ambient
            ramp_to_low_min = abs(ambient - low_temp) / ramp_rate
            ramp_low_to_high_min = abs(high_temp - low_temp) / ramp_rate
            one_cycle_min = (
                ramp_low_to_high_min + dwell_min + ramp_low_to_high_min + dwell_min
            )
            total_min = (
                ramp_to_low_min
                + one_cycle_min * cycles
                + abs(low_temp - ambient) / ramp_rate
            )
        else:
            # 雙溫段循環（low_temp >= ambient）
            ramp_up_min = abs(high_temp - ambient) / ramp_rate
            ramp_down_min = abs(high_temp - low_temp) / ramp_rate
            ramp_back_min = abs(low_temp - ambient) / ramp_rate
            one_cycle_min = ramp_up_min + dwell_min + ramp_down_min + dwell_min
            total_min = one_cycle_min * cycles + ramp_back_min
    else:
        ramp_up_min = abs(high_temp - ambient) / ramp_rate
        ramp_down_min = abs(high_temp - ambient) / ramp_rate
        total_min = ramp_up_min + dwell_min + ramp_down_min

    total_seconds = total_min * 60.0

    if isinstance(started_at, str):
        started_dt = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    else:
        started_dt = started_at
    if started_dt.tzinfo is None:
        started_dt = started_dt.replace(tzinfo=datetime.timezone.utc)

    estimated_end = started_dt + datetime.timedelta(seconds=total_seconds)
    return estimated_end.isoformat()


# ============================================================
# 設備狀態 API
# ============================================================


@app.get("/api/devices")
async def get_all_devices():
    now = _now_utc().strftime("%H:%M:%S")
    return [
        {
            "device_id": device_id,
            "status": item.get("status", "OFFLINE"),
            "temperature": item.get("temperature", 0.0),
            "humidity": item.get("humidity", 0.0),
            "running_sop_name": item.get("running_sop_name", "STANDBY"),
            "description": _make_description(
                item.get("status", "OFFLINE"), item.get("running_sop_name", "")
            ),
            "timestamp": now,
            "active_sop_json": item.get("active_sop_json"),
            "completed_steps": item.get("completed_steps", 0),
            "total_steps": item.get("total_steps", 0),
            "started_at": item.get("started_at").isoformat()
            if item.get("started_at")
            else None,
            "estimated_end_at": _calc_estimated_end_at(item),
        }
        for device_id, item in app.state.AICM_CACHE.items()
    ]


@app.get("/api/devices/{device_id}/history")
async def get_device_history(device_id: str):
    device = app.state.AICM_CACHE.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"設備 {device_id} 不存在")

    started_at = device.get("started_at")
    if not started_at:
        return []

    # fix: 統一轉為 UTC naive datetime 再與 DB 比對，避免時區偏移
    if isinstance(started_at, str):
        started_dt = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    else:
        started_dt = started_at

    # 轉為 naive UTC（DB 存的是 naive UTC）
    if started_dt.tzinfo is not None:
        started_dt = started_dt.replace(tzinfo=None)

    with SessionLocal() as db:
        rows = (
            db.query(DeviceData)
            .filter(
                DeviceData.device_id == device_id,
                DeviceData.timestamp >= started_dt,
            )
            .order_by(DeviceData.timestamp.asc())
            .all()
        )

    if not rows:
        return []

    buckets: dict = {}
    for row in rows:
        minute_key = row.timestamp.strftime("%Y-%m-%d %H:%M")
        if minute_key not in buckets:
            buckets[minute_key] = {"temps": [], "humis": []}
        if row.temperature is not None:
            buckets[minute_key]["temps"].append(row.temperature)
        if row.humidity is not None:
            buckets[minute_key]["humis"].append(row.humidity)

    result = []
    for minute_key, data in sorted(buckets.items()):
        avg_temp = (
            round(sum(data["temps"]) / len(data["temps"]), 2) if data["temps"] else None
        )
        avg_humi = (
            round(sum(data["humis"]) / len(data["humis"]), 2) if data["humis"] else None
        )
        result.append(
            {
                "time": minute_key[11:],
                "full_time": minute_key,
                "temperature": avg_temp,
                "humidity": avg_humi,
            }
        )

    return result


@app.get("/api/latest")
async def get_latest():
    cache = app.state.AICM_CACHE
    if not cache or "KSON_CH01" not in cache:
        return {
            "status": "OFFLINE",
            "temperature": 0.0,
            "humidity": 0.0,
            "running_sop_name": "未連線",
            "description": "等待模擬器啟動...",
            "timestamp": _now_utc().strftime("%H:%M:%S"),
        }
    data = cache["KSON_CH01"]
    status = data.get("status", "OFFLINE")
    return {
        "status": status,
        "temperature": data.get("temperature", 0.0),
        "humidity": data.get("humidity", 0.0),
        "running_sop_name": data.get("running_sop_name", "STANDBY"),
        "description": _make_description(status, data.get("running_sop_name", "")),
        "timestamp": _now_utc().strftime("%H:%M:%S"),
    }


# ============================================================
# 各設備獨立控制 API
# ============================================================


@app.post("/api/stop/{device_id}/emergency")
async def emergency_stop(device_id: str):
    device = _get_device(device_id)
    with SessionLocal() as db:
        db.add(
            ErrorLog(
                device_id=device_id,
                error_type="EMERGENCY",
                sop_id=device.get("running_sop_id"),
                sop_name=device.get("running_sop_name"),
                temperature=device.get("temperature"),
                humidity=device.get("humidity"),
                note="操作人員觸發緊急停止",
                created_at=_now_utc(),
            )
        )
        db.commit()

    device.update(
        {
            "status": "EMERGENCY",
            "running_sop_id": None,
            "running_sop_name": "🚨 緊急停止中 - 待確認安全",
            "active_sop_json": None,
            "completed_steps": 0,
            "started_at": None,
            "total_steps": 0,
        }
    )
    _save_device_state(device_id, device)
    print(f"🚨 [{device_id}] EMERGENCY STOP")
    return {"status": "success", "message": f"{device_id} 緊急停止已觸發"}


class ProgressPayload(BaseModel):
    completed: int = 0


@app.post("/api/devices/{device_id}/progress")
async def update_progress(device_id: str, payload: ProgressPayload):
    device = _get_device(device_id)
    device["completed_steps"] = payload.completed
    _save_device_state(device_id, device)
    return {"status": "success", "completed_steps": payload.completed}


@app.post("/api/stop/{device_id}/pause")
async def pause_test(device_id: str):
    device = _get_device(device_id)
    if device["status"] == "RUNNING":
        device["status"] = "PAUSED"
    elif device["status"] == "PAUSED":
        device["status"] = "RUNNING"
    _save_device_state(device_id, device)
    return {"status": "success"}


@app.post("/api/stop/{device_id}/normal")
async def normal_stop(device_id: str):
    device = _get_device(device_id)
    device.update(
        {
            "status": "FINISHING",
            "running_sop_name": "系統自動降溫收尾中...",
            "active_sop_json": None,
            "completed_steps": 0,
            "started_at": None,
        }
    )
    _save_device_state(device_id, device)
    return {"status": "success"}


# ============================================================
# 物理模擬引擎
# ============================================================


async def data_simulator():
    """物理模擬器 — 5 台各自獨立運作，每 10 秒寫一次資料庫"""
    write_counters: dict = {}

    while True:
        cache = app.state.AICM_CACHE
        now = _now_utc()

        for device_id, item in cache.items():
            status = item.get("status", "OFFLINE")
            current_temp = item.get("temperature", 25.0)

            if device_id not in write_counters:
                write_counters[device_id] = 0

            if status == "RUNNING":
                standard_id = item.get("standard_id", "IEC60068_CYCLE")
                max_ramp_rate = get_ramp_rate(standard_id)
                standard = get_standard(standard_id)
                target_temp = 25.0
                if standard:
                    target_temp = standard.get("high_temperature") or standard.get(
                        "target_temperature", 25.0
                    )

                temp_diff = target_temp - current_temp
                if abs(temp_diff) > 0.1:
                    max_change = max_ramp_rate / 60.0
                    actual_change = min(abs(temp_diff), max_change)
                    new_temp = current_temp + (
                        actual_change if temp_diff > 0 else -actual_change
                    )
                else:
                    new_temp = current_temp
                item["temperature"] = round(new_temp + random.uniform(-0.1, 0.1), 2)

            elif status == "FINISHING":
                diff = 25.0 - current_temp
                if abs(diff) > 0.5:
                    item["temperature"] = round(
                        current_temp + (0.4 if diff > 0 else -0.4), 2
                    )
                else:
                    item["temperature"] = 25.0
                    item.update(
                        {
                            "status": "IDLE",
                            "running_sop_name": "STANDBY",
                            "running_sop_id": None,
                            "standard_id": None,
                        }
                    )
                    _save_device_state(device_id, item)
                    print(f"✅ [{device_id}] 降溫完成，回待機。")

            elif status == "EMERGENCY":
                item["temperature"] = round(
                    current_temp + random.uniform(-0.05, 0.05), 2
                )

            # fix: PAUSED 狀態不累積 write_counters，不寫 DB，避免浪費 IO
            if status in ["RUNNING", "FINISHING", "EMERGENCY"]:
                write_counters[device_id] += 1
                if write_counters[device_id] >= 10:
                    try:
                        with SessionLocal() as db:
                            db.add(
                                DeviceData(
                                    device_id=device_id,
                                    temperature=item["temperature"],
                                    humidity=item.get("humidity", 55.0),
                                    timestamp=now,
                                )
                            )
                            db.commit()
                        _save_device_state(device_id, item)
                    except Exception as e:
                        print(f"[{device_id}] DB write error: {e}")
                    write_counters[device_id] = 0
            else:
                write_counters[device_id] = 0

        await asyncio.sleep(1)
