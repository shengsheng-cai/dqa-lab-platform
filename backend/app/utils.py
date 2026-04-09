# backend/app/utils.py

import datetime
import json
from typing import Optional
from .models import SessionLocal, DeviceState


def _parse_conditions(conditions_str: Optional[str]) -> list:
    """安全 parse schedule.conditions JSON 字串，失敗回傳空 list。"""
    try:
        return json.loads(conditions_str) if conditions_str else []
    except Exception:
        return []


def _now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _now_utc_naive() -> datetime.datetime:
    """回傳 naive UTC datetime，用於與 SQLite 儲存的 naive datetime 比較。"""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def today_utc_window() -> tuple:
    """回傳 (now, today_start, today_end) — 三者皆為 UTC-aware datetime"""
    now = datetime.datetime.now(datetime.timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    return now, today_start, today_end


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

        state.active_execution_id = item.get("active_execution_id")
        state.sim_phase = item.get("sim_phase", "idle")
        state.sim_cycle = item.get("sim_cycle", 0)

        for field in ("dwell_high_start", "dwell_low_start"):
            val = item.get(field)
            if val is not None:
                if isinstance(val, str):
                    val = datetime.datetime.fromisoformat(val.replace("Z", "+00:00"))
                setattr(state, field, val.replace(tzinfo=None))
            else:
                setattr(state, field, None)

        db.commit()
