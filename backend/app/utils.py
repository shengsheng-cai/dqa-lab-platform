# backend/app/utils.py

import datetime
import json
from typing import Optional
from .constants import AMBIENT_TEMP, STABILIZATION_MINUTES
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


def ramp_rate_from_sop(active_sop_json) -> float:
    """從 active_sop_json 取升降溫速率（°C/min）；取不到或不是正數時退回 1.0。

    模擬器實際降溫與「還要降多久」的估算讀同一份，兩邊不會分岔。緊急停止會把
    active_sop_json 清成 None，這時只能用預設速率估。
    """
    try:
        sop = json.loads(active_sop_json or "{}")
        rate = float(sop.get("ramp_rate") or 1.0)
    except Exception:
        return 1.0
    return rate if rate > 0 else 1.0


def finishing_end(item: dict, now: datetime.datetime) -> datetime.datetime:
    """降溫收尾中的設備何時回到常溫（aware UTC）：從當前溫度按 ramp_rate 降到 25°C。

    FINISHING 不能用 occupied_end——那算的是「整條曲線從頭跑完 + 常溫穩定」，測試中途被停
    時會高估好幾小時。緊急停止後更糟：started_at 與 active_sop_json 已被清空，occupied_end
    直接回 None，排程器會把還在降溫的設備當成現在就有空，新排程排到「現在」卻要等降溫跑完
    才啟動。now 需為 aware UTC。
    """
    raw_temp = item.get("temperature")
    # 不能用 `or AMBIENT_TEMP`：低溫測試的 0°C 是合法讀值，會被誤當成沒有值
    current_temp = AMBIENT_TEMP if raw_temp is None else float(raw_temp)
    ramp_rate = ramp_rate_from_sop(item.get("active_sop_json"))
    return now + datetime.timedelta(minutes=abs(current_temp - AMBIENT_TEMP) / ramp_rate)


def occupied_end(item: dict, now: datetime.datetime) -> Optional[datetime.datetime]:
    """從設備 cache dict 估算「測試占用結束」時間（aware UTC）：
    started_at + 溫度曲線 + 常溫穩定 + 暫停時間。缺 started_at/active_sop_json 或無法解析回 None。

    設備卡與排程器以前各抄一份這段（萃取 sop 參數→curve→加穩定與暫停→算結束時間），
    差別只在回傳型別與 FINISHING 特例，收成這一支唯一來源。這裡只算「跑完測試該在何時空
    出來」，哪個狀態適用由 device_free_at 決定。now 需為 aware UTC。
    """
    started_at = item.get("started_at")
    active_sop_json = item.get("active_sop_json")
    if not started_at or not active_sop_json:
        return None
    try:
        sop = json.loads(active_sop_json) if isinstance(active_sop_json, str) else active_sop_json
    except Exception:
        return None

    ramp_rate = float(sop.get("ramp_rate") or 1.0)
    dwell_min = float(sop.get("dwell_time_hours") or 0.0) * 60.0
    cycles = int(sop.get("cycles") or 1)
    high_temp = float(sop.get("high_temperature") or sop.get("target_temperature") or AMBIENT_TEMP)
    raw_low = sop.get("low_temperature")
    low_temp = float(raw_low) if raw_low is not None else None
    total_min = curve_total_minutes(ramp_rate, dwell_min, cycles, high_temp, low_temp)

    if isinstance(started_at, str):
        started_dt = parse_iso_utc(started_at)
    else:
        started_dt = started_at
    if started_dt.tzinfo is None:
        started_dt = started_dt.replace(tzinfo=datetime.timezone.utc)
    return (
        started_dt
        + datetime.timedelta(minutes=total_min + STABILIZATION_MINUTES)
        + datetime.timedelta(seconds=total_pause_seconds(item, now))
    )


def device_free_at(item: dict, now: datetime.datetime) -> Optional[datetime.datetime]:
    """設備何時空出來（aware UTC）；沒有在占用中的狀態回 None。

    「哪個狀態用哪種估算」只有這一份。以前設備卡與排程器各寫一份這張對應表，FINISHING
    一邊算剩餘降溫、一邊算整條曲線跑完，兩邊估算就分岔了。now 需為 aware UTC。
    """
    status = item.get("status")
    if status == "FINISHING":
        return finishing_end(item, now)
    if status in ("RUNNING", "PAUSED"):
        return occupied_end(item, now)
    return None


def today_utc_window() -> tuple:
    """回傳 (now, today_start, today_end) — 三者皆為 naive UTC datetime"""
    now = _now_utc_naive()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    return now, today_start, today_end
