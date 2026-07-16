"""
排程時段衝突：同一台設備不得有重疊的有效排程。

建立時由 _find_earliest_slot 排在既有排程之後（建構時避免衝突），
但 PATCH 可直接覆寫 device_id / start_time / end_time，必須擋下重疊。
"""
import datetime

import pytest

import app.schedules as schedules_module
from app.models import Schedule, ScheduleStatus
from app.schedules import router as schedules_router


@pytest.fixture()
def admin_client(api_client):
    with api_client(
        schedules_module, schedules_router,
        role="admin", user_id=1, username="admin",
        app_state={"AICM_CACHE": {}, "DEVICE_LOCKS": {}},
    ) as (client, Session):
        yield client, Session


BASE = datetime.datetime(2030, 1, 1, 8, 0, 0)


def _seed_schedule(Session, device_id, start, end, status=ScheduleStatus.CONFIRMED) -> int:
    with Session() as db:
        s = Schedule(
            project_number="P-001",
            sample_name="樣品",
            device_id=device_id,
            standard="IEC 60068",
            conditions='["iec60068_ab_-40_16h"]',
            start_time=start,
            end_time=end,
            status=status,
        )
        db.add(s)
        db.commit()
        return s.id


def test_patch_without_status_rejects_overlapping_slot(admin_client):
    """不帶 status 的純編輯，也必須擋下與同設備既有排程重疊的時段。"""
    client, Session = admin_client
    _seed_schedule(Session, "CH-01", BASE, BASE + datetime.timedelta(hours=8))
    victim = _seed_schedule(
        Session, "CH-01",
        BASE + datetime.timedelta(hours=20),
        BASE + datetime.timedelta(hours=28),
    )

    # 把 victim 拖進 #1 正在佔用的時段
    resp = client.patch(
        f"/api/schedules/{victim}",
        json={
            "device_id": "CH-01",
            "start_time": (BASE + datetime.timedelta(hours=2)).isoformat(),
            "end_time": (BASE + datetime.timedelta(hours=6)).isoformat(),
        },
    )

    assert resp.status_code == 409, (
        f"重疊時段應被拒絕，實際 {resp.status_code}；"
        f"CH-01 在此時段已有排程 #1"
    )


def test_patch_to_running_rejects_overlapping_slot(admin_client):
    """status=進行中 的分支同樣不得寫入重疊時段。"""
    client, Session = admin_client
    _seed_schedule(Session, "CH-01", BASE, BASE + datetime.timedelta(hours=8))
    victim = _seed_schedule(
        Session, "CH-01",
        BASE + datetime.timedelta(hours=20),
        BASE + datetime.timedelta(hours=28),
        status=ScheduleStatus.CONFIRMED,
    )

    resp = client.patch(
        f"/api/schedules/{victim}",
        json={
            "status": ScheduleStatus.RUNNING,
            "device_id": "CH-01",
            "start_time": (BASE + datetime.timedelta(hours=2)).isoformat(),
            "end_time": (BASE + datetime.timedelta(hours=6)).isoformat(),
        },
    )

    assert resp.status_code == 409, (
        f"重疊時段應被拒絕，實際 {resp.status_code}"
    )


def test_patch_confirm_rejects_overlapping_slot(admin_client):
    """已有的防線：status=已確認 且指定完整時段時擋下重疊（此測試應直接通過）。"""
    client, Session = admin_client
    _seed_schedule(Session, "CH-01", BASE, BASE + datetime.timedelta(hours=8))
    pending = _seed_schedule(
        Session, "CH-01", None, None, status=ScheduleStatus.PENDING,
    )

    resp = client.patch(
        f"/api/schedules/{pending}",
        json={
            "status": ScheduleStatus.CONFIRMED,
            "device_id": "CH-01",
            "start_time": (BASE + datetime.timedelta(hours=2)).isoformat(),
            "end_time": (BASE + datetime.timedelta(hours=6)).isoformat(),
        },
    )

    assert resp.status_code == 409
    assert "重疊" in resp.json()["detail"]


def test_patch_non_overlapping_slot_is_allowed(admin_client):
    """不重疊的時段調整必須放行，避免衝突檢查誤殺正常操作。"""
    client, Session = admin_client
    _seed_schedule(Session, "CH-01", BASE, BASE + datetime.timedelta(hours=8))
    victim = _seed_schedule(
        Session, "CH-01",
        BASE + datetime.timedelta(hours=20),
        BASE + datetime.timedelta(hours=28),
    )

    resp = client.patch(
        f"/api/schedules/{victim}",
        json={
            "device_id": "CH-01",
            "start_time": (BASE + datetime.timedelta(hours=30)).isoformat(),
            "end_time": (BASE + datetime.timedelta(hours=36)).isoformat(),
        },
    )

    assert resp.status_code == 200


def test_patch_overlap_on_other_device_is_allowed(admin_client):
    """時段重疊但設備不同 → 合法，不得誤擋。"""
    client, Session = admin_client
    _seed_schedule(Session, "CH-01", BASE, BASE + datetime.timedelta(hours=8))
    victim = _seed_schedule(
        Session, "CH-02",
        BASE + datetime.timedelta(hours=20),
        BASE + datetime.timedelta(hours=28),
    )

    resp = client.patch(
        f"/api/schedules/{victim}",
        json={
            "device_id": "CH-02",
            "start_time": (BASE + datetime.timedelta(hours=2)).isoformat(),
            "end_time": (BASE + datetime.timedelta(hours=6)).isoformat(),
        },
    )

    assert resp.status_code == 200
