import asyncio
import datetime
import json
import random
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from .sop import router as sop_router, execution_router, DEVICE_IDS
from .reports import router as reports_router
from .errors import router as errors_router
from .models import SessionLocal, DeviceData, ErrorLog, DeviceState
from .standards import get_ramp_rate, get_standard
from sqlalchemy import func

app = FastAPI(title="KSON AICM Digital Twin Server")
app.state.AICM_CACHE = {}
background_tasks = set()

app.include_router(sop_router, prefix="/api/sop", tags=["sop"])
app.include_router(execution_router)
app.include_router(reports_router)
app.include_router(errors_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 工具函式
# ============================================================


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
        state.updated_at = datetime.datetime.now(datetime.timezone.utc)
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


# ============================================================
# 設備狀態 API
# ============================================================


@app.get("/api/devices")
async def get_all_devices():
    """取得所有設備即時狀態"""
    now = datetime.datetime.now().strftime("%H:%M:%S")
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
            "started_at": item.get("started_at").isoformat()
            if item.get("started_at")
            else None,
        }
        for device_id, item in app.state.AICM_CACHE.items()
    ]


@app.get("/api/devices/{device_id}/history")
async def get_device_history(device_id: str):
    """
    取得設備當前測試的完整溫濕度歷史，每分鐘聚合一個平均點。
    - 若設備正在執行測試（有 started_at），從 started_at 開始撈
    - 若已停止或 IDLE，回傳空陣列
    - DB 原始資料（每 10 秒一筆）不受影響，只是查詢時做分鐘聚合
    """
    device = app.state.AICM_CACHE.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"設備 {device_id} 不存在")

    started_at = device.get("started_at")

    # 沒有 started_at 表示沒有進行中的測試，回傳空陣列
    if not started_at:
        return []

    # 統一轉成 naive datetime（去掉時區），避免 SQLite 比對格式不符
    if isinstance(started_at, str):
        started_at_dt = datetime.datetime.fromisoformat(
            started_at.replace("Z", "")
        ).replace(tzinfo=None)
    else:
        started_at_dt = (
            started_at.replace(tzinfo=None) if started_at.tzinfo else started_at
        )

    with SessionLocal() as db:
        rows = (
            db.query(DeviceData)
            .filter(
                DeviceData.device_id == device_id,
                DeviceData.timestamp >= started_at_dt,
            )
            .order_by(DeviceData.timestamp.asc())
            .all()
        )

    if not rows:
        return []

    # 每分鐘聚合：把同一分鐘內的資料取平均
    buckets: dict = {}
    for row in rows:
        # 取到分鐘精度的 key，例如 "2026-03-10 10:32"
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
        # 前端顯示只需要 HH:mm 格式
        display_time = minute_key[11:]  # 取 "HH:MM" 部分
        result.append(
            {
                "time": display_time,
                "full_time": minute_key,  # 供前端縮放用
                "temperature": avg_temp,
                "humidity": avg_humi,
            }
        )

    return result


@app.get("/api/latest")
async def get_latest():
    """取得 KSON_CH01 即時狀態（向後相容）"""
    cache = app.state.AICM_CACHE
    if not cache or "KSON_CH01" not in cache:
        return {
            "status": "OFFLINE",
            "temperature": 0.0,
            "humidity": 0.0,
            "running_sop_name": "未連線",
            "description": "等待模擬器啟動...",
            "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
        }
    data = cache["KSON_CH01"]
    status = data.get("status", "OFFLINE")
    return {
        "status": status,
        "temperature": data.get("temperature", 0.0),
        "humidity": data.get("humidity", 0.0),
        "running_sop_name": data.get("running_sop_name", "STANDBY"),
        "description": _make_description(status, data.get("running_sop_name", "")),
        "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
    }


# ============================================================
# 各設備獨立控制 API
# ============================================================


@app.post("/api/stop/{device_id}/emergency")
async def emergency_stop(device_id: str):
    """🚨 指定設備緊急停止"""
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
                created_at=datetime.datetime.now(),
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
        }
    )
    _save_device_state(device_id, device)
    print(f"🚨 [{device_id}] EMERGENCY STOP")
    return {"status": "success", "message": f"{device_id} 緊急停止已觸發"}


@app.post("/api/devices/{device_id}/progress")
async def update_progress(device_id: str, payload: dict):
    """更新設備目前完成的步驟數"""
    device = _get_device(device_id)
    completed = payload.get("completed", 0)
    device["completed_steps"] = completed
    _save_device_state(device_id, device)
    return {"status": "success", "completed_steps": completed}


@app.post("/api/stop/{device_id}/pause")
async def pause_test(device_id: str):
    """⏸ 指定設備暫停切換"""
    device = _get_device(device_id)
    if device["status"] == "RUNNING":
        device["status"] = "PAUSED"
    elif device["status"] == "PAUSED":
        device["status"] = "RUNNING"
    _save_device_state(device_id, device)
    return {"status": "success"}


@app.post("/api/stop/{device_id}/normal")
async def normal_stop(device_id: str):
    """⏹ 指定設備正常停止"""
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
    write_counters: dict = {}  # 每台設備獨立計數器

    while True:
        cache = app.state.AICM_CACHE
        with SessionLocal() as db:
            try:
                needs_commit = False
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
                            target_temp = standard.get(
                                "high_temperature"
                            ) or standard.get("target_temperature", 25.0)

                        temp_diff = target_temp - current_temp
                        if abs(temp_diff) > 0.1:
                            max_change = max_ramp_rate / 60.0
                            actual_change = min(abs(temp_diff), max_change)
                            new_temp = current_temp + (
                                actual_change if temp_diff > 0 else -actual_change
                            )
                        else:
                            new_temp = current_temp
                        item["temperature"] = round(
                            new_temp + random.uniform(-0.1, 0.1), 2
                        )

                    elif status == "FINISHING":
                        diff = 25.0 - current_temp
                        if abs(diff) > 0.5:
                            item["temperature"] = round(
                                current_temp + (0.4 if diff > 0 else -0.4), 2
                            )
                        else:
                            item["temperature"] = 25.0
                            item["status"] = "IDLE"
                            item["running_sop_name"] = "STANDBY"
                            _save_device_state(device_id, item)
                            print(f"✅ [{device_id}] 降溫完成，回待機。")

                    elif status == "EMERGENCY":
                        item["temperature"] = round(
                            current_temp + random.uniform(-0.05, 0.05), 2
                        )

                    # 每台設備獨立計數，滿 10 秒才寫入
                    if status in ["RUNNING", "FINISHING", "PAUSED", "EMERGENCY"]:
                        write_counters[device_id] += 1
                        if write_counters[device_id] >= 10:
                            db.add(
                                DeviceData(
                                    device_id=device_id,
                                    temperature=item["temperature"],
                                    humidity=item.get("humidity", 55.0),
                                    timestamp=datetime.datetime.now(),
                                )
                            )
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
                            state.updated_at = datetime.datetime.now(
                                datetime.timezone.utc
                            )
                            write_counters[device_id] = 0
                            needs_commit = True
                    else:
                        write_counters[device_id] = 0

                if needs_commit:
                    db.commit()

            except Exception as e:
                print(f"Simulator Error: {e}")
                db.rollback()

        await asyncio.sleep(1)


# ============================================================
# 啟動事件
# ============================================================


@app.on_event("startup")
async def startup_event():
    from .models import init_db

    init_db()

    # 從 DB 讀回上次狀態，若無紀錄則初始化為 IDLE
    with SessionLocal() as db:
        saved_states = {s.device_id: s for s in db.query(DeviceState).all()}

    cache = {}
    for device_id in DEVICE_IDS:
        s = saved_states.get(device_id)
        if s:
            # 恢復上次狀態（RUNNING 恢復為 PAUSED，避免無人監控下自動繼續）
            restored_status = s.status
            cache[device_id] = {
                "temperature": s.temperature,
                "humidity": s.humidity,
                "status": restored_status,
                "running_sop_name": s.running_sop_name or "STANDBY",
                "running_sop_id": s.running_sop_id,
                "standard_id": s.standard_id,
                "active_sop_json": s.active_sop_json,
                "completed_steps": s.completed_steps or 0,
                "started_at": s.started_at,
            }
            print(
                f"🔄 [{device_id}] 恢復狀態：{restored_status}，溫度：{s.temperature}°C"
            )
        else:
            cache[device_id] = {
                "temperature": round(25.0 + random.uniform(-1.0, 1.0), 2),
                "humidity": round(55.0 + random.uniform(-2.0, 2.0), 1),
                "status": "IDLE",
                "running_sop_name": "STANDBY",
                "running_sop_id": None,
                "standard_id": None,
            }

    app.state.AICM_CACHE = cache

    sim_task = asyncio.create_task(data_simulator())
    background_tasks.add(sim_task)
    print(f"✅ System initialized with {len(DEVICE_IDS)} devices: {DEVICE_IDS}")
