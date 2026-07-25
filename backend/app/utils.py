# backend/app/utils.py

import datetime
import json
from typing import Optional
from .models import SessionLocal, DeviceBlockedPeriod


def _parse_conditions(conditions_str: Optional[str]) -> list:
    """安全 parse schedule.conditions JSON 字串，失敗回傳空 list。"""
    try:
        return json.loads(conditions_str) if conditions_str else []
    except Exception:
        return []


def parse_iso_utc(s: str) -> datetime.datetime:
    """將 ISO 8601 字串解析為 UTC-aware datetime。
    接受帶 Z 結尾（替換為 +00:00）或已含 +HH:MM offset 的字串。"""
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _now_utc_naive() -> datetime.datetime:
    """回傳 naive UTC datetime，用於與 SQLite 儲存的 naive datetime 比較。"""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def device_blocked_reason_now(device_id: str) -> Optional[str]:
    """設備當下是否落在不可用（維護）時段；是則回傳原因字串，否則 None。

    「有沒有封鎖」只看時段是否存在——reason 可為空（欄位 nullable、建立時可不填），
    不能拿它當有無封鎖的判準，否則沒填原因的維護時段會被當成沒封鎖而放行。
    手動 start_sop 與自動 try_start_schedule 共用同一份判斷，維持
    「手動、自動一致尊重維護時段」。
    """
    now = _now_utc_naive()
    with SessionLocal() as db:
        blocked = db.query(DeviceBlockedPeriod).filter(
            DeviceBlockedPeriod.device_id == device_id,
            DeviceBlockedPeriod.start_time <= now,
            DeviceBlockedPeriod.end_time > now,
        ).first()
        if blocked is None:
            return None
        return blocked.reason or "已設定封鎖"


def _to_naive_utc(dt: Optional[datetime.datetime | str]) -> Optional[datetime.datetime]:
    """將任意 datetime（aware/naive/ISO str）統一轉為 naive UTC，None 原樣回傳。"""
    if dt is None:
        return None
    if isinstance(dt, str):
        dt = parse_iso_utc(dt)
    if dt.tzinfo is not None:
        return dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return dt


def today_utc_window() -> tuple:
    """回傳 (now, today_start, today_end) — 三者皆為 naive UTC datetime"""
    now = _now_utc_naive()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    return now, today_start, today_end
