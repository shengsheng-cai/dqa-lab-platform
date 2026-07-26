"""DeviceStateManager 五動詞的行為契約。"""

import asyncio
import datetime
import inspect
import threading
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, event, inspect as inspect_database, text
from sqlalchemy.exc import OperationalError

from app import device_state
from app import models
from app.models import DeviceState, ErrorLog, SopExecution

UTC = datetime.timezone.utc


def _manager(status: str = "IDLE", **fields) -> device_state.DeviceStateManager:
    return device_state.DeviceStateManager({
        "CH-01": {
            "status": status,
            "temperature": 25.0,
            "humidity": 55.0,
            **fields,
        },
    })


def _start(states: device_state.DeviceStateManager, **overrides):
    values = {
        "sop_id": "iec60068_ab_-40_16h",
        "sop_name": "低溫測試",
        "active_sop_json": '{"x":1}',
        "total_steps": 5,
        "operator": "王小明",
        "operator_user_id": 7,
        "started_at": datetime.datetime(2026, 7, 25, tzinfo=UTC),
    }
    values.update(overrides)
    return asyncio.run(states.start("CH-01", **values))


def test_start_owns_fields_and_persists_restart_fields(patched_session):
    with patched_session("app.device_state") as Session:
        states = _manager(
            dwell_half_fired=True,
            dwell_high_start="2026-07-24T00:00:00+00:00",
            active_execution_id=99,
            skip_push=True,
        )

        result = _start(states, create_execution=lambda _db: 123)

        assert result.changed is True
        assert states["CH-01"]["status"] == "RUNNING"
        assert states["CH-01"]["active_execution_id"] == 123
        assert states["CH-01"]["total_steps"] == 5
        assert states["CH-01"]["dwell_half_fired"] is False
        assert states["CH-01"]["dwell_high_start"] is None
        assert states["CH-01"]["skip_push"] is False

        with Session() as db:
            row = db.get(DeviceState, "CH-01")
            assert row.status == "RUNNING"
            assert row.total_steps == 5
            assert row.operator == "王小明"
            assert row.operator_user_id == 7
            assert row.active_execution_id == 123
            assert row.started_at == datetime.datetime(2026, 7, 25)


def test_start_rejects_non_idle_without_writing(patched_session):
    with patched_session("app.device_state") as Session:
        states = _manager("PAUSED")

        result = _start(states)

        assert result.changed is False
        assert result.reason == "invalid_status"
        assert states["CH-01"]["status"] == "PAUSED"
        with Session() as db:
            assert db.get(DeviceState, "CH-01") is None


def test_start_execution_failure_leaves_db_and_cache_unchanged(patched_session):
    with patched_session("app.device_state") as Session:
        states = _manager()
        attempts = 0

        def fail_execution(_db):
            nonlocal attempts
            attempts += 1
            return None

        result = _start(states, create_execution=fail_execution)

        assert result.changed is False
        assert result.reason == "execution_failed"
        assert attempts == 3
        assert states["CH-01"]["status"] == "IDLE"
        with Session() as db:
            assert db.get(DeviceState, "CH-01") is None


def test_start_execution_exception_also_rolls_back(patched_session):
    with patched_session("app.device_state"):
        states = _manager()

        def fail(_db):
            raise RuntimeError("insert failed")

        result = _start(states, create_execution=fail)

        assert result.reason == "execution_failed"
        assert states["CH-01"]["status"] == "IDLE"


def test_start_state_and_execution_roll_back_together_on_commit_failure(
    patched_session,
):
    with patched_session("app.device_state") as Session:
        states = _manager()

        def create_execution(db):
            execution = SopExecution(
                sop_id="iec60068_ab_-40_16h",
                device_id="CH-01",
                operator="王小明",
                test_started_at=datetime.datetime(2026, 7, 25),
            )
            db.add(execution)
            db.flush()
            return execution.id

        def fail_commit(_session):
            raise RuntimeError("commit failed")

        event.listen(Session.class_, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="commit failed"):
                _start(states, create_execution=create_execution)
        finally:
            event.remove(Session.class_, "before_commit", fail_commit)

        assert states["CH-01"]["status"] == "IDLE"
        with Session() as db:
            assert db.query(DeviceState).count() == 0
            assert db.query(SopExecution).count() == 0


def test_start_repeated_cancellation_waits_for_commit_and_publishes_cache(
    patched_session,
):
    with patched_session("app.device_state") as Session:
        states = _manager()
        entered = threading.Event()
        release = threading.Event()

        def create_execution(db):
            execution = SopExecution(
                sop_id="iec60068_ab_-40_16h",
                device_id="CH-01",
                operator="王小明",
                test_started_at=datetime.datetime(2026, 7, 25),
            )
            db.add(execution)
            db.flush()
            return execution.id

        def block_before_commit(_db, _state):
            entered.set()
            assert release.wait(timeout=2)

        async def exercise():
            start_task = asyncio.create_task(states.start(
                "CH-01",
                sop_id="iec60068_ab_-40_16h",
                sop_name="低溫測試",
                active_sop_json='{"x":1}',
                total_steps=5,
                operator="王小明",
                operator_user_id=7,
                started_at=datetime.datetime(2026, 7, 25, tzinfo=UTC),
                create_execution=create_execution,
                before_commit=block_before_commit,
            ))
            assert await asyncio.to_thread(entered.wait, 1)

            start_task.cancel()
            try:
                await asyncio.sleep(0)
                assert start_task.done() is False
                start_task.cancel()
                await asyncio.sleep(0)
                assert start_task.done() is False
            finally:
                release.set()

            with pytest.raises(asyncio.CancelledError):
                await start_task

        asyncio.run(exercise())

        assert states["CH-01"]["status"] == "RUNNING"
        assert states["CH-01"]["active_execution_id"] is not None
        with Session() as db:
            saved_state = db.get(DeviceState, "CH-01")
            execution = db.query(SopExecution).one()
            assert saved_state.status == "RUNNING"
            assert saved_state.active_execution_id == execution.id
            assert states["CH-01"]["active_execution_id"] == execution.id


def test_pause_toggles_and_rejects_invalid_status(patched_session):
    with patched_session("app.device_state"):
        states = _manager("RUNNING")

        paused = asyncio.run(states.pause("CH-01"))
        resumed = asyncio.run(states.pause("CH-01"))

        assert paused.reason == "paused"
        assert paused.after["status"] == "PAUSED"
        assert resumed.reason == "resumed"
        assert states["CH-01"]["status"] == "RUNNING"

        idle = _manager("IDLE")
        rejected = asyncio.run(idle.pause("CH-01"))
        assert rejected.reason == "invalid_status"
        assert idle["CH-01"]["status"] == "IDLE"


def test_pause_accumulation_persists_and_restores(patched_session):
    """暫停→恢復把這段時間結算進累計，落盤且重啟後還原得回來"""
    with patched_session("app.device_state") as Session:
        states = _manager("RUNNING")
        t0 = datetime.datetime(2026, 7, 26, 10, 0, tzinfo=UTC)
        t1 = datetime.datetime(2026, 7, 26, 11, 0, tzinfo=UTC)  # 暫停 1 小時
        with patch("app.device_state._now_utc", return_value=t0):
            asyncio.run(states.pause("CH-01"))
        assert states["CH-01"]["status"] == "PAUSED"
        assert states["CH-01"]["paused_at"] == t0
        with patch("app.device_state._now_utc", return_value=t1):
            asyncio.run(states.pause("CH-01"))  # 恢復
        assert states["CH-01"]["status"] == "RUNNING"
        assert states["CH-01"]["paused_at"] is None
        assert states["CH-01"]["pause_accum_seconds"] == 3600.0

        with Session() as db:
            row = db.get(DeviceState, "CH-01")
            assert row.paused_at is None
            assert row.pause_accum_seconds == 3600.0

        restored = device_state.DeviceStateManager.restore(["CH-01"])
        assert restored["CH-01"]["pause_accum_seconds"] == 3600.0
        assert restored["CH-01"]["paused_at"] is None


def test_pause_restores_paused_at_when_still_paused(patched_session):
    """重啟時仍在暫停：paused_at 要還原，估算才知道暫停還在進行中"""
    with patched_session("app.device_state"):
        states = _manager("RUNNING")
        t0 = datetime.datetime(2026, 7, 26, 10, 0, tzinfo=UTC)
        with patch("app.device_state._now_utc", return_value=t0):
            asyncio.run(states.pause("CH-01"))
        restored = device_state.DeviceStateManager.restore(["CH-01"])
        assert restored["CH-01"]["status"] == "PAUSED"
        assert restored["CH-01"]["paused_at"] == t0


def test_advance_persists_stab_start(patched_session):
    """常溫穩定的計時起點 stab_start 要經 advance 落盤並能還原。

    以前 advance 沒有 stab_start 參數，模擬器算出來的起點在 advance 被丟掉、DB 永遠是
    None，重啟到一半會重跑整個 30 分鐘。這裡守住它有真的流過 advance→cache→DB→restore。
    """
    with patched_session("app.device_state") as Session:
        states = _manager("RUNNING", sim_phase="ramp_to_ambient")
        stab = datetime.datetime(2026, 7, 26, 10, 0, tzinfo=UTC)
        result = asyncio.run(states.advance(
            "CH-01",
            sim_phase="stabilize",
            stab_start=stab,
            expected_statuses=("RUNNING",),
            checkpoint=True,
        ))
        assert result.changed
        assert states["CH-01"]["stab_start"] == stab
        with Session() as db:
            assert db.get(DeviceState, "CH-01").stab_start is not None
        restored = device_state.DeviceStateManager.restore(["CH-01"])
        assert restored["CH-01"]["stab_start"] is not None


def test_finish_from_paused_settles_pause(patched_session):
    """從暫停中收尾：最後一段暫停要結算進累計、paused_at 清掉"""
    with patched_session("app.device_state"):
        states = _manager("RUNNING")
        t0 = datetime.datetime(2026, 7, 26, 10, 0, tzinfo=UTC)
        t1 = datetime.datetime(2026, 7, 26, 10, 30, tzinfo=UTC)  # 暫停 30 分鐘後收尾
        with patch("app.device_state._now_utc", return_value=t0):
            asyncio.run(states.pause("CH-01"))
        with patch("app.device_state._now_utc", return_value=t1):
            asyncio.run(states.finish("CH-01"))
        assert states["CH-01"]["status"] == "FINISHING"
        assert states["CH-01"]["paused_at"] is None
        assert states["CH-01"]["pause_accum_seconds"] == 1800.0


def test_finish_keeps_normal_and_cancelled_semantics(patched_session):
    with patched_session("app.device_state"):
        normal = _manager("RUNNING", completed_steps=3, standard_id="sop-1")
        result = asyncio.run(normal.finish("CH-01"))

        assert result.after["status"] == "FINISHING"
        assert result.after["running_sop_name"] == "系統自動降溫收尾中..."
        assert result.after["completed_steps"] == 0
        assert result.after["standard_id"] is None
        assert result.after["skip_push"] is False

        cancelled = _manager("PAUSED", completed_steps=3, standard_id="sop-1")
        result = asyncio.run(cancelled.finish("CH-01", cancelled=True, notify=False))

        assert result.after["running_sop_name"] == "排程取消，降溫收尾中..."
        assert result.after["completed_steps"] == 3
        assert result.after["standard_id"] == "sop-1"
        assert result.after["skip_push"] is True


def test_emergency_is_idempotent_and_preserves_execution_metadata(patched_session):
    with patched_session("app.device_state"):
        states = _manager(
            "RUNNING",
            running_sop_id="sop-1",
            active_execution_id=88,
            standard_id="sop-1",
            total_steps=4,
        )

        first = asyncio.run(states.emergency("CH-01"))
        second = asyncio.run(states.emergency("CH-01"))

        assert first.changed is True
        assert first.after["status"] == "EMERGENCY"
        assert first.after["running_sop_id"] is None
        assert first.after["total_steps"] == 0
        assert first.after["active_execution_id"] == 88
        assert first.after["standard_id"] == "sop-1"
        assert second.changed is False
        assert second.reason == "already_emergency"


def test_emergency_stops_hardware_before_atomic_state_and_audit_commit(
    patched_session,
):
    with patched_session("app.device_state") as Session:
        states = _manager("RUNNING", running_sop_name="低溫測試")
        calls: list[str] = []

        async def stop_hardware():
            calls.append("stop")

        def record(db, before):
            calls.append("record")
            db.add(ErrorLog(
                device_id="CH-01",
                error_type="EMERGENCY",
                sop_name=before["running_sop_name"],
            ))

        first = asyncio.run(states.emergency(
            "CH-01",
            stop=stop_hardware,
            record=record,
        ))
        second = asyncio.run(states.emergency(
            "CH-01",
            stop=stop_hardware,
            record=record,
        ))

        assert first.changed is True
        assert second.reason == "already_emergency"
        assert calls == ["stop", "record"]
        with Session() as db:
            assert db.get(DeviceState, "CH-01").status == "EMERGENCY"
            assert db.query(ErrorLog).count() == 1


def test_emergency_record_failure_keeps_state_retryable(patched_session):
    with patched_session("app.device_state") as Session:
        states = _manager("RUNNING")
        stop_calls = 0

        async def stop_hardware():
            nonlocal stop_calls
            stop_calls += 1

        def fail_record(_db, _before):
            raise RuntimeError("audit failed")

        with pytest.raises(RuntimeError, match="audit failed"):
            asyncio.run(states.emergency(
                "CH-01",
                stop=stop_hardware,
                record=fail_record,
            ))

        assert stop_calls == 1
        assert states["CH-01"]["status"] == "RUNNING"
        with Session() as db:
            assert db.get(DeviceState, "CH-01") is None


def test_advance_updates_typed_fields_and_complete_clears_state(patched_session):
    with patched_session("app.device_state"):
        states = _manager(
            "RUNNING",
            running_sop_id="sop-1",
            running_sop_name="低溫測試",
            active_execution_id=44,
            total_steps=5,
        )

        advanced = asyncio.run(states.advance(
            "CH-01",
            temperature=-10.0,
            humidity=20.0,
            sim_phase="dwell_high",
            sim_cycle=2,
            dwell_half_fired=True,
            completed_steps=3,
            checkpoint=True,
        ))
        completed = asyncio.run(states.advance(
            "CH-01",
            temperature=25.0,
            sim_phase="done",
            expected_statuses=("RUNNING",),
            complete=True,
        ))

        assert advanced.after["temperature"] == -10.0
        assert advanced.after["completed_steps"] == 3
        assert completed.reason == "completed"
        assert completed.before["active_execution_id"] == 44
        assert completed.before["running_sop_name"] == "低溫測試"
        assert completed.after["status"] == "IDLE"
        assert completed.after["active_execution_id"] is None
        assert completed.after["total_steps"] == 0
        assert completed.after["temperature"] == 25.0


def test_complete_enforces_state_phase_and_ambient_invariants(patched_session):
    with patched_session("app.device_state"):
        emergency = _manager("EMERGENCY", sim_phase="done")
        wrong_status = asyncio.run(emergency.advance(
            "CH-01",
            temperature=25.0,
            complete=True,
        ))

        running = _manager("RUNNING", sim_phase="ramp_to_ambient")
        wrong_phase = asyncio.run(running.advance(
            "CH-01",
            temperature=25.0,
            complete=True,
        ))
        too_hot = asyncio.run(running.advance(
            "CH-01",
            temperature=30.0,
            sim_phase="done",
            complete=True,
        ))

        finishing = _manager("FINISHING", sim_phase="ramp_to_ambient")
        finished = asyncio.run(finishing.advance(
            "CH-01",
            temperature=25.0,
            complete=True,
        ))

    assert wrong_status.reason == "invalid_completion_status"
    assert emergency["CH-01"]["status"] == "EMERGENCY"
    assert wrong_phase.reason == "incomplete_sim_phase"
    assert too_hot.reason == "not_at_ambient"
    assert running["CH-01"]["status"] == "RUNNING"
    assert finished.reason == "completed"
    assert finishing["CH-01"]["status"] == "IDLE"


def test_checkpoint_persists_even_when_rounded_values_are_unchanged(
    patched_session,
):
    with patched_session("app.device_state") as Session:
        states = _manager("RUNNING")
        commits = 0

        def count_commit(_session):
            nonlocal commits
            commits += 1

        event.listen(Session.class_, "before_commit", count_commit)
        try:
            result = asyncio.run(states.advance(
                "CH-01",
                temperature=25.0,
                humidity=55.0,
                checkpoint=True,
            ))
        finally:
            event.remove(Session.class_, "before_commit", count_commit)

        assert result.changed is False
        assert result.reason == "no_changes"
        assert commits == 1
        with Session() as db:
            assert db.get(DeviceState, "CH-01").status == "RUNNING"


def test_restore_keeps_total_steps_and_skip_push(patched_session):
    with patched_session("app.device_state"):
        states = _manager()
        _start(states)
        asyncio.run(states.finish("CH-01", cancelled=True, notify=False))

        restored = device_state.DeviceStateManager.restore(["CH-01"])

        assert restored["CH-01"]["status"] == "FINISHING"
        assert restored["CH-01"]["total_steps"] == 5
        assert restored["CH-01"]["skip_push"] is True
        assert restored["CH-01"]["operator"] == "王小明"
        assert restored["CH-01"]["operator_user_id"] == 7


def test_persistence_runs_in_worker_thread(patched_session):
    with patched_session("app.device_state") as Session:
        states = _manager("RUNNING")
        caller_thread = threading.get_ident()
        worker_threads: list[int] = []

        def record_commit_thread(_session):
            worker_threads.append(threading.get_ident())

        event.listen(Session.class_, "before_commit", record_commit_thread)
        asyncio.run(states.pause("CH-01"))
        event.remove(Session.class_, "before_commit", record_commit_thread)

    assert worker_threads
    assert worker_threads[0] != caller_thread


def test_per_device_lock_serializes_persistence_snapshots(patched_session):
    with patched_session("app.device_state") as Session:
        states = _manager("RUNNING")
        entered = threading.Event()
        release = threading.Event()
        persisted: list[str] = []

        def block_first_commit(session):
            changed = [
                value
                for value in (*session.new, *session.dirty)
                if isinstance(value, DeviceState)
            ]
            if not changed:
                return
            persisted.append(changed[0].status)
            if len(persisted) == 1:
                entered.set()
                assert release.wait(timeout=2)

        async def exercise():
            first = asyncio.create_task(states.pause("CH-01"))
            assert await asyncio.to_thread(entered.wait, 1)
            second = asyncio.create_task(states.pause("CH-01"))
            await asyncio.sleep(0.05)
            assert second.done() is False
            # cache 只在落盤成功後發布，不會先露出半套狀態
            assert states["CH-01"]["status"] == "RUNNING"
            release.set()
            await asyncio.gather(first, second)

        event.listen(Session.class_, "before_commit", block_first_commit)
        asyncio.run(exercise())
        event.remove(Session.class_, "before_commit", block_first_commit)

    assert persisted == ["PAUSED", "RUNNING"]
    assert states["CH-01"]["status"] == "RUNNING"


def test_one_device_lock_does_not_block_another_device(patched_session):
    with patched_session("app.device_state") as Session:
        states = device_state.DeviceStateManager({
            "CH-01": {"status": "RUNNING"},
            "CH-02": {"status": "RUNNING"},
        })
        entered = threading.Event()
        release = threading.Event()

        def block_first_device(session):
            changed = [
                value
                for value in (*session.new, *session.dirty)
                if isinstance(value, DeviceState)
            ]
            if changed and changed[0].device_id == "CH-01":
                entered.set()
                assert release.wait(timeout=2)

        async def exercise():
            first = asyncio.create_task(states.pause("CH-01"))
            assert await asyncio.to_thread(entered.wait, 1)
            second = await asyncio.wait_for(states.pause("CH-02"), timeout=0.5)
            assert second.after["status"] == "PAUSED"
            release.set()
            await first

        event.listen(Session.class_, "before_commit", block_first_device)
        asyncio.run(exercise())
        event.remove(Session.class_, "before_commit", block_first_device)


def test_persistence_failure_does_not_publish_cache_change(patched_session):
    with patched_session("app.device_state") as Session:
        states = _manager()
        with Session() as db:
            db.execute(text("DROP TABLE device_states"))
            db.commit()

        with pytest.raises(OperationalError):
            _start(states)

    assert states["CH-01"]["status"] == "IDLE"


def test_old_patch_and_save_escape_hatches_are_not_public():
    for name in ("save", "idle_patch", "running_patch", "emergency_patch", "finishing_patch"):
        assert not hasattr(device_state, name)


def test_public_async_mutation_interface_is_exactly_five_verbs():
    public_async = {
        name
        for name, member in inspect.getmembers(
            device_state.DeviceStateManager,
            inspect.iscoroutinefunction,
        )
        if not name.startswith("_")
    }
    assert public_async == {"start", "finish", "pause", "emergency", "advance"}


def test_readers_receive_immutable_snapshots():
    states = _manager()
    snapshot = states["CH-01"]

    with pytest.raises(TypeError):
        snapshot["status"] = "RUNNING"

    assert states["CH-01"]["status"] == "IDLE"


def test_constructor_does_not_keep_mutable_cache_alias():
    raw = {"CH-01": {"status": "IDLE", "temperature": 25.0}}
    states = device_state.DeviceStateManager(raw)

    raw["CH-01"]["status"] = "RUNNING"
    raw["CH-02"] = {"status": "EMERGENCY"}

    assert states["CH-01"]["status"] == "IDLE"
    assert "CH-02" not in states


def test_advance_rejects_stale_simulator_phase(patched_session):
    with patched_session("app.device_state"):
        states = _manager("RUNNING", sim_phase="ramp_up")
        manual = asyncio.run(states.advance("CH-01", sim_phase="ramp_down"))
        stale_tick = asyncio.run(states.advance(
            "CH-01",
            sim_phase="dwell_high",
            expected_statuses=("RUNNING",),
            expected_sim_phase="ramp_up",
        ))

    assert manual.changed is True
    assert stale_tick.changed is False
    assert stale_tick.reason == "stale_sim_phase"
    assert states["CH-01"]["sim_phase"] == "ramp_down"


def test_existing_device_state_table_gets_new_columns():
    old_engine = create_engine("sqlite:///:memory:")
    with old_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE device_states (device_id VARCHAR PRIMARY KEY, status VARCHAR)"
        )
        connection.exec_driver_sql(
            "INSERT INTO device_states (device_id, status) VALUES ('CH-01', 'RUNNING')"
        )

    with patch("app.models.engine", old_engine):
        models._ensure_device_state_columns()
        models._ensure_device_state_columns()

    columns = {
        column["name"]
        for column in inspect_database(old_engine).get_columns("device_states")
    }
    assert {"total_steps", "operator", "operator_user_id", "skip_push"} <= columns
    with old_engine.connect() as connection:
        row = connection.exec_driver_sql(
            "SELECT total_steps, skip_push FROM device_states WHERE device_id = 'CH-01'"
        ).one()
    assert row == (0, 0)
