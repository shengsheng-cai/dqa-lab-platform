"""
排程狀態必須與設備真實狀態一致。

APScheduler 到點觸發 _start_schedule_by_id 時，若設備當下不是 IDLE
（上一個測試仍在收尾、人工接管、EMERGENCY），start_schedule 會回 DEVICE_BUSY。
此時排程不得停留在「進行中」——否則畫面顯示測試中，設備卻是空的，
且 5 分鐘 fallback 不會再重試（fallback 只掃 CONFIRMED）。
"""
import asyncio
import datetime
import time
from unittest.mock import patch

import pytest

from app.device_state import DeviceStateManager
from app.models import (
    AuditLog,
    DeviceBlockedPeriod,
    DeviceState,
    Fixture,
    FixtureLoan,
    Schedule,
    ScheduleStatus,
    SopExecution,
)
from app.schedule_service import (
    ScheduleStartActor,
    ScheduleStartCode,
    _start_schedule_by_id,
    auto_advance_schedules,
    start_schedule,
)
from app.schedules import router as schedules_router
from app.sop import router as sop_router
from app.utils import _now_utc_naive

SYSTEM_ACTOR = ScheduleStartActor(actor="system:scheduler")


@pytest.fixture()
def session_factory(patched_session):
    # 啟動流程會跨多個模組寫 DB：schedule_service（排程）、sop（SopExecution）、
    # device_state（device_states 落盤）、utils（維護時段查詢）、schedules（手動 /start 路由）。
    # 全部一起 patch，少一個那個模組就會寫進真實的 aicm.db。
    with patched_session(
        "app.schedule_service", "app.sop", "app.device_state", "app.utils", "app.schedules",
    ) as TestSession:
        yield TestSession


def _seed_confirmed(Session, device_id="CH-01", start=None, conditions='["iec60068_ab_-40_16h"]') -> int:
    """start 預設為過去時間，讓 fallback（只撈 start_time <= now）也能撈到。

    conditions 可傳 None／'[]' 模擬缺條件的壞排程（一般 API 路徑生不出來）。
    """
    start = start or _now_utc_naive() - datetime.timedelta(minutes=10)
    with Session() as db:
        s = Schedule(
            project_number="P-001",
            sample_name="樣品",
            device_id=device_id,
            standard="IEC 60068",
            conditions=conditions,
            start_time=start,
            end_time=start + datetime.timedelta(hours=8),
            status=ScheduleStatus.CONFIRMED,
        )
        db.add(s)
        db.commit()
        return s.id


def _status(Session, sid) -> str:
    with Session() as db:
        return db.query(Schedule).filter(Schedule.id == sid).first().status


def _busy_cache(status="FINISHING"):
    """設備正在收尾，不是 IDLE。"""
    return {"CH-01": {"status": status, "sim_phase": "ramp_to_ambient"}}


def _states(cache):
    return DeviceStateManager(cache)


def test_start_does_not_mark_running_when_device_busy(session_factory):
    """設備非 IDLE → 排程必須留在「已確認」，讓 fallback 稍後重試。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    cache = _busy_cache()
    states = _states(cache)

    asyncio.run(_start_schedule_by_id(sid, states))

    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "設備仍在收尾，排程卻已標為進行中：畫面顯示測試中但設備是空的，"
        "且 fallback 只掃 CONFIRMED，不會再重試"
    )
    assert states["CH-01"]["status"] == "FINISHING", "不得覆蓋設備既有狀態"


def test_start_marks_running_when_device_idle(session_factory):
    """設備 IDLE → 正常啟動，排程轉進行中、設備轉 RUNNING。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    cache = {"CH-01": {"status": "IDLE"}}
    states = _states(cache)

    asyncio.run(_start_schedule_by_id(sid, states))

    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert states["CH-01"]["status"] == "RUNNING"


# ── 維護（不可用）時段：自動啟動也要尊重，不能只擋手動 ────────────────────────


def _seed_blocked(Session, device_id="CH-01", reason="校驗中"):
    """在 device_id 上插入一段涵蓋『當下』的不可用（維護）時段。"""
    now = _now_utc_naive()
    with Session() as db:
        db.add(DeviceBlockedPeriod(
            device_id=device_id,
            start_time=now - datetime.timedelta(hours=1),
            end_time=now + datetime.timedelta(hours=1),
            reason=reason,
        ))
        db.commit()


def test_start_skipped_when_device_in_maintenance(session_factory):
    """設備 IDLE 但當下在維護時段 → 不自動啟動，排程維持「已確認」。

    手動 start_sop 早就會擋維護；自動這條若不擋，維護等於白標，
    測試到點照樣跑在維護中的機器上。
    """
    Session = session_factory
    sid = _seed_confirmed(Session)
    _seed_blocked(Session)
    cache = {"CH-01": {"status": "IDLE"}}
    states = _states(cache)

    asyncio.run(_start_schedule_by_id(sid, states))

    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "設備標了維護，排程卻自動啟動：測試會跑在維護中的機器上"
    )
    assert states["CH-01"]["status"] == "IDLE", "維護中不得啟動設備"


def test_start_skipped_when_maintenance_has_no_reason(session_factory):
    """維護時段的 reason 可為空（欄位 nullable、建立時可不填）→ 仍須擋住自動啟動。

    有無封鎖只看時段存在與否，不能拿 reason 當判準。
    """
    Session = session_factory
    sid = _seed_confirmed(Session)
    _seed_blocked(Session, reason=None)
    cache = {"CH-01": {"status": "IDLE"}}
    states = _states(cache)

    asyncio.run(_start_schedule_by_id(sid, states))

    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "沒填原因的維護時段被當成沒封鎖，測試照樣自動啟動"
    )
    assert states["CH-01"]["status"] == "IDLE"


def test_maintenance_keeps_confirmed_then_resumes(session_factory):
    """維護是暫時性阻擋：撞維護維持 CONFIRMED（不轉「異常」）；維護結束後應能重試啟動。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    _seed_blocked(Session)

    asyncio.run(auto_advance_schedules(_states({"CH-01": {"status": "IDLE"}})))
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "維護會結束，屬暫時性阻擋，不該轉『異常』終止重試"
    )

    with Session() as db:  # 維護時段結束（移除）
        db.query(DeviceBlockedPeriod).delete()
        db.commit()
    idle = {"CH-01": {"status": "IDLE"}}
    states = _states(idle)
    asyncio.run(auto_advance_schedules(states))
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert states["CH-01"]["status"] == "RUNNING"


def test_fallback_retries_after_device_frees_up(session_factory):
    """設備忙 → 排程留 CONFIRMED；設備空出來後，fallback 應能成功啟動。"""
    Session = session_factory
    sid = _seed_confirmed(Session)

    busy = _busy_cache()
    asyncio.run(auto_advance_schedules(_states(busy)))
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED

    idle = {"CH-01": {"status": "IDLE"}}
    states = _states(idle)
    asyncio.run(auto_advance_schedules(states))
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert states["CH-01"]["status"] == "RUNNING"


def test_fallback_starts_earliest_due_schedule_first(session_factory):
    """同設備多筆到期排程必須按開始時間序列啟動，不能讓較晚者搶先拿 lock。"""
    Session = session_factory
    now = _now_utc_naive()
    earlier = _seed_confirmed(Session, start=now - datetime.timedelta(hours=2))
    later = _seed_confirmed(Session, start=now - datetime.timedelta(hours=1))
    states = _states({"CH-01": {"status": "IDLE"}})

    from app import schedule_service

    original_load = schedule_service._load_schedule_start_plan

    def delayed_load(schedule_id, *, continuation, actor):
        if schedule_id == earlier:
            time.sleep(0.05)
        return original_load(
            schedule_id,
            continuation=continuation,
            actor=actor,
        )

    with patch(
        "app.schedule_service._load_schedule_start_plan",
        side_effect=delayed_load,
    ):
        asyncio.run(auto_advance_schedules(states))

    assert _status(Session, earlier) == ScheduleStatus.RUNNING
    assert _status(Session, later) == ScheduleStatus.CONFIRMED


# ── 壞排程收斂：缺設備/條件 → 轉「異常」，不無限重試 ──────────────────────────


def _audit_count(Session, sid, action="ERROR") -> int:
    with Session() as db:
        return (
            db.query(AuditLog)
            .filter(AuditLog.entity_type == "schedule",
                    AuditLog.entity_id == str(sid),
                    AuditLog.action == action)
            .count()
        )


def test_broken_schedule_missing_device_becomes_error(session_factory):
    """已確認排程缺 device_id → fallback 應轉「異常」並寫 audit，而非卡著重試。"""
    Session = session_factory
    sid = _seed_confirmed(Session, device_id=None)

    asyncio.run(auto_advance_schedules(_states({"CH-01": {"status": "IDLE"}})))

    assert _status(Session, sid) == ScheduleStatus.ERROR, (
        "缺設備的排程沒被收斂：會每 5 分鐘重試、永遠停在「已確認」，畫面也看不出壞掉"
    )
    assert _audit_count(Session, sid) == 1, "轉異常必須留一筆稽核紀錄供追查"


def test_broken_schedule_missing_conditions_becomes_error(session_factory):
    """已確認排程 conditions 為空 → 同樣轉「異常」。"""
    Session = session_factory
    sid = _seed_confirmed(Session, conditions="[]")

    asyncio.run(auto_advance_schedules(_states({"CH-01": {"status": "IDLE"}})))

    assert _status(Session, sid) == ScheduleStatus.ERROR


def test_error_schedule_not_retried(session_factory):
    """轉「異常」後退出 CONFIRMED，後續 fallback 不得再撿它、不得重複寫 audit。"""
    Session = session_factory
    sid = _seed_confirmed(Session, device_id=None)

    asyncio.run(auto_advance_schedules(_states({"CH-01": {"status": "IDLE"}})))
    asyncio.run(auto_advance_schedules(_states({"CH-01": {"status": "IDLE"}})))

    assert _status(Session, sid) == ScheduleStatus.ERROR
    assert _audit_count(Session, sid) == 1, "已是異常的排程不該被重複處理、重複寫 audit"


def test_error_schedule_releases_reserved_fixtures(session_factory):
    """壞排程轉「異常」時，先前預約（reserved）的治具要放回去。

    否則排程永遠不會啟動、治具也永遠卡在 reserved，可借量被扣住不回收——
    比照「取消」路徑的釋放行為。
    """
    Session = session_factory
    sid = _seed_confirmed(Session, device_id=None)
    loan_id = _seed_reserved_fixture(Session, sid)

    asyncio.run(auto_advance_schedules(_states({"CH-01": {"status": "IDLE"}})))

    assert _status(Session, sid) == ScheduleStatus.ERROR
    with Session() as db:
        assert db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first() is None, (
            "轉異常沒放掉 reserved 治具：可借量被永久扣住、借不回來"
        )


def test_broken_schedule_error_write_failure_returns_typed_retryable_result(session_factory):
    """ERROR audit/commit 寫不進去時不得 raw raise；caller 要拿到可重試的 typed result。"""
    Session = session_factory
    sid = _seed_confirmed(Session, device_id=None)
    states = _states({"CH-01": {"status": "IDLE"}})

    with patch(
        "app.schedule_service.log_audit",
        side_effect=RuntimeError("audit unavailable"),
    ):
        result = asyncio.run(start_schedule(sid, SYSTEM_ACTOR, states))

    assert result.code == ScheduleStartCode.RETRYABLE_FAILURE
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED


# ── 治具轉借必須認排程，不能認設備 ────────────────────────────────────────────


def _seed_reserved_fixture(Session, schedule_id: int) -> int:
    with Session() as db:
        f = Fixture(interface_type="USB", form_factor="Desktop", total_quantity=5, is_active=True)
        db.add(f)
        db.flush()
        loan = FixtureLoan(
            fixture_id=f.id,
            borrower_name="排程系統",
            quantity=1,
            status="reserved",
            schedule_id=schedule_id,
        )
        db.add(loan)
        db.commit()
        return loan.id


def _loan_status(Session, loan_id: int) -> str:
    with Session() as db:
        return db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first().status


def test_start_loans_only_its_own_fixtures(session_factory):
    """同一台設備上有另一筆已確認排程時，不得把治具借給那一筆。"""
    Session = session_factory
    other = _seed_confirmed(Session)           # 同設備、較早建立的另一筆已確認排程
    target = _seed_confirmed(Session)
    other_loan = _seed_reserved_fixture(Session, other)
    target_loan = _seed_reserved_fixture(Session, target)

    cache = {"CH-01": {"status": "IDLE"}}
    asyncio.run(start_schedule(
        target,
        SYSTEM_ACTOR,
        _states(cache),
    ))

    assert _loan_status(Session, target_loan) == "loaned", "啟動的排程治具應轉為借出"
    assert _loan_status(Session, other_loan) == "reserved", (
        "治具被借給了同設備上的另一筆排程——轉借依 device_id 猜排程會借錯人"
    )


def test_concurrent_starts_on_same_device_only_start_one_schedule(session_factory):
    """同設備兩筆同時啟動時，device lock 只允許一筆完成完整 transaction。"""
    Session = session_factory
    first = _seed_confirmed(Session)
    second = _seed_confirmed(Session)
    first_loan = _seed_reserved_fixture(Session, first)
    second_loan = _seed_reserved_fixture(Session, second)
    states = _states({"CH-01": {"status": "IDLE"}})

    async def _start_both():
        return await asyncio.gather(
            start_schedule(first, SYSTEM_ACTOR, states),
            start_schedule(second, SYSTEM_ACTOR, states),
        )

    results = asyncio.run(_start_both())

    assert sorted(result.code for result in results) == [
        ScheduleStartCode.DEVICE_BUSY,
        ScheduleStartCode.STARTED,
    ]
    started_id = next(result.schedule_id for result in results if result.started)
    waiting_id = second if started_id == first else first
    started_loan = first_loan if started_id == first else second_loan
    waiting_loan = second_loan if waiting_id == second else first_loan
    assert _status(Session, started_id) == ScheduleStatus.RUNNING
    assert _status(Session, waiting_id) == ScheduleStatus.CONFIRMED
    assert _loan_status(Session, started_loan) == "loaned"
    assert _loan_status(Session, waiting_loan) == "reserved"


# ── 手動「▶ 立即開始」（POST /{id}/start）─────────────────────────────────────


def _make_client(router, cache):
    """掛指定 router 的 admin TestClient，注入設備 cache。

    DB 不在這裡建：這些測試的 SessionLocal 已由 session_factory 跨模組 patch 好，
    所以只負責架 app，不像 conftest 的 api_client 那樣自己開一個 in-memory DB。
    """
    from fastapi import FastAPI, Request
    from fastapi.testclient import TestClient
    from starlette.middleware.base import BaseHTTPMiddleware

    app = FastAPI()

    class RoleMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            request.state.user_role = "admin"
            request.state.user_id = 1
            request.state.username = "admin"
            return await call_next(request)

    app.add_middleware(RoleMiddleware)
    app.include_router(router)
    states = cache if isinstance(cache, DeviceStateManager) else _states(cache)
    app.state.DEVICE_STATE = states
    app.state.AICM_CACHE = states
    return TestClient(app)


class _FakeScheduler:
    def __init__(self):
        self.jobs = []

    def add_job(self, func, **options):
        self.jobs.append((func, options))


def test_manual_start_rejects_busy_device(session_factory):
    """設備非 IDLE → 手動啟動回 409，排程維持「已確認」等 fallback 重試。"""
    Session = session_factory
    sid = _seed_confirmed(Session)

    client = _make_client(schedules_router, _busy_cache())
    resp = client.post(f"/api/schedules/{sid}/start")

    assert resp.status_code == 409, f"設備忙碌時不得回報啟動成功，實際 {resp.status_code}"
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "啟動失敗卻把排程標為進行中：畫面顯示測試中但設備沒動，且 fallback 不會重試"
    )


def test_manual_start_succeeds_on_idle_device(session_factory):
    """設備 IDLE → 正常啟動，排程轉進行中。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    cache = {"CH-01": {"status": "IDLE"}}
    states = _states(cache)

    client = _make_client(schedules_router, states)
    resp = client.post(f"/api/schedules/{sid}/start")

    assert resp.status_code == 200
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert states["CH-01"]["status"] == "RUNNING"


def test_manual_schedule_start_audit_uses_authenticated_actor(session_factory):
    """真人按立即開始時，audit 必須記真人，不得偽裝成 scheduler。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    states = _states({"CH-01": {"status": "IDLE"}})

    client = _make_client(schedules_router, states)
    resp = client.post(f"/api/schedules/{sid}/start")

    assert resp.status_code == 200
    with Session() as db:
        audit = db.query(AuditLog).filter(
            AuditLog.entity_type == "schedule",
            AuditLog.entity_id == str(sid),
            AuditLog.action == "START",
        ).one()
        assert audit.actor == "1"
        assert audit.role == "admin"
        assert audit.actor != "system:scheduler"


def test_manual_start_rejects_maintenance_device(session_factory):
    """設備 IDLE 但當下在維護時段 → 手動「立即開始」要擋下（409、排程維持「已確認」），
    而且訊息要講「維護中」，不能回「IDLE…非待機狀態」那種自相矛盾又不提維護的話。

    自動路徑早有涵蓋（test_start_skipped_when_device_in_maintenance）；手動 HTTP 這條
    有自己的錯誤回應，之前只測了「忙碌設備」沒測「維護設備」，補這條把「手動也尊重維護、
    而且把話講對」一起鎖住。
    """
    Session = session_factory
    sid = _seed_confirmed(Session)
    _seed_blocked(Session, reason="校驗中")  # CH-01 插一段涵蓋當下的維護時段
    cache = {"CH-01": {"status": "IDLE"}}
    states = _states(cache)

    client = _make_client(schedules_router, states)
    resp = client.post(f"/api/schedules/{sid}/start")

    assert resp.status_code == 409, f"維護中不得回報啟動成功，實際 {resp.status_code}"
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "維護中卻把排程標為進行中：畫面顯示測試中但設備在維護、根本沒動"
    )
    assert states["CH-01"]["status"] == "IDLE", "維護中不得啟動設備"

    detail = resp.json()["detail"]
    assert "維護" in detail and "校驗中" in detail, f"擋是擋了，但訊息沒講維護原因：{detail}"
    assert "非待機" not in detail, (
        f"維護中的 IDLE 設備不該收到「非待機狀態」這種自相矛盾的訊息：{detail}"
    )


def test_confirm_condition_blocks_next_sop_during_maintenance(session_factory):
    """第 2..N 條件也要經過同一個維護檢查，不能在保養中的設備上啟動。"""
    Session = session_factory
    sop_id = "iec60068_ab_-40_16h"
    sid = _seed_confirmed(Session, conditions=f'["{sop_id}", "{sop_id}"]')
    with Session() as db:
        schedule = db.get(Schedule, sid)
        schedule.status = ScheduleStatus.RUNNING
        schedule.current_condition_index = 1
        db.commit()
    _seed_blocked(Session, reason="條件間校驗")
    states = _states({"CH-01": {"status": "IDLE"}})

    client = _make_client(schedules_router, states)
    resp = client.post(f"/api/schedules/{sid}/confirm-condition")

    assert resp.status_code == 409, resp.text
    assert "維護" in resp.json()["detail"]
    assert "條件間校驗" in resp.json()["detail"]
    assert states["CH-01"]["status"] == "IDLE"
    with Session() as db:
        assert db.query(SopExecution).count() == 0
        assert db.query(AuditLog).filter(
            AuditLog.entity_id == str(sid),
            AuditLog.action == "START_CONDITION",
        ).count() == 0


def test_confirm_condition_starts_next_sop_with_real_actor(session_factory):
    """下一條件走同一 seam，保留既有借出紀錄並用真人 actor 寫啟動 audit。"""
    Session = session_factory
    sop_id = "iec60068_ab_-40_16h"
    sid = _seed_confirmed(Session, conditions=f'["{sop_id}", "{sop_id}"]')
    loan_id = _seed_reserved_fixture(Session, sid)
    original_loan_date = datetime.datetime(2026, 7, 1, 8, 0, 0)
    with Session() as db:
        schedule = db.get(Schedule, sid)
        schedule.status = ScheduleStatus.RUNNING
        schedule.current_condition_index = 1
        loan = db.get(FixtureLoan, loan_id)
        loan.status = "loaned"
        loan.loan_date = original_loan_date
        db.commit()

    states = _states({"CH-01": {"status": "IDLE"}})
    client = _make_client(schedules_router, states)
    resp = client.post(f"/api/schedules/{sid}/confirm-condition")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "started", "sop_id": sop_id}
    assert states["CH-01"]["status"] == "RUNNING"
    with Session() as db:
        schedule = db.get(Schedule, sid)
        loan = db.get(FixtureLoan, loan_id)
        assert schedule.status == ScheduleStatus.RUNNING
        assert loan.status == "loaned"
        assert loan.loan_date == original_loan_date
        audit = db.query(AuditLog).filter(
            AuditLog.entity_id == str(sid),
            AuditLog.action == "START_CONDITION",
        ).one()
        assert audit.actor == "1"
        assert audit.role == "admin"


def test_confirm_condition_rejects_broken_progress_data(session_factory):
    """壞條件不能誤判完成，也不能只回 400 後永遠卡在 RUNNING。"""
    Session = session_factory
    sid = _seed_confirmed(Session, conditions="{broken")
    loan_id = _seed_reserved_fixture(Session, sid)
    with Session() as db:
        schedule = db.get(Schedule, sid)
        schedule.status = ScheduleStatus.RUNNING
        loan = db.get(FixtureLoan, loan_id)
        loan.status = "loaned"
        db.commit()

    states = _states({"CH-01": {"status": "IDLE"}})
    client = _make_client(schedules_router, states)
    resp = client.post(f"/api/schedules/{sid}/confirm-condition")

    assert resp.status_code == 400
    assert _status(Session, sid) == ScheduleStatus.ERROR
    assert _loan_status(Session, loan_id) == "returned"


# ── PATCH 狀態也必須走完整生命週期 ──────────────────────────────────────────


def test_patch_running_uses_start_lifecycle(session_factory):
    """PATCH → RUNNING 也要真的啟動設備、建 execution、轉借治具並寫真人 audit。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    loan_id = _seed_reserved_fixture(Session, sid)
    states = _states({"CH-01": {"status": "IDLE"}})

    client = _make_client(schedules_router, states)
    resp = client.patch(
        f"/api/schedules/{sid}",
        json={"status": ScheduleStatus.RUNNING},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == ScheduleStatus.RUNNING
    assert states["CH-01"]["status"] == "RUNNING"
    assert _loan_status(Session, loan_id) == "loaned"
    with Session() as db:
        assert db.query(SopExecution).count() == 1
        audit = db.query(AuditLog).filter(
            AuditLog.entity_id == str(sid),
            AuditLog.action == "START",
        ).one()
        assert audit.actor == "1"


def test_confirmed_reassignment_syncs_fixture_before_patch_start(session_factory):
    """先改機台/期限再 PATCH 啟動時，借出紀錄不能留在舊機台與舊期限。"""
    Session = session_factory
    sid = _seed_confirmed(Session, device_id="CH-01")
    loan_id = _seed_reserved_fixture(Session, sid)
    old_due = _now_utc_naive() + datetime.timedelta(hours=2)
    new_start = _now_utc_naive()
    new_end = new_start + datetime.timedelta(hours=8)
    with Session() as db:
        loan = db.get(FixtureLoan, loan_id)
        loan.device_id = "CH-01"
        loan.due_date = old_due
        db.commit()

    states = _states({
        "CH-01": {"status": "IDLE"},
        "CH-02": {"status": "IDLE"},
    })
    client = _make_client(schedules_router, states)
    edit_resp = client.patch(
        f"/api/schedules/{sid}",
        json={
            "device_id": "CH-02",
            "start_time": new_start.isoformat(),
            "end_time": new_end.isoformat(),
        },
    )
    assert edit_resp.status_code == 200, edit_resp.text

    resp = client.patch(
        f"/api/schedules/{sid}",
        json={"status": ScheduleStatus.RUNNING},
    )

    assert resp.status_code == 200, resp.text
    assert states["CH-01"]["status"] == "IDLE"
    assert states["CH-02"]["status"] == "RUNNING"
    with Session() as db:
        loan = db.get(FixtureLoan, loan_id)
        assert loan.status == "loaned"
        assert loan.device_id == "CH-02"
        assert loan.due_date == new_end


def test_confirmed_slot_edit_replaces_scheduled_start_job(session_factory):
    """已確認排程改時段後，date job 必須改到新時間，不能留在舊時間觸發。"""
    Session = session_factory
    old_start = _now_utc_naive() + datetime.timedelta(days=1)
    new_start = old_start + datetime.timedelta(days=1)
    new_end = new_start + datetime.timedelta(hours=8)
    sid = _seed_confirmed(Session, device_id="CH-01", start=old_start)
    states = _states({
        "CH-01": {"status": "IDLE"},
        "CH-02": {"status": "IDLE"},
    })
    scheduler = _FakeScheduler()
    client = _make_client(schedules_router, states)
    client.app.state.scheduler = scheduler

    resp = client.patch(
        f"/api/schedules/{sid}",
        json={
            "device_id": "CH-02",
            "start_time": new_start.isoformat(),
            "end_time": new_end.isoformat(),
        },
    )

    assert resp.status_code == 200, resp.text
    assert len(scheduler.jobs) == 1
    func, options = scheduler.jobs[0]
    assert func is _start_schedule_by_id
    assert options == {
        "trigger": "date",
        "run_date": new_start.replace(tzinfo=datetime.timezone.utc),
        "kwargs": {"schedule_id": sid, "states": states},
        "id": f"sched_{sid}",
        "replace_existing": True,
    }


def test_patch_running_rejects_combined_edits_without_partial_write(session_factory):
    """啟動與內容修改要分兩次，拒絕時不能先寫入一半再回錯誤。"""
    Session = session_factory
    sid = _seed_confirmed(Session, device_id="CH-01")
    old_end = _now_utc_naive() + datetime.timedelta(hours=2)
    with Session() as db:
        schedule = db.get(Schedule, sid)
        schedule.end_time = old_end
        db.commit()

    states = _states({
        "CH-01": {"status": "IDLE"},
        "CH-02": {"status": "IDLE"},
    })
    client = _make_client(schedules_router, states)
    resp = client.patch(
        f"/api/schedules/{sid}",
        json={
            "status": ScheduleStatus.RUNNING,
            "device_id": "CH-02",
        },
    )

    assert resp.status_code == 409
    with Session() as db:
        schedule = db.get(Schedule, sid)
        assert schedule.status == ScheduleStatus.CONFIRMED
        assert schedule.device_id == "CH-01"
        assert schedule.end_time == old_end
    assert states["CH-01"]["status"] == "IDLE"
    assert states["CH-02"]["status"] == "IDLE"


def test_running_schedule_rejects_later_slot_edit(session_factory):
    """已在跑的排程不能只搬 Schedule row，留下設備/execution/治具在舊機台。"""
    Session = session_factory
    sid = _seed_confirmed(Session, device_id="CH-01")
    with Session() as db:
        schedule = db.get(Schedule, sid)
        schedule.status = ScheduleStatus.RUNNING
        db.commit()

    states = _states({
        "CH-01": {"status": "RUNNING"},
        "CH-02": {"status": "IDLE"},
    })
    client = _make_client(schedules_router, states)
    resp = client.patch(
        f"/api/schedules/{sid}",
        json={"device_id": "CH-02"},
    )

    assert resp.status_code == 409
    with Session() as db:
        assert db.get(Schedule, sid).device_id == "CH-01"
    assert states["CH-01"]["status"] == "RUNNING"


def test_patch_done_returns_fixtures_and_stops_device(session_factory):
    """PATCH → DONE 必須走完成 seam，歸還治具並讓執行中設備進入收尾。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    loan_id = _seed_reserved_fixture(Session, sid)
    with Session() as db:
        schedule = db.get(Schedule, sid)
        schedule.status = ScheduleStatus.RUNNING
        loan = db.get(FixtureLoan, loan_id)
        loan.status = "loaned"
        loan.loan_date = _now_utc_naive()
        db.commit()

    states = _states({"CH-01": {"status": "RUNNING"}})
    client = _make_client(schedules_router, states)
    resp = client.patch(
        f"/api/schedules/{sid}",
        json={"status": ScheduleStatus.DONE},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == ScheduleStatus.DONE
    assert states["CH-01"]["status"] == "FINISHING"
    with Session() as db:
        loan = db.get(FixtureLoan, loan_id)
        assert loan.status == "returned"
        assert loan.return_date is not None


def test_cancelling_future_confirmed_schedule_does_not_stop_live_device(session_factory):
    """取消同機台的未來排程，不得把目前不相干的 ad-hoc 測試送去收尾。"""
    Session = session_factory
    sid = _seed_confirmed(
        Session,
        start=_now_utc_naive() + datetime.timedelta(days=1),
    )
    states = _states({"CH-01": {"status": "RUNNING"}})
    client = _make_client(schedules_router, states)

    resp = client.patch(
        f"/api/schedules/{sid}",
        json={"status": ScheduleStatus.CANCELLED},
    )

    assert resp.status_code == 200, resp.text
    assert _status(Session, sid) == ScheduleStatus.CANCELLED
    assert states["CH-01"]["status"] == "RUNNING"


def test_deleting_future_confirmed_schedule_does_not_stop_live_device(session_factory):
    """刪除同機台的未來排程，也不得停止目前不相干的測試。"""
    Session = session_factory
    sid = _seed_confirmed(
        Session,
        start=_now_utc_naive() + datetime.timedelta(days=1),
    )
    states = _states({"CH-01": {"status": "RUNNING"}})
    client = _make_client(schedules_router, states)

    resp = client.delete(f"/api/schedules/{sid}")

    assert resp.status_code == 200, resp.text
    with Session() as db:
        assert db.get(Schedule, sid) is None
    assert states["CH-01"]["status"] == "RUNNING"


# ── 建不出執行紀錄 → 視為啟動失敗、把設備清回待機 ─────────────────────────────


def test_start_schedule_keeps_confirmed_when_execution_insert_fails(session_factory):
    """建不出執行紀錄→設備沒真的啟動→排程留在「已確認」、治具維持預約（可被重試）。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    loan_id = _seed_reserved_fixture(Session, sid)
    states = _states({"CH-01": {"status": "IDLE"}})

    with patch("app.sop._create_execution_id_db", return_value=None):
        result = asyncio.run(start_schedule(
            sid,
            SYSTEM_ACTOR,
            states,
        ))

    assert result.code == ScheduleStartCode.RETRYABLE_FAILURE
    assert states["CH-01"]["status"] == "IDLE"
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, "啟動失敗卻把排程標為進行中"
    assert _loan_status(Session, loan_id) == "reserved", "啟動失敗不該轉借治具"


def test_start_transaction_rolls_back_everything_when_audit_fails(session_factory):
    """transaction 後段失敗時，五張表與 cache 都不能留下半套啟動狀態。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    loan_id = _seed_reserved_fixture(Session, sid)
    states = _states({"CH-01": {"status": "IDLE"}})

    with patch("app.schedule_service.log_audit", side_effect=RuntimeError("audit unavailable")):
        result = asyncio.run(start_schedule(sid, SYSTEM_ACTOR, states))

    assert result.code == ScheduleStartCode.RETRYABLE_FAILURE
    assert states["CH-01"]["status"] == "IDLE"
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED
    assert _loan_status(Session, loan_id) == "reserved"
    with Session() as db:
        assert db.query(DeviceState).count() == 0
        assert db.query(SopExecution).count() == 0
        assert db.query(AuditLog).count() == 0


def test_manual_start_sop_reverts_when_execution_insert_fails(session_factory):
    """手動啟動時建不出執行紀錄→回 500 並把設備清回待機，不留 RUNNING 卻無紀錄的殭屍狀態。"""
    cache = {"CH-01": {"status": "IDLE"}}
    states = _states(cache)

    with patch("app.sop._create_execution_id_db", return_value=None):
        client = _make_client(sop_router, states)
        resp = client.post("/start", json={"sop_id": "iec60068_ab_-40_16h", "device_id": "CH-01"})

    assert resp.status_code == 500, f"建紀錄失敗必須回報啟動失敗，實際 {resp.status_code}"
    assert states["CH-01"]["status"] == "IDLE", "啟動失敗卻沒把設備清回待機"


def test_manual_start_sop_activates_schedule_atomically(session_factory):
    """手動啟動時把該設備的已確認排程一起推進：排程轉進行中、預約治具轉借出、寫 audit。

    這三件事現在走排程層的共用原子函式，同一 transaction——不會再出現排程已進行中、
    治具卻卡在預約的分裂狀態；手動 flip 也補上 audit。
    """
    Session = session_factory
    sid = _seed_confirmed(Session)
    loan_id = _seed_reserved_fixture(Session, sid)
    cache = {"CH-01": {"status": "IDLE"}}

    client = _make_client(sop_router, cache)
    resp = client.post("/start", json={"sop_id": "iec60068_ab_-40_16h", "device_id": "CH-01"})

    assert resp.status_code == 200
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert _loan_status(Session, loan_id) == "loaned", "手動啟動沒把預約治具轉為借出"
    assert _audit_count(Session, sid, action="START") == 1, "手動啟動的排程推進要留一筆 audit"


def test_manual_start_sop_claims_earliest_due_matching_schedule(session_factory):
    """同設備有多筆吻合排程時，只認領已到期且開始時間最早的一筆。"""
    Session = session_factory
    now = _now_utc_naive()
    later = _seed_confirmed(Session, start=now + datetime.timedelta(hours=2))
    earlier = _seed_confirmed(Session, start=now - datetime.timedelta(hours=1))
    cache = {"CH-01": {"status": "IDLE"}}

    client = _make_client(sop_router, cache)
    resp = client.post("/start", json={"sop_id": "iec60068_ab_-40_16h", "device_id": "CH-01"})

    assert resp.status_code == 200
    assert _status(Session, earlier) == ScheduleStatus.RUNNING
    assert _status(Session, later) == ScheduleStatus.CONFIRMED


def test_manual_ad_hoc_sop_does_not_claim_unrelated_future_schedule(session_factory):
    """ad-hoc SOP 不得認領同設備上未來或條件不同的已確認排程。"""
    Session = session_factory
    future = _now_utc_naive() + datetime.timedelta(days=7)
    sid = _seed_confirmed(
        Session,
        start=future,
        conditions='["iec61850_ed2_c1_high"]',
    )
    loan_id = _seed_reserved_fixture(Session, sid)
    states = _states({"CH-01": {"status": "IDLE"}})

    client = _make_client(sop_router, states)
    resp = client.post(
        "/start",
        json={"sop_id": "iec60068_ab_-40_16h", "device_id": "CH-01"},
    )

    assert resp.status_code == 200, resp.text
    assert states["CH-01"]["status"] == "RUNNING"
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED
    assert _loan_status(Session, loan_id) == "reserved"
    assert _audit_count(Session, sid, action="START") == 0
