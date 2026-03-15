# backend/app/utils.py
# 共用工具函式，供 main.py 與 sop.py 共同使用
# 抽離至此避免 sop.py → main.py 的 circular import

import datetime
from .models import SessionLocal, DeviceState


def _now_utc() -> datetime.datetime:
    """統一使用 UTC aware datetime"""
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
