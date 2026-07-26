import asyncio
import dataclasses
import datetime
import json
import logging
import random
from collections.abc import Mapping
from typing import Optional

from .models import SessionLocal, DeviceData, SopExecution
from .standards import get_ramp_rate, get_standard
from .utils import _now_utc_naive
from . import device_state
from .schedule_service import advance_running_condition, complete_running_schedule
from .constants import AMBIENT_TEMP, AMBIENT_HUMIDITY
from .line import push_message

logger = logging.getLogger("app")


@dataclasses.dataclass
class _SimParams:
    high_temp: float
    low_temp: Optional[float]
    dwell_seconds: float
    cycles: int
    max_ramp_rate: float
    elapsed_seconds: float = 1.0


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


def _accum_dwell_elapsed(
    dwell_key: str, dwell_start, now, elapsed_seconds: float, dwell_elapsed_times: dict
) -> float:
    """首次進入 dwell 時以 wall-clock 播種，後續每 tick 累計 elapsed_seconds（已 cap 10s）。"""
    if dwell_key not in dwell_elapsed_times:
        dwell_elapsed_times[dwell_key] = max(0.0, (now - dwell_start).total_seconds())
    else:
        dwell_elapsed_times[dwell_key] += elapsed_seconds
    return dwell_elapsed_times[dwell_key]


def _advance_sim_phase(
    device_id: str,
    item: dict,
    now,
    dwell_start_times: dict,
    dwell_elapsed_times: dict,
    p: _SimParams,
) -> float:
    ambient = AMBIENT_TEMP
    max_change = p.max_ramp_rate / 60.0 * p.elapsed_seconds
    sim_phase = item.get("sim_phase", "")
    sim_cycle = item.get("sim_cycle", 0)

    # 首次啟動或從 idle 恢復
    if not sim_phase or sim_phase == "idle":
        item["sim_phase"] = "ramp_to_low" if (p.low_temp is not None and p.low_temp < ambient) else "ramp_to_high"
        item["sim_cycle"] = 0
        sim_phase = item["sim_phase"]
        dwell_start_times.pop(device_id, None)

    current_temp = item.get("temperature", AMBIENT_TEMP)
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
                    if t.tzinfo is not None:
                        t = t.replace(tzinfo=None)
                    dwell_start_times[key] = t
                except Exception:
                    _set_dwell_start(key_suffix, field)
            else:
                _set_dwell_start(key_suffix, field)
        return dwell_start_times[key]

    if sim_phase == "ramp_to_low":
        new_temp = _move_toward(current_temp, p.low_temp, max_change)
        if abs(new_temp - p.low_temp) <= 0.1:
            new_temp = p.low_temp
            if abs(p.high_temp - p.low_temp) <= 0.1:
                # 單溫冷測：直接進入 dwell_high
                item["sim_phase"] = "dwell_high"
                _set_dwell_start("high", "dwell_high_start")
            else:
                item["sim_phase"] = "ramp_to_high"

    elif sim_phase == "ramp_to_high":
        new_temp = _move_toward(current_temp, p.high_temp, max_change)
        if abs(new_temp - p.high_temp) <= 0.1:
            new_temp = p.high_temp
            item["sim_phase"] = "dwell_high"
            _set_dwell_start("high", "dwell_high_start")

    elif sim_phase == "dwell_high":
        new_temp = p.high_temp
        dwell_key = f"{device_id}_high"
        dwell_start = _restore_dwell_start("high", "dwell_high_start")
        elapsed = _accum_dwell_elapsed(dwell_key, dwell_start, now, p.elapsed_seconds, dwell_elapsed_times)
        _tick_dwell_half(item, elapsed, p.dwell_seconds)
        if elapsed >= p.dwell_seconds:
            del dwell_elapsed_times[dwell_key]
            dwell_start_times.pop(dwell_key, None)
            item.pop("dwell_high_start", None)
            item["dwell_half_fired"] = False
            # 兩溫循環：降至 low_temp；單溫：直接回常溫
            is_two_temp = p.low_temp is not None and abs(p.high_temp - p.low_temp) > 0.1
            item["sim_phase"] = "ramp_to_low2" if is_two_temp else "ramp_to_ambient"

    elif sim_phase == "ramp_to_low2":
        new_temp = _move_toward(current_temp, p.low_temp, max_change)
        if abs(new_temp - p.low_temp) <= 0.1:
            new_temp = p.low_temp
            item["sim_phase"] = "dwell_low"
            _set_dwell_start("low", "dwell_low_start")

    elif sim_phase == "dwell_low":
        new_temp = p.low_temp
        dwell_key = f"{device_id}_low"
        dwell_start = _restore_dwell_start("low", "dwell_low_start")
        elapsed = _accum_dwell_elapsed(dwell_key, dwell_start, now, p.elapsed_seconds, dwell_elapsed_times)
        _tick_dwell_half(item, elapsed, p.dwell_seconds)
        if elapsed >= p.dwell_seconds:
            del dwell_elapsed_times[dwell_key]
            dwell_start_times.pop(dwell_key, None)
            item.pop("dwell_low_start", None)
            item["dwell_half_fired"] = False
            item["sim_cycle"] = sim_cycle + 1
            item["sim_phase"] = "ramp_to_high" if item["sim_cycle"] < p.cycles else "ramp_to_ambient"

    elif sim_phase == "ramp_to_ambient":
        new_temp = _move_toward(current_temp, ambient, max_change)
        if abs(new_temp - ambient) <= 0.1:
            new_temp = ambient
            item["sim_phase"] = "done"

    return new_temp


async def _sim_handle_running(
    device_id: str, item: dict, now, dwell_start_times: dict, dwell_elapsed_times: dict, elapsed_seconds: float
) -> None:
    standard_id = item.get("standard_id")
    standard = get_standard(standard_id) if standard_id else None
    max_ramp_rate = get_ramp_rate(standard_id) if standard_id else 1.0

    high_temp = AMBIENT_TEMP
    low_temp = None
    dwell_seconds = 3600.0
    cycles = 1
    target_humi = None

    if standard:
        high_temp = standard.get("high_temperature") or standard.get("target_temperature", AMBIENT_TEMP)
        low_temp = standard.get("low_temperature")
        dwell_seconds = (standard.get("dwell_time_hours") or 1.0) * 3600.0
        cycles = standard.get("cycles") or 1
        target_humi = standard.get("humidity_rh_percent")

    new_temp = _advance_sim_phase(
        device_id, item, now, dwell_start_times, dwell_elapsed_times,
        _SimParams(
            high_temp=high_temp,
            low_temp=low_temp,
            dwell_seconds=dwell_seconds,
            cycles=cycles,
            max_ramp_rate=max_ramp_rate,
            elapsed_seconds=elapsed_seconds,
        ),
    )

    item["temperature"] = round(new_temp, 2)
    _update_humidity(item, target_humi, new_temp, item.get("humidity", AMBIENT_HUMIDITY))


def _sim_handle_finishing(
    item: dict,
    current_temp: float,
    current_humi: float,
    elapsed_seconds: float = 1.0,
) -> bool:
    """推進降溫；到達常溫時回 True，由 data_simulator 透過 state interface 完成清場。"""
    try:
        finishing_sop = json.loads(item.get("active_sop_json") or "{}")
        ramp_rate = finishing_sop.get("ramp_rate") or 1.0
    except Exception:
        ramp_rate = 1.0
    finishing_ramp = ramp_rate / 60.0 * elapsed_seconds

    diff = AMBIENT_TEMP - current_temp
    if abs(diff) > 0.5:
        item["temperature"] = round(
            current_temp + (finishing_ramp if diff > 0 else -finishing_ramp), 2
        )
        completed = False
    else:
        item["temperature"] = AMBIENT_TEMP
        completed = True

    item["humidity"] = round(
        max(0.0, min(100.0, current_humi + random.uniform(-0.2, 0.2))), 1
    )
    return completed


def _sim_handle_emergency(item: dict, current_temp: float, current_humi: float) -> None:
    """處理 EMERGENCY 狀態：溫濕度微幅震盪。"""
    item["temperature"] = round(current_temp + random.uniform(-0.05, 0.05), 2)
    item["humidity"] = round(
        max(0.0, min(100.0, current_humi + random.uniform(-0.1, 0.1))), 1
    )


def _mark_execution_ended(execution_id: int, now: datetime.datetime) -> None:
    with SessionLocal() as db:
        db.query(SopExecution).filter(
            SopExecution.id == execution_id,
            SopExecution.test_ended_at.is_(None),
        ).update({"test_ended_at": now}, synchronize_session=False)
        db.commit()


def _record_device_data(
    device_id: str,
    item: Mapping[str, object],
    now: datetime.datetime,
) -> None:
    with SessionLocal() as db:
        db.add(DeviceData(
            device_id=device_id,
            temperature=item["temperature"],
            humidity=item.get("humidity", AMBIENT_HUMIDITY),
            timestamp=now,
        ))
        db.commit()


async def _apply_simulated_item_with_retry(
    states: device_state.DeviceStateManager,
    device_id: str,
    item: dict,
    *,
    expected_status: str,
    expected_sim_phase: str | None,
    complete: bool = False,
    checkpoint: bool = False,
    attempts: int = 2,
) -> device_state.TransitionResult | None:
    for attempt in range(attempts):
        try:
            return await states.advance(
                device_id,
                temperature=item.get("temperature", AMBIENT_TEMP),
                humidity=item.get("humidity", AMBIENT_HUMIDITY),
                sim_phase=item.get("sim_phase"),
                sim_cycle=item.get("sim_cycle", 0),
                dwell_half_fired=item.get("dwell_half_fired", False),
                dwell_high_start=item.get("dwell_high_start"),
                dwell_low_start=item.get("dwell_low_start"),
                expected_statuses=(expected_status,),
                expected_sim_phase=expected_sim_phase,
                complete=complete,
                checkpoint=checkpoint,
            )
        except Exception as error:
            if attempt + 1 < attempts:
                logger.warning(f"[{device_id}] state checkpoint retry: {error}")
                await asyncio.sleep(0.5)
            else:
                logger.error(f"[{device_id}] state checkpoint failed: {error}")
    return None


# ── 主模擬迴圈 ───────────────────────────────────────────────────────────────


async def data_simulator(states: device_state.DeviceStateManager) -> None:
    write_counters: dict = {}
    dwell_start_times: dict = {}
    dwell_elapsed_times: dict = {}
    last_tick: dict = {}

    while True:
        now = _now_utc_naive()

        for device_id in states:
            item = dict(states[device_id])
            status = item.get("status", "OFFLINE")
            expected_sim_phase = item.get("sim_phase")

            # IDLE 設備跳過，不做無謂迭代
            if status == "IDLE":
                if write_counters.get(device_id, 0) != 0:
                    write_counters[device_id] = 0
                last_tick.pop(device_id, None)
                continue

            current_temp = item.get("temperature", AMBIENT_TEMP)
            current_humi = item.get("humidity", AMBIENT_HUMIDITY)

            if device_id not in write_counters:
                write_counters[device_id] = 0

            # 計算真實 elapsed 時間，避免 asyncio.sleep 不精確導致升溫速率偏慢
            prev = last_tick.get(device_id)
            elapsed_seconds = (now - prev).total_seconds() if prev else 1.0
            elapsed_seconds = min(elapsed_seconds, 10.0)  # 防止重啟後一次跳太多
            last_tick[device_id] = now

            if status == "RUNNING":
                await _sim_handle_running(device_id, item, now, dwell_start_times, dwell_elapsed_times, elapsed_seconds)
                # 測試自然完成（ramp_to_ambient 降溫到 25°C）
                if item.get("sim_phase") == "done":
                    completion = await _apply_simulated_item_with_retry(
                        states,
                        device_id,
                        item,
                        expected_status="RUNNING",
                        expected_sim_phase=expected_sim_phase,
                        complete=True,
                    )
                    if completion is None or not completion.changed:
                        continue
                    execution_id = completion.before.get("active_execution_id")
                    if execution_id:
                        for _attempt in range(3):
                            try:
                                await asyncio.to_thread(_mark_execution_ended, execution_id, now)
                                break
                            except Exception as e:
                                logger.error(f"[{device_id}] 寫入 test_ended_at 失敗（第{_attempt+1}次）：{e}")
                                if _attempt == 2:
                                    logger.error(f"[{device_id}] 寫入 test_ended_at 三次失敗，放棄")
                    logger.info(f"[{device_id}] 測試自然完成，回待機。")
                    try:
                        progress = await asyncio.to_thread(advance_running_condition, device_id)
                        if progress:
                            asyncio.create_task(push_message(
                                f"✅ 條件 {progress.new_index}/{progress.total} 完成\n"
                                f"專案：{progress.project_number} / {progress.sample_name}\n"
                                f"設備：{device_id}\n請至排程頁面確認下一步"
                            ))
                            logger.info(
                                f"[{device_id}] 排程 {progress.schedule_id} "
                                f"條件 {progress.new_index}/{progress.total} 完成，等待人員確認"
                            )
                    except Exception as e:
                        logger.error(f"[{device_id}] 更新排程條件進度失敗：{e}", exc_info=True)
                    continue
            elif status == "FINISHING":
                completed = _sim_handle_finishing(item, current_temp, current_humi, elapsed_seconds)
                if completed:
                    completion = await _apply_simulated_item_with_retry(
                        states,
                        device_id,
                        item,
                        expected_status="FINISHING",
                        expected_sim_phase=expected_sim_phase,
                        complete=True,
                    )
                    if completion is None or not completion.changed:
                        continue
                    for _suffix in ("_high", "_low"):
                        _k = f"{device_id}{_suffix}"
                        dwell_start_times.pop(_k, None)
                        dwell_elapsed_times.pop(_k, None)
                    logger.info(f"[{device_id}] 手動停止降溫完成，回待機。")
                    if not completion.before.get("skip_push", False):
                        push_text = None
                        try:
                            done = await asyncio.to_thread(complete_running_schedule, device_id, now)
                            if done is not None:
                                push_text = (
                                    f"✅ 測試完成\n"
                                    f"專案：{done.project_number} / {done.sample_name}\n"
                                    f"設備：{done.device_id}"
                                )
                        except Exception as e:
                            logger.error(f"[{device_id}] 完成排程失敗：{e}", exc_info=True)
                        if push_text is None:
                            sop_name = completion.before.get("running_sop_name") or "未知測試"
                            push_text = f"✅ 測試完成\n設備：{device_id}\n測試：{sop_name}"
                        asyncio.create_task(push_message(push_text))
                    continue
            elif status == "EMERGENCY":
                _sim_handle_emergency(item, current_temp, current_humi)

            if status in ["RUNNING", "FINISHING", "EMERGENCY"]:
                write_counters[device_id] += 1
                checkpoint = write_counters[device_id] >= 10
                result = await _apply_simulated_item_with_retry(
                    states,
                    device_id,
                    item,
                    expected_status=status,
                    expected_sim_phase=expected_sim_phase,
                    checkpoint=checkpoint,
                    attempts=2 if checkpoint else 1,
                )
                if (
                    checkpoint
                    and result is not None
                    and result.reason in ("advanced", "no_changes")
                ):
                    for _attempt in range(2):
                        try:
                            await asyncio.to_thread(
                                _record_device_data,
                                device_id,
                                result.after,
                                now,
                            )
                            break
                        except Exception as e:
                            if _attempt == 0:
                                logger.warning(f"[{device_id}] DB write retry: {e}")
                                await asyncio.sleep(0.5)
                            else:
                                logger.error(f"[{device_id}] DB write error after retry: {e}")
                if checkpoint:
                    write_counters[device_id] = 0
            else:
                write_counters[device_id] = 0

        await asyncio.sleep(1)
