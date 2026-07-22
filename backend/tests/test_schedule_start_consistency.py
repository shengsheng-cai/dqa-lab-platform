"""
排程狀態必須與設備真實狀態一致。

APScheduler 到點觸發 _start_schedule_by_id 時，若設備當下不是 IDLE
（上一個測試仍在收尾、人工接管、EMERGENCY），auto_start_sop 會跳過啟動。
此時排程不得停留在「進行中」——否則畫面顯示測試中，設備卻是空的，
且 5 分鐘 fallback 不會再重試（fallback 只掃 CONFIRMED）。
"""
import asyncio
import datetime
from unittest.mock import patch

import pytest

from app.models import AuditLog, DeviceBlockedPeriod, Fixture, FixtureLoan, Schedule, ScheduleStatus
from app.schedule_service import _start_schedule_by_id, auto_advance_schedules, try_start_schedule
from app.schedules import router as schedules_router
from app.sop import router as sop_router
from app.utils import _now_utc_naive


@pytest.fixture()
def session_factory(patched_session):
    # 啟動流程會跨多個模組寫 DB：schedule_service（排程）、sop（SopExecution）、
    # utils（device_states）、schedules（手動 /start 路由）。全部一起 patch，
    # 少一個那個模組就會寫進真實的 aicm.db。
    with patched_session(
        "app.schedule_service", "app.sop", "app.utils", "app.schedules",
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


def test_start_does_not_mark_running_when_device_busy(session_factory):
    """設備非 IDLE → 排程必須留在「已確認」，讓 fallback 稍後重試。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    cache = _busy_cache()
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(_start_schedule_by_id(sid, cache, locks))

    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "設備仍在收尾，排程卻已標為進行中：畫面顯示測試中但設備是空的，"
        "且 fallback 只掃 CONFIRMED，不會再重試"
    )
    assert cache["CH-01"]["status"] == "FINISHING", "不得覆蓋設備既有狀態"


def test_start_marks_running_when_device_idle(session_factory):
    """設備 IDLE → 正常啟動，排程轉進行中、設備轉 RUNNING。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    cache = {"CH-01": {"status": "IDLE"}}
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(_start_schedule_by_id(sid, cache, locks))

    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert cache["CH-01"]["status"] == "RUNNING"


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
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(_start_schedule_by_id(sid, cache, locks))

    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "設備標了維護，排程卻自動啟動：測試會跑在維護中的機器上"
    )
    assert cache["CH-01"]["status"] == "IDLE", "維護中不得啟動設備"


def test_start_skipped_when_maintenance_has_no_reason(session_factory):
    """維護時段的 reason 可為空（欄位 nullable、建立時可不填）→ 仍須擋住自動啟動。

    有無封鎖只看時段存在與否，不能拿 reason 當判準。
    """
    Session = session_factory
    sid = _seed_confirmed(Session)
    _seed_blocked(Session, reason=None)
    cache = {"CH-01": {"status": "IDLE"}}
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(_start_schedule_by_id(sid, cache, locks))

    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "沒填原因的維護時段被當成沒封鎖，測試照樣自動啟動"
    )
    assert cache["CH-01"]["status"] == "IDLE"


def test_maintenance_keeps_confirmed_then_resumes(session_factory):
    """維護是暫時性阻擋：撞維護維持 CONFIRMED（不轉「異常」）；維護結束後應能重試啟動。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    _seed_blocked(Session)
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(auto_advance_schedules({"CH-01": {"status": "IDLE"}}, locks))
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "維護會結束，屬暫時性阻擋，不該轉『異常』終止重試"
    )

    with Session() as db:  # 維護時段結束（移除）
        db.query(DeviceBlockedPeriod).delete()
        db.commit()
    idle = {"CH-01": {"status": "IDLE"}}
    asyncio.run(auto_advance_schedules(idle, locks))
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert idle["CH-01"]["status"] == "RUNNING"


def test_fallback_retries_after_device_frees_up(session_factory):
    """設備忙 → 排程留 CONFIRMED；設備空出來後，fallback 應能成功啟動。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    locks = {"CH-01": asyncio.Lock()}

    busy = _busy_cache()
    asyncio.run(auto_advance_schedules(busy, locks))
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED

    idle = {"CH-01": {"status": "IDLE"}}
    asyncio.run(auto_advance_schedules(idle, locks))
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert idle["CH-01"]["status"] == "RUNNING"


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
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(auto_advance_schedules({"CH-01": {"status": "IDLE"}}, locks))

    assert _status(Session, sid) == ScheduleStatus.ERROR, (
        "缺設備的排程沒被收斂：會每 5 分鐘重試、永遠停在「已確認」，畫面也看不出壞掉"
    )
    assert _audit_count(Session, sid) == 1, "轉異常必須留一筆稽核紀錄供追查"


def test_broken_schedule_missing_conditions_becomes_error(session_factory):
    """已確認排程 conditions 為空 → 同樣轉「異常」。"""
    Session = session_factory
    sid = _seed_confirmed(Session, conditions="[]")
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(auto_advance_schedules({"CH-01": {"status": "IDLE"}}, locks))

    assert _status(Session, sid) == ScheduleStatus.ERROR


def test_error_schedule_not_retried(session_factory):
    """轉「異常」後退出 CONFIRMED，後續 fallback 不得再撿它、不得重複寫 audit。"""
    Session = session_factory
    sid = _seed_confirmed(Session, device_id=None)
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(auto_advance_schedules({"CH-01": {"status": "IDLE"}}, locks))
    asyncio.run(auto_advance_schedules({"CH-01": {"status": "IDLE"}}, locks))

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
    locks = {"CH-01": asyncio.Lock()}

    asyncio.run(auto_advance_schedules({"CH-01": {"status": "IDLE"}}, locks))

    assert _status(Session, sid) == ScheduleStatus.ERROR
    with Session() as db:
        assert db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first() is None, (
            "轉異常沒放掉 reserved 治具：可借量被永久扣住、借不回來"
        )


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
    locks = {"CH-01": asyncio.Lock()}
    asyncio.run(try_start_schedule(target, "CH-01", ["iec60068_ab_-40_16h"], cache, locks))

    assert _loan_status(Session, target_loan) == "loaned", "啟動的排程治具應轉為借出"
    assert _loan_status(Session, other_loan) == "reserved", (
        "治具被借給了同設備上的另一筆排程——轉借依 device_id 猜排程會借錯人"
    )


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
    app.state.AICM_CACHE = cache
    app.state.DEVICE_LOCKS = {d: asyncio.Lock() for d in cache}
    return TestClient(app)


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

    client = _make_client(schedules_router, cache)
    resp = client.post(f"/api/schedules/{sid}/start")

    assert resp.status_code == 200
    assert _status(Session, sid) == ScheduleStatus.RUNNING
    assert cache["CH-01"]["status"] == "RUNNING"


def test_manual_start_rejects_maintenance_device(session_factory):
    """設備 IDLE 但當下在維護時段 → 手動「立即開始」也要擋下：回 409、排程維持「已確認」。

    自動路徑早有涵蓋（test_start_skipped_when_device_in_maintenance）；手動 HTTP 這條
    有自己的錯誤回應，之前只測了「忙碌設備」沒測「維護設備」，補這條把「手動也尊重維護」鎖住。

    註：目前這個 409 的訊息本身有毛病（拿設備狀態拼字，維護中卻說成「非待機狀態」、
    也沒提維護），已記在 CLAUDE.local.md 待補。所以這裡只斷言擋沒擋住這個地面事實，
    不押在訊息字串上。
    """
    Session = session_factory
    sid = _seed_confirmed(Session)
    _seed_blocked(Session)  # CH-01 插一段涵蓋當下的維護時段
    cache = {"CH-01": {"status": "IDLE"}}

    client = _make_client(schedules_router, cache)
    resp = client.post(f"/api/schedules/{sid}/start")

    assert resp.status_code == 409, f"維護中不得回報啟動成功，實際 {resp.status_code}"
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, (
        "維護中卻把排程標為進行中：畫面顯示測試中但設備在維護、根本沒動"
    )
    assert cache["CH-01"]["status"] == "IDLE", "維護中不得啟動設備"


# ── 建不出執行紀錄 → 視為啟動失敗、把設備清回待機 ─────────────────────────────


def test_auto_start_reverts_device_when_execution_insert_fails(session_factory):
    """自動啟動時建不出執行紀錄→回 False 並把設備清回待機。

    否則設備會卡在 RUNNING 卻沒有執行紀錄：完成時寫不了 test_ended_at、也沒報告可連。
    """
    from app.sop import auto_start_sop

    device = {"status": "IDLE"}
    cache = {"CH-01": device}
    locks = {"CH-01": asyncio.Lock()}

    with patch("app.sop._create_execution_id_db", return_value=None):
        ok = asyncio.run(auto_start_sop("CH-01", "iec60068_ab_-40_16h", cache, locks))

    assert ok is False, "建不出執行紀錄卻回報啟動成功"
    assert device["status"] == "IDLE", "啟動失敗卻沒把設備清回待機，會顯示 RUNNING 但無紀錄"


def test_try_start_keeps_confirmed_when_execution_insert_fails(session_factory):
    """建不出執行紀錄→設備沒真的啟動→排程留在「已確認」、治具維持預約（可被重試）。"""
    Session = session_factory
    sid = _seed_confirmed(Session)
    loan_id = _seed_reserved_fixture(Session, sid)
    cache = {"CH-01": {"status": "IDLE"}}
    locks = {"CH-01": asyncio.Lock()}

    with patch("app.sop._create_execution_id_db", return_value=None):
        ok = asyncio.run(try_start_schedule(sid, "CH-01", ["iec60068_ab_-40_16h"], cache, locks))

    assert ok is False
    assert _status(Session, sid) == ScheduleStatus.CONFIRMED, "啟動失敗卻把排程標為進行中"
    assert _loan_status(Session, loan_id) == "reserved", "啟動失敗不該轉借治具"


def test_manual_start_sop_reverts_when_execution_insert_fails(session_factory):
    """手動啟動時建不出執行紀錄→回 500 並把設備清回待機，不留 RUNNING 卻無紀錄的殭屍狀態。"""
    cache = {"CH-01": {"status": "IDLE"}}

    with patch("app.sop._create_execution_id_db", return_value=None):
        client = _make_client(sop_router, cache)
        resp = client.post("/start", json={"sop_id": "iec60068_ab_-40_16h", "device_id": "CH-01"})

    assert resp.status_code == 500, f"建紀錄失敗必須回報啟動失敗，實際 {resp.status_code}"
    assert cache["CH-01"]["status"] == "IDLE", "啟動失敗卻沒把設備清回待機"


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


def test_manual_start_sop_activates_earliest_confirmed_schedule(session_factory):
    """同設備有多筆已確認排程時，手動啟動要挑預定開始時間最早的一筆。"""
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
