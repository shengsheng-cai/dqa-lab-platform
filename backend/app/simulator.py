import asyncio
import datetime
import json
import logging
import random

from .models import SessionLocal, DeviceData, SopExecution, Schedule, ScheduleStatus
from .standards import get_ramp_rate, get_standard
from .utils import _now_utc, _save_device_state
from .schedules import _complete_schedule
from .line import push_message

logger = logging.getLogger("app")


# ── 模擬器輔助函數 ──────────────────────────────────────────────────────────


def _move_toward(current: float, target: float, max_change: float) -> float:
    diff = target - current
    if abs(diff) <= 0.1:
        return target
    change = min(abs(diff), max_change)
    return current + (change if diff > 0 else -change)


def _update_humidity(
    item: dict, target_humi, new_temp: float, current_humi: float
) -> None:
    """更新 item["humidity"] 模擬值。"""
    if target_humi is not None and new_temp >= 0:
        humi_diff = target_humi - current_humi
        humi_change = min(abs(humi_diff), 0.3)
        tracked = current_humi + (humi_change if humi_diff > 0 else -humi_change)
        item["humidity"] = round(tracked + random.uniform(-0.2, 0.2), 1)
    elif new_temp < 0:
        item["humidity"] = round(
            max(0.0, current_humi - 0.1 + random.uniform(-0.05, 0.05)), 1
        )
    else:
        item["humidity"] = round(
            max(0.0, min(100.0, current_humi + random.uniform(-0.3, 0.3))), 1
        )


def _tick_dwell_half(item: dict, elapsed: float, dwell_seconds: float) -> None:
    """停留時間過半時設定 flag；只在首次過半時寫入，不重複賦值。"""
    if elapsed >= dwell_seconds * 0.5 and not item.get("dwell_half_fired"):
        item["dwell_half_fired"] = True


def _advance_sim_phase(
    device_id: str,
    item: dict,
    now,
    dwell_start_times: dict,
    high_temp: float,
    low_temp,
    dwell_seconds: float,
    cycles: int,
    max_ramp_rate: float,
    elapsed_seconds: float = 1.0,
) -> float:
    ambient = 25.0
    max_change = max_ramp_rate / 60.0 * elapsed_seconds
    sim_phase = item.get("sim_phase", "")
    sim_cycle = item.get("sim_cycle", 0)

    # 首次啟動或從 idle 恢復
    if not sim_phase or sim_phase == "idle":
        item["sim_phase"] = "ramp_to_low" if (low_temp is not None and low_temp < ambient) else "ramp_to_high"
        item["sim_cycle"] = 0
        sim_phase = item["sim_phase"]
        dwell_start_times.pop(device_id, None)

    current_temp = item.get("temperature", 25.0)
    new_temp = current_temp

    def _set_dwell_start(key_suffix: str, field: str):
        dwell_start_times[f"{device_id}_{key_suffix}"] = now
        item[field] = now.isoformat()

    def _restore_dwell_start(key_suffix: str, field: str) -> datetime.datetime:
        # 重啟後從 DB 欄位恢復計時起點，避免 dwell 重算
        key = f"{device_id}_{key_suffix}"
        if key not in dwell_start_times:
            stored = item.get(field)
            if stored:
                try:
                    t = datetime.datetime.fromisoformat(stored)
                    if t.tzinfo is None:
                        t = t.replace(tzinfo=datetime.timezone.utc)
                    dwell_start_times[key] = t
                except Exception:
                    _set_dwell_start(key_suffix, field)
            else:
                _set_dwell_start(key_suffix, field)
        return dwell_start_times[key]

    if sim_phase == "ramp_to_low":
        new_temp = _move_toward(current_temp, low_temp, max_change)
        if abs(new_temp - low_temp) <= 0.1:
            new_temp = low_temp
            if abs(high_temp - low_temp) <= 0.1:
                # 單溫冷測：直接進入 dwell_high
                item["sim_phase"] = "dwell_high"
                _set_dwell_start("high", "dwell_high_start")
            else:
                item["sim_phase"] = "ramp_to_high"

    elif sim_phase == "ramp_to_high":
        new_temp = _move_toward(current_temp, high_temp, max_change)
        if abs(new_temp - high_temp) <= 0.1:
            new_temp = high_temp
            item["sim_phase"] = "dwell_high"
            _set_dwell_start("high", "dwell_high_start")

    elif sim_phase == "dwell_high":
        new_temp = high_temp
        dwell_key = f"{device_id}_high"
        dwell_start = _restore_dwell_start("high", "dwell_high_start")
        elapsed = (now - dwell_start).total_seconds()
        _tick_dwell_half(item, elapsed, dwell_seconds)
        if elapsed >= dwell_seconds:
            dwell_start_times.pop(dwell_key, None)
            item.pop("dwell_high_start", None)
            item["dwell_half_fired"] = False
            # 兩溫循環：降至 low_temp；單溫：直接回常溫
            item["sim_phase"] = "ramp_to_low2" if (low_temp is not None and abs(high_temp - low_temp) > 0.1) else "ramp_to_ambient"

    elif sim_phase == "ramp_to_low2":
        new_temp = _move_toward(current_temp, low_temp, max_change)
        if abs(new_temp - low_temp) <= 0.1:
            new_temp = low_temp
            item["sim_phase"] = "dwell_low"
            _set_dwell_start("low", "dwell_low_start")

    elif sim_phase == "dwell_low":
        new_temp = low_temp
        dwell_key = f"{device_id}_low"
        dwell_start = _restore_dwell_start("low", "dwell_low_start")
        elapsed = (now - dwell_start).total_seconds()
        _tick_dwell_half(item, elapsed, dwell_seconds)
        if elapsed >= dwell_seconds:
            dwell_start_times.pop(dwell_key, None)
            item.pop("dwell_low_start", None)
            item["dwell_half_fired"] = False
            item["sim_cycle"] = sim_cycle + 1
            item["sim_phase"] = "ramp_to_high" if item["sim_cycle"] < cycles else "ramp_to_ambient"

    elif sim_phase == "ramp_to_ambient":
        new_temp = _move_toward(current_temp, ambient, max_change)
        if abs(new_temp - ambient) <= 0.1:
            new_temp = ambient
            item["sim_phase"] = "done"

    return new_temp


async def _sim_handle_running(
    device_id: str, item: dict, now, dwell_start_times: dict, elapsed_seconds: float
) -> None:
    standard_id = item.get("standard_id")
    standard = get_standard(standard_id) if standard_id else None
    max_ramp_rate = get_ramp_rate(standard_id) if standard_id else 1.0

    high_temp = 25.0
    low_temp = None
    dwell_seconds = 3600.0
    cycles = 1
    target_humi = None

    if standard:
        high_temp = standard.get("high_temperature") or standard.get("target_temperature", 25.0)
        low_temp = standard.get("low_temperature")
        dwell_seconds = (standard.get("dwell_time_hours") or 1.0) * 3600.0
        cycles = standard.get("cycles") or 1
        target_humi = standard.get("humidity_rh_percent")

    new_temp = _advance_sim_phase(
        device_id, item, now, dwell_start_times,
        high_temp, low_temp, dwell_seconds, cycles, max_ramp_rate,
        elapsed_seconds,
    )

    item["temperature"] = round(new_temp, 2)
    _update_humidity(item, target_humi, new_temp, item.get("humidity", 55.0))


def _try_complete_schedule_for_device(device_id: str) -> str | None:
    """查找設備的進行中排程並立即標為已完成（含治具歸還）。
    回傳推播訊息字串（有排程時），或 None（無排程時）。"""
    try:
        now = _now_utc()
        with SessionLocal() as db:
            schedule = db.query(Schedule).filter(
                Schedule.device_id == device_id,
                Schedule.status.in_([ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]),
            ).first()
            if schedule:
                proj, sample, dev = schedule.project_number, schedule.sample_name, schedule.device_id
                _complete_schedule(db, schedule, now)
                db.commit()
                logger.info(f"[{device_id}] 排程 {schedule.id} 標為已完成")
                return f"✅ 測試完成\n專案：{proj} / {sample}\n設備：{dev}"
    except Exception as e:
        logger.error(f"[{device_id}] 更新排程失敗：{e}", exc_info=True)
    return None


def _idle_state_patch() -> dict:
    return {
        "status": "IDLE",
        "running_sop_name": "STANDBY",
        "running_sop_id": None,
        "active_sop_json": None,
        "started_at": None,
        "standard_id": None,
        "operator": "",
        "operator_user_id": None,
        "sim_phase": "idle",
        "sim_cycle": 0,
        "dwell_half_fired": False,
    }


async def _sim_handle_finishing(
    device_id: str, item: dict, current_temp: float, current_humi: float, locks: dict, elapsed_seconds: float = 1.0
) -> None:
    try:
        finishing_sop = json.loads(item.get("active_sop_json") or "{}")
        ramp_rate = finishing_sop.get("ramp_rate") or 1.0
    except Exception:
        ramp_rate = 1.0
    finishing_ramp = ramp_rate / 60.0 * elapsed_seconds

    diff = 25.0 - current_temp
    if abs(diff) > 0.5:
        item["temperature"] = round(
            current_temp + (finishing_ramp if diff > 0 else -finishing_ramp), 2
        )
    else:
        item["temperature"] = 25.0
        sop_name = item.get("running_sop_name") or "未知測試"
        async with locks[device_id]:
            item.update(_idle_state_patch())
            _save_device_state(device_id, item)
        logger.info(f"[{device_id}] 手動停止降溫完成，回待機。")
        push_text = _try_complete_schedule_for_device(device_id)
        if push_text is None:
            push_text = f"✅ 測試完成\n設備：{device_id}\n測試：{sop_name}"
        asyncio.create_task(push_message(push_text))

    item["humidity"] = round(
        max(0.0, min(100.0, current_humi + random.uniform(-0.2, 0.2))), 1
    )


def _sim_handle_emergency(item: dict, current_temp: float, current_humi: float) -> None:
    """處理 EMERGENCY 狀態：溫濕度微幅震盪。"""
    item["temperature"] = round(current_temp + random.uniform(-0.05, 0.05), 2)
    item["humidity"] = round(
        max(0.0, min(100.0, current_humi + random.uniform(-0.1, 0.1))), 1
    )


# ── 主模擬迴圈 ───────────────────────────────────────────────────────────────


async def data_simulator(cache: dict, locks: dict):
    write_counters: dict = {}
    dwell_start_times: dict = {}
    last_tick: dict = {}

    while True:
        now = _now_utc()

        for device_id, item in cache.items():
            status = item.get("status", "OFFLINE")

            # IDLE 設備跳過，不做無謂迭代
            if status == "IDLE":
                if write_counters.get(device_id, 0) != 0:
                    write_counters[device_id] = 0
                last_tick.pop(device_id, None)
                continue

            current_temp = item.get("temperature", 25.0)
            current_humi = item.get("humidity", 55.0)

            if device_id not in write_counters:
                write_counters[device_id] = 0

            # 計算真實 elapsed 時間，避免 asyncio.sleep 不精確導致升溫速率偏慢
            prev = last_tick.get(device_id)
            elapsed_seconds = (now - prev).total_seconds() if prev else 1.0
            elapsed_seconds = min(elapsed_seconds, 10.0)  # 防止重啟後一次跳太多
            last_tick[device_id] = now

            if status == "RUNNING":
                await _sim_handle_running(device_id, item, now, dwell_start_times, elapsed_seconds)
                # 測試自然完成（ramp_to_ambient 降溫到 25°C）
                if item.get("sim_phase") == "done":
                    execution_id = item.get("active_execution_id")
                    prev_sop_id = item.get("running_sop_id")
                    async with locks[device_id]:
                        item.update({
                            "status": "IDLE",
                            "running_sop_name": "STANDBY",
                            "running_sop_id": None,
                            "standard_id": None,
                            "active_sop_json": None,
                            "completed_steps": 0,
                            "started_at": None,
                            "operator": "",
                            "operator_user_id": None,
                            "sim_phase": "idle",
                            "sim_cycle": 0,
                            "dwell_high_start": None,
                            "dwell_low_start": None,
                            "dwell_half_fired": False,
                            "active_execution_id": None,
                        })
                        _save_device_state(device_id, item)
                    if execution_id:
                        for _attempt in range(3):
                            try:
                                with SessionLocal() as db:
                                    db.query(SopExecution).filter(
                                        SopExecution.id == execution_id,
                                        SopExecution.test_ended_at == None,
                                    ).update({"test_ended_at": now}, synchronize_session=False)
                                    db.commit()
                                break
                            except Exception as e:
                                logger.error(f"[{device_id}] 寫入 test_ended_at 失敗（第{_attempt+1}次）：{e}")
                                if _attempt == 2:
                                    logger.error(f"[{device_id}] 寫入 test_ended_at 三次失敗，放棄")
                    logger.info(f"[{device_id}] 測試自然完成，回待機。")
                    try:
                        with SessionLocal() as db:
                            schedule = db.query(Schedule).filter(
                                Schedule.device_id == device_id,
                                Schedule.status.in_([ScheduleStatus.CONFIRMED, ScheduleStatus.RUNNING]),
                            ).first()
                            if schedule:
                                new_idx = schedule.current_condition_index + 1
                                total = len(json.loads(schedule.conditions)) if schedule.conditions else 0
                                schedule.current_condition_index = new_idx
                                db.commit()
                                proj, sample = schedule.project_number, schedule.sample_name
                                asyncio.create_task(push_message(
                                    f"✅ 條件 {new_idx}/{total} 完成\n專案：{proj} / {sample}\n設備：{device_id}\n請至排程頁面確認下一步"
                                ))
                                logger.info(f"[{device_id}] 排程 {schedule.id} 條件 {new_idx}/{total} 完成，等待人員確認")
                    except Exception as e:
                        logger.error(f"[{device_id}] 更新排程條件進度失敗：{e}", exc_info=True)
                    continue
            elif status == "FINISHING":
                await _sim_handle_finishing(device_id, item, current_temp, current_humi, locks, elapsed_seconds)
            elif status == "EMERGENCY":
                _sim_handle_emergency(item, current_temp, current_humi)

            if status in ["RUNNING", "FINISHING", "EMERGENCY"]:
                write_counters[device_id] += 1
                if write_counters[device_id] >= 10:
                    for _attempt in range(2):
                        try:
                            with SessionLocal() as db:
                                db.add(DeviceData(
                                    device_id=device_id,
                                    temperature=item["temperature"],
                                    humidity=item.get("humidity", 55.0),
                                    timestamp=now,
                                ))
                                db.commit()
                            _save_device_state(device_id, item)
                            break
                        except Exception as e:
                            if _attempt == 0:
                                logger.warning(f"[{device_id}] DB write retry: {e}")
                                await asyncio.sleep(0.5)
                            else:
                                logger.error(f"[{device_id}] DB write error after retry: {e}")
                    write_counters[device_id] = 0
            else:
                write_counters[device_id] = 0

        await asyncio.sleep(1)
