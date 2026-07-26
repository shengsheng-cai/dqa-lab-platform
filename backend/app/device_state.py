"""設備狀態的單一 owner。

所有共享狀態寫入只能走五個動詞：start、finish、pause、emergency、advance。
這個 module 同時負責 in-memory cache、每台設備的 lock，以及 DeviceState 落盤；
呼叫端只會拿到 snapshot，不會拿到可直接修改的 live dict。
"""

from __future__ import annotations

import asyncio
import datetime
import random
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from sqlalchemy.orm import Session

from .constants import AMBIENT_HUMIDITY, AMBIENT_TEMP
from .models import DeviceState, SessionLocal
from .utils import _now_utc, _now_utc_naive, parse_iso_utc, total_pause_seconds

_UNSET = object()


class _ExecutionCreationFailed(Exception):
    """讓 start 區分「執行紀錄建不出來」與 DeviceState 落盤本身失敗。"""


@dataclass(frozen=True)
class TransitionResult:
    changed: bool
    reason: str
    before: Mapping[str, Any]
    after: Mapping[str, Any]


def _snapshot(item: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType(dict(item))


def _idle_patch() -> dict[str, Any]:
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
        "dwell_high_start": None,
        "dwell_low_start": None,
        "dwell_half_fired": False,
        "completed_steps": 0,
        "total_steps": 0,
        "active_execution_id": None,
        "skip_push": False,
        "paused_at": None,
        "pause_accum_seconds": 0.0,
    }


def _save(
    device_id: str,
    item: Mapping[str, Any],
    before_commit: Callable[[Session, DeviceState], None] | None = None,
) -> None:
    """同步 DB 寫入；只能由 DeviceStateManager 透過 asyncio.to_thread 呼叫。"""
    with SessionLocal() as db:
        state = db.get(DeviceState, device_id)
        if state is None:
            state = DeviceState(device_id=device_id)
            db.add(state)

        state.status = item.get("status", "IDLE")
        state.temperature = item.get("temperature", AMBIENT_TEMP)
        state.humidity = item.get("humidity", AMBIENT_HUMIDITY)
        state.running_sop_id = item.get("running_sop_id")
        state.running_sop_name = item.get("running_sop_name")
        state.standard_id = item.get("standard_id")
        state.active_sop_json = item.get("active_sop_json")
        state.completed_steps = item.get("completed_steps", 0)
        state.total_steps = item.get("total_steps", 0)
        state.operator = item.get("operator", "")
        state.operator_user_id = item.get("operator_user_id")
        state.skip_push = item.get("skip_push", False)
        state.updated_at = _now_utc_naive()

        started_at = item.get("started_at")
        if started_at is not None:
            if isinstance(started_at, str):
                started_at = parse_iso_utc(started_at)
            state.started_at = started_at.replace(tzinfo=None)
        else:
            state.started_at = None

        state.active_execution_id = item.get("active_execution_id")
        state.sim_phase = item.get("sim_phase", "idle")
        state.sim_cycle = item.get("sim_cycle", 0)
        state.dwell_half_fired = item.get("dwell_half_fired", False)

        for field in ("dwell_high_start", "dwell_low_start", "paused_at"):
            value = item.get(field)
            if value is not None:
                if isinstance(value, str):
                    value = parse_iso_utc(value)
                setattr(state, field, value.replace(tzinfo=None))
            else:
                setattr(state, field, None)
        state.pause_accum_seconds = float(item.get("pause_accum_seconds") or 0.0)

        if before_commit is not None:
            before_commit(db, state)
        db.commit()


class DeviceStateManager(Mapping[str, Mapping[str, Any]]):
    """共享 cache 的唯一寫入入口；讀取一律回傳 snapshot。"""

    def __init__(self, cache: dict[str, dict[str, Any]]) -> None:
        # 不保留 caller 傳入的 raw dict；否則 caller 只要握著原始 reference，
        # 仍能繞過五動詞、lock 與 persistence 直接改 live cache。
        self._cache = {
            device_id: dict(item)
            for device_id, item in cache.items()
        }
        self._locks = {
            device_id: asyncio.Lock()
            for device_id in self._cache
        }

    @classmethod
    def restore(cls, device_ids: Sequence[str]) -> DeviceStateManager:
        """從 DB 還原 cache；不存在的設備以完整 IDLE 欄位表建立。"""
        with SessionLocal() as db:
            saved_states = {
                state.device_id: state
                for state in db.query(DeviceState).all()
            }

        cache: dict[str, dict[str, Any]] = {}
        for device_id in device_ids:
            state = saved_states.get(device_id)
            if state is None:
                cache[device_id] = {
                    **_idle_patch(),
                    "temperature": round(AMBIENT_TEMP + random.uniform(-1.0, 1.0), 2),
                    "humidity": round(AMBIENT_HUMIDITY + random.uniform(-2.0, 2.0), 1),
                }
                continue

            started_at = state.started_at
            if started_at is not None and started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=datetime.timezone.utc)
            cache[device_id] = {
                "temperature": state.temperature,
                "humidity": state.humidity,
                "status": state.status,
                "running_sop_name": state.running_sop_name or "STANDBY",
                "running_sop_id": state.running_sop_id,
                "standard_id": state.standard_id,
                "active_sop_json": state.active_sop_json,
                "completed_steps": state.completed_steps or 0,
                "total_steps": state.total_steps or 0,
                "started_at": started_at,
                "operator": state.operator or "",
                "operator_user_id": state.operator_user_id,
                "active_execution_id": state.active_execution_id,
                "sim_phase": state.sim_phase or "idle",
                "sim_cycle": state.sim_cycle or 0,
                "dwell_half_fired": state.dwell_half_fired,
                "dwell_high_start": state.dwell_high_start.isoformat()
                if state.dwell_high_start else None,
                "dwell_low_start": state.dwell_low_start.isoformat()
                if state.dwell_low_start else None,
                "skip_push": bool(state.skip_push),
                "paused_at": state.paused_at.replace(tzinfo=datetime.timezone.utc)
                if state.paused_at is not None else None,
                "pause_accum_seconds": state.pause_accum_seconds or 0.0,
            }
        return cls(cache)

    def __getitem__(self, device_id: str) -> Mapping[str, Any]:
        return _snapshot(self._cache[device_id])

    def __iter__(self) -> Iterator[str]:
        return iter(tuple(self._cache))

    def __len__(self) -> int:
        return len(self._cache)

    def _lock_for(self, device_id: str) -> asyncio.Lock | None:
        return self._locks.get(device_id)

    @staticmethod
    def _result(
        changed: bool,
        reason: str,
        before: Mapping[str, Any],
        after: Mapping[str, Any],
    ) -> TransitionResult:
        return TransitionResult(changed, reason, _snapshot(before), _snapshot(after))

    async def _persist(
        self,
        device_id: str,
        item: Mapping[str, Any],
        before_commit: Callable[[Session, DeviceState], None] | None = None,
    ) -> None:
        await asyncio.to_thread(_save, device_id, dict(item), before_commit)

    def _publish(self, device_id: str, item: Mapping[str, Any]) -> None:
        # 換掉整個 inner dict 是單一步驟；reader 不會撞在 clear/update 中間讀到空狀態。
        self._cache[device_id] = dict(item)

    async def _persist_start(
        self,
        device_id: str,
        item: Mapping[str, Any],
        before_commit: Callable[[Session, DeviceState], None] | None = None,
    ) -> None:
        """設備啟動即使 caller 取消，也要等 transaction 收尾後再決定是否發布 cache。"""
        persistence = asyncio.create_task(
            self._persist(device_id, item, before_commit),
        )
        try:
            await asyncio.shield(persistence)
        except asyncio.CancelledError:
            # cleanup 期間可能再次收到 cancel；持續 shield，不能讓 cancellation
            # 傳進 persistence task，否則 to_thread 仍可能 commit、cache 卻不發布。
            while not persistence.done():
                try:
                    await asyncio.shield(persistence)
                except asyncio.CancelledError:
                    continue
            try:
                persistence.result()
            except (Exception, asyncio.CancelledError):
                pass
            else:
                self._publish(device_id, item)
            raise
        self._publish(device_id, item)

    async def start(
        self,
        device_id: str,
        *,
        sop_id: str,
        sop_name: str,
        active_sop_json: str,
        total_steps: int,
        operator: str,
        operator_user_id: int | None,
        started_at: datetime.datetime,
        create_execution: Callable[[Session], int | None] | None = None,
        before_commit: Callable[[Session, DeviceState], None] | None = None,
    ) -> TransitionResult:
        """IDLE → RUNNING；可在同一 transaction 建 execution 並套用額外業務寫入。"""
        lock = self._lock_for(device_id)
        if lock is None:
            return self._result(False, "missing", {}, {})

        async with lock:
            before = dict(self._cache[device_id])
            if before.get("status") != "IDLE":
                return self._result(False, "invalid_status", before, before)

            running = {
                **before,
                **_idle_patch(),
                "status": "RUNNING",
                "running_sop_id": sop_id,
                "running_sop_name": sop_name,
                "standard_id": sop_id,
                "active_sop_json": active_sop_json,
                "started_at": started_at,
                "total_steps": total_steps,
                "operator": operator,
                "operator_user_id": operator_user_id,
            }

            if create_execution is not None or before_commit is not None:
                def prepare_start(db: Session, state: DeviceState) -> None:
                    if create_execution is not None:
                        try:
                            execution_id = create_execution(db)
                        except Exception as error:
                            raise _ExecutionCreationFailed from error
                        if execution_id is None:
                            raise _ExecutionCreationFailed
                        state.active_execution_id = execution_id
                        running["active_execution_id"] = execution_id
                    if before_commit is not None:
                        before_commit(db, state)

                attempts = 3 if create_execution is not None else 1
                for attempt in range(attempts):
                    try:
                        await self._persist_start(
                            device_id,
                            running,
                            before_commit=prepare_start,
                        )
                        break
                    except _ExecutionCreationFailed:
                        if attempt == attempts - 1:
                            return self._result(
                                False,
                                "execution_failed",
                                before,
                                before,
                            )
            else:
                await self._persist_start(device_id, running)

            return self._result(True, "started", before, running)

    async def finish(
        self,
        device_id: str,
        *,
        cancelled: bool = False,
        notify: bool = True,
    ) -> TransitionResult:
        """開始正常收尾：RUNNING/PAUSED(/EMERGENCY) → FINISHING。"""
        lock = self._lock_for(device_id)
        if lock is None:
            return self._result(False, "missing", {}, {})

        async with lock:
            before = dict(self._cache[device_id])
            allowed = ("RUNNING", "PAUSED") if cancelled else ("RUNNING", "PAUSED", "EMERGENCY")
            if before.get("status") not in allowed:
                return self._result(False, "invalid_status", before, before)

            after = {
                **before,
                "status": "FINISHING",
                "running_sop_name": (
                    "排程取消，降溫收尾中..."
                    if cancelled else "系統自動降溫收尾中..."
                ),
                "sim_phase": "ramp_to_ambient",
                "sim_cycle": 0,
                "skip_push": not notify,
            }
            if not cancelled:
                after["completed_steps"] = 0
                after["standard_id"] = None
            # 收尾前把最後一段暫停結算掉，FINISHING 期間估算才不會一直往後飄
            after["pause_accum_seconds"] = total_pause_seconds(before, _now_utc())
            after["paused_at"] = None

            await self._persist(device_id, after)
            self._publish(device_id, after)
            return self._result(True, "finishing", before, after)

    async def pause(self, device_id: str) -> TransitionResult:
        """RUNNING ↔ PAUSED。"""
        lock = self._lock_for(device_id)
        if lock is None:
            return self._result(False, "missing", {}, {})

        async with lock:
            before = dict(self._cache[device_id])
            status = before.get("status")
            if status not in ("RUNNING", "PAUSED"):
                return self._result(False, "invalid_status", before, before)
            now = _now_utc()
            if status == "RUNNING":
                # 進入暫停：記下起點；模擬器同時凍結進度，估算才和實際一致
                after = {**before, "status": "PAUSED", "paused_at": now}
            else:
                # 恢復執行：把這一段暫停結算進累計，估算結束時間才扣得到
                after = {
                    **before,
                    "status": "RUNNING",
                    "paused_at": None,
                    "pause_accum_seconds": total_pause_seconds(before, now),
                }
            await self._persist(device_id, after)
            self._publish(device_id, after)
            return self._result(True, "paused" if status == "RUNNING" else "resumed", before, after)

    async def emergency(
        self,
        device_id: str,
        *,
        stop: Callable[[], Awaitable[None]] | None = None,
        record: Callable[[Session, Mapping[str, Any]], None] | None = None,
    ) -> TransitionResult:
        """任意非 EMERGENCY 狀態 → EMERGENCY；重複呼叫保持 idempotent。"""
        lock = self._lock_for(device_id)
        if lock is None:
            return self._result(False, "missing", {}, {})

        async with lock:
            before = dict(self._cache[device_id])
            if before.get("status") == "EMERGENCY":
                return self._result(False, "already_emergency", before, before)
            # 先停實體，再把狀態與稽核原子落盤；任一步驟丟例外都不會發布 cache。
            if stop is not None:
                await stop()
            after = {
                **before,
                "status": "EMERGENCY",
                "running_sop_id": None,
                "running_sop_name": "🚨 緊急停止中 - 待確認安全",
                "active_sop_json": None,
                "completed_steps": 0,
                "started_at": None,
                "total_steps": 0,
                "operator": "",
                "operator_user_id": None,
                "sim_phase": "idle",
                "sim_cycle": 0,
                "paused_at": None,
                "pause_accum_seconds": 0.0,
            }

            def include_record(db: Session, _state: DeviceState) -> None:
                if record is not None:
                    record(db, _snapshot(before))

            await self._persist(
                device_id,
                after,
                before_commit=include_record if record is not None else None,
            )
            self._publish(device_id, after)
            return self._result(True, "emergency", before, after)

    async def advance(
        self,
        device_id: str,
        *,
        temperature: float | object = _UNSET,
        humidity: float | object = _UNSET,
        sim_phase: str | None | object = _UNSET,
        sim_cycle: int | object = _UNSET,
        dwell_half_fired: bool | object = _UNSET,
        dwell_high_start: datetime.datetime | str | None | object = _UNSET,
        dwell_low_start: datetime.datetime | str | None | object = _UNSET,
        completed_steps: int | object = _UNSET,
        expected_statuses: Sequence[str] | None = None,
        expected_sim_phase: str | None | object = _UNSET,
        complete: bool = False,
        checkpoint: bool = False,
    ) -> TransitionResult:
        """套用一次 simulator/driver 進展；complete=True 時原子清回 IDLE。"""
        lock = self._lock_for(device_id)
        if lock is None:
            return self._result(False, "missing", {}, {})

        async with lock:
            before = dict(self._cache[device_id])
            if expected_statuses is not None and before.get("status") not in expected_statuses:
                return self._result(False, "stale_status", before, before)
            if (
                expected_sim_phase is not _UNSET
                and before.get("sim_phase") != expected_sim_phase
            ):
                return self._result(False, "stale_sim_phase", before, before)

            after = dict(before)
            values = {
                "temperature": temperature,
                "humidity": humidity,
                "sim_phase": sim_phase,
                "sim_cycle": sim_cycle,
                "dwell_half_fired": dwell_half_fired,
                "dwell_high_start": dwell_high_start,
                "dwell_low_start": dwell_low_start,
                "completed_steps": completed_steps,
            }
            for field, value in values.items():
                if value is not _UNSET:
                    after[field] = value

            reason = "completed" if complete else "advanced"
            if complete:
                status = before.get("status")
                if status not in ("RUNNING", "FINISHING"):
                    return self._result(
                        False,
                        "invalid_completion_status",
                        before,
                        before,
                    )
                if (
                    status == "RUNNING"
                    and after.get("sim_phase") != "done"
                ):
                    return self._result(
                        False,
                        "incomplete_sim_phase",
                        before,
                        before,
                    )
                try:
                    at_ambient = (
                        abs(
                            float(after.get("temperature", AMBIENT_TEMP))
                            - AMBIENT_TEMP
                        )
                        <= 0.1
                    )
                except (TypeError, ValueError):
                    at_ambient = False
                if not at_ambient:
                    return self._result(
                        False,
                        "not_at_ambient",
                        before,
                        before,
                    )
                after.update(_idle_patch())

            if checkpoint or complete:
                await self._persist(device_id, after)
            if after == before:
                return self._result(False, "no_changes", before, before)

            self._publish(device_id, after)
            return self._result(True, reason, before, after)


__all__ = ["DeviceStateManager", "TransitionResult"]
