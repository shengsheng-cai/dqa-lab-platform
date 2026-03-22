# backend/app/utils.py

import datetime
from .models import SessionLocal, DeviceState


def _now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _save_device_state(device_id: str, item: dict):
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
        state.updated_at = _now_utc()

        # ✅ 補上 started_at — 修復重啟後圖表與倒數計時失效的問題
        started_at = item.get("started_at")
        if started_at is not None:
            if isinstance(started_at, str):
                started_at = datetime.datetime.fromisoformat(
                    started_at.replace("Z", "+00:00")
                )
            # 存入 DB 前去掉 tzinfo（SQLite 不支援 aware datetime）
            state.started_at = started_at.replace(tzinfo=None)
        else:
            state.started_at = None

        db.commit()
