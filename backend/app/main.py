import os
import asyncio
import datetime
import random
import json
from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from .serial_reader import AsyncSerialReader
from .sop import router as sop_router
from .models import SessionLocal, SopTemplate, DeviceData 

app = FastAPI(title="KSON AICM Digital Twin Server")
app.state.AICM_CACHE = {} 
background_tasks = set()

# 修正重複參數問題
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 核心控制接口：強化邏輯描述 ---

@app.post("/api/stop/emergency")
async def emergency_stop():
    """🚨 緊急停止：中斷所有輸出，並提示使用者後續動作"""
    cache = app.state.AICM_CACHE
    for device_id in cache:
        cache[device_id]["status"] = "EMERGENCY" # 改為專門的緊急狀態
        cache[device_id]["running_sop_id"] = None
        cache[device_id]["running_sop_name"] = "🚨 緊急停止中 - 待確認安全"
    
    print("\n" + "!"*60)
    print("🚨 [ALERT] EMERGENCY STOP ACTIVATED.")
    print("📢 [SYSTEM] 設備輸出已中斷，等待操作員確認降溫指令。")
    print("!"*60 + "\n")
    return {"status": "success", "message": "Emergency activated"}

@app.post("/api/stop/pause")
async def pause_test():
    cache = app.state.AICM_CACHE
    for device_id in cache:
        cache[device_id]["status"] = "PAUSED"
    return {"status": "success"}

@app.post("/api/stop/normal")
async def normal_stop():
    """⏹️ 正常停止：自動進入收尾降溫模式"""
    cache = app.state.AICM_CACHE
    for device_id in cache:
        cache[device_id]["status"] = "FINISHING"
        cache[device_id]["running_sop_name"] = "系統自動降溫收尾中..."
    return {"status": "success"}

@app.get("/api/latest")
async def get_latest():
    cache = app.state.AICM_CACHE
    if not cache:
        return {
            "status": "OFFLINE", 
            "temperature": 0.0, 
            "humidity": 0.0, 
            "running_sop_name": "未連線", 
            "description": "等待模擬器啟動...",
            "timestamp": "--:--:--"
        }
    # 回傳第一台設備，並加入 description 欄位供 UI 顯示
    data = list(cache.values())[0]
    
    # 動態產生測試說明文案
    if data["status"] == "RUNNING":
        data["description"] = f"正在執行：{data.get('running_sop_name')}。系統正模擬真實物理升降溫斜率。"
    elif data["status"] == "EMERGENCY":
        data["description"] = "警告！已觸發緊急停止。請確認周遭安全後，點擊「正常停止」以安全回歸常溫模式。"
    elif data["status"] == "FINISHING":
        data["description"] = "測試已結束，目前正在執行自動回常溫流程 (25.0°C)。"
    else:
        data["description"] = "系統目前處於待機狀態，請從右側選擇 SOP 項目後點擊「啟動」。"
        
    return data

# --- 物理模擬引擎 ---

async def data_simulator():
    while True:
        cache = app.state.AICM_CACHE
        db = SessionLocal()
        try:
            for device_id in cache:
                item = cache[device_id]
                status = item.get("status")
                
                if status == "RUNNING":
                    # 模擬升溫邏輯... (略)
                    target_temp = 85.0 if "高溫" in item.get("running_sop_name", "") else -40.0
                    diff = target_temp - item["temperature"]
                    item["temperature"] += (0.8 if diff > 0 else -0.8) + random.uniform(-0.1, 0.1)
                
                elif status == "FINISHING":
                    # 收尾回歸 25 度
                    diff = 25.0 - item["temperature"]
                    if abs(diff) > 0.5:
                        item["temperature"] += (0.4 if diff > 0 else -0.4)
                
                elif status == "EMERGENCY":
                    # 緊急停止時，溫度保持不變 (或根據真實物理緩慢散熱)
                    item["temperature"] += random.uniform(-0.05, 0.05)

                # 數據存檔 (省略重複邏輯，與上一版本相同)
                if status in ["RUNNING", "FINISHING", "PAUSED", "EMERGENCY"]:
                    new_record = DeviceData(
                        device_id=device_id,
                        temperature=round(item["temperature"], 2),
                        humidity=item.get("humidity", 55.0),
                        timestamp=datetime.datetime.now()
                    )
                    db.add(new_record)
                    db.commit()

            await asyncio.sleep(1)
        except Exception as e:
            print(f"Simulator Error: {e}")
            db.rollback()
        finally:
            db.close()

@app.on_event("startup")
async def startup_event():
    sim_task = asyncio.create_task(data_simulator())
    background_tasks.add(sim_task)

app.include_router(sop_router, prefix="/api/sop")