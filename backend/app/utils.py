# backend/app/utils.py

import datetime
import json
from typing import Optional
from .constants import AMBIENT_TEMP
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
    手動 start_sop 與排程 start_schedule 共用同一份判斷，維持
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


def curve_total_minutes(
    ramp_rate: float,
    dwell_min: float,
    cycles: int,
    high_temp: float,
    low_temp: Optional[float],
    ambient: float = AMBIENT_TEMP,
) -> float:
    """一條溫度曲線實際跑完的分鐘數（不含測試後的常溫穩定緩衝）。

    「甘特／自動排程的預估」「設備卡 estimated_end」「排程 running_until」以前各抄一份
    這段分支，連「單溫恆溫要不要乘 cycles」兩份答案都不同。收成這一支唯一來源後，預估與
    模擬器實際推進讀同一份、不可能再分岔。單溫恆溫（high≈low，不分冷熱，或只有單一設定點）
    一律升到設定點、dwell 一次、回常溫——cycles 只對雙溫循環有意義，這也是 simulator 實際
    跑的行為。
    """
    if ramp_rate <= 0:
        ramp_rate = 1.0
    if low_temp is not None and abs(high_temp - low_temp) <= 0.1:
        # 單溫恆溫（冷或熱）：升到設定點、dwell 一次、回常溫，cycles 不適用
        r = abs(low_temp - ambient) / ramp_rate
        return r + dwell_min + r
    if low_temp is not None and low_temp < ambient:
        r_lo = abs(ambient - low_temp) / ramp_rate
        r_hl = abs(high_temp - low_temp) / ramp_rate
        return r_lo + (r_hl + dwell_min) * 2 * cycles + r_lo
    if low_temp is not None:
        r_up = abs(high_temp - ambient) / ramp_rate
        r_hl = abs(high_temp - low_temp) / ramp_rate
        r_dn = abs(low_temp - ambient) / ramp_rate
        return r_up + (dwell_min * 2 + r_hl * 2) * (cycles - 1) + (dwell_min * 2 + r_hl) + r_dn
    r_up = abs(high_temp - ambient) / ramp_rate
    return r_up + dwell_min + r_up


def total_pause_seconds(item: dict, now: datetime.datetime) -> float:
    """設備目前累計的暫停秒數：已結算的 pause_accum + 若此刻仍在暫停則加上尚未結算的這段。

    估算「測試何時結束／設備何時空出來」要把暫停時間加回去，否則暫停多久、下一筆排程就會
    早排多久、撞在暫停中的測試頭上。now 需為 aware UTC；估算與模擬器凍結進度的行為一致。
    """
    seconds = float(item.get("pause_accum_seconds") or 0.0)
    if item.get("status") == "PAUSED":
        paused_at = item.get("paused_at")
        if paused_at is not None:
            if isinstance(paused_at, str):
                paused_at = parse_iso_utc(paused_at)
            if paused_at.tzinfo is None:
                paused_at = paused_at.replace(tzinfo=datetime.timezone.utc)
            seconds += max(0.0, (now - paused_at).total_seconds())
    return seconds


def today_utc_window() -> tuple:
    """回傳 (now, today_start, today_end) — 三者皆為 naive UTC datetime"""
    now = _now_utc_naive()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    return now, today_start, today_end
