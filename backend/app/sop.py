from fastapi import APIRouter, HTTPException, Body, Request
from pydantic import BaseModel
from typing import List, Optional
import json
from .models import SessionLocal, SopTemplate

router = APIRouter(tags=["sop"])

class SopResponse(BaseModel):
    sop_id: str
    name: str
    test_type: str
    version: str
    steps: List[dict]

@router.get("", response_model=List[SopResponse])
def list_sops():
    db = SessionLocal()
    try:
        sops = db.query(SopTemplate).all()
        return [SopResponse(sop_id=s.sop_id, name=s.name, test_type=s.test_type, version=s.version, steps=json.loads(s.steps_json)) for s in sops]
    finally:
        db.close()

@router.post("/start")
async def start_sop(request: Request, payload: dict = Body(...)):
    sop_id = payload.get("sop_id")
    cache = request.app.state.AICM_CACHE
    device_key = "KSON_CH01"

    # --- 關鍵安全檢查：如果已經在跑，不准重複啟動 ---
    if device_key in cache and cache[device_key].get("status") == "RUNNING":
        raise HTTPException(status_code=400, detail="機台正在執行中，請先停止目前程序。")

    # 初始化快取結構 (如果不存在)
    if device_key not in cache:
        cache[device_key] = {"temperature": 25.0, "humidity": 55.0}
    
    # 寫入狀態與運行的 SOP ID
    cache[device_key]["status"] = "RUNNING"
    cache[device_key]["running_sop_id"] = sop_id
    
    print(f"🔥 [安全指令] 啟動 SOP: {sop_id}")
    return {"status": "success", "message": f"SOP {sop_id} 已啟動"}