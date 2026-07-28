"""設備不可用時段的管理權限與稽核軌跡。"""

import pytest

import app.schedules as schedules_module
from app.models import AuditLog, DeviceBlockedPeriod
from app.schedules import blocked_router


BASE_PAYLOAD = {
    "device_id": "CH-01",
    "start_time": "2030-01-01T08:00:00",
    "end_time": "2030-01-01T16:00:00",
    "reason": "年度校正",
}


def test_blocked_period_crud_writes_authenticated_actor_to_audit(api_client):
    with api_client(
        schedules_module,
        blocked_router,
        role="admin",
        user_id=7,
        username="tester",
    ) as (client, Session):
        create_resp = client.post("/api/device-blocked-periods", json=BASE_PAYLOAD)
        assert create_resp.status_code == 201
        period_id = create_resp.json()["id"]

        update_resp = client.patch(
            f"/api/device-blocked-periods/{period_id}",
            json={"reason": "年度校正（延期）"},
        )
        assert update_resp.status_code == 200

        delete_resp = client.delete(f"/api/device-blocked-periods/{period_id}")
        assert delete_resp.status_code == 200

        with Session() as db:
            rows = (
                db.query(AuditLog)
                .filter(
                    AuditLog.entity_type == "device_blocked_period",
                    AuditLog.entity_id == str(period_id),
                )
                .order_by(AuditLog.id)
                .all()
            )
            assert [row.action for row in rows] == ["CREATE", "UPDATE", "DELETE"]
            assert {row.actor for row in rows} == {"7"}
            assert {row.role for row in rows} == {"admin"}
            assert "年度校正" in rows[0].detail
            assert "年度校正（延期）" in rows[1].detail
            assert "年度校正（延期）" in rows[2].detail
            assert db.query(DeviceBlockedPeriod).count() == 0


def test_blocked_period_write_rejects_non_admin_without_audit(api_client):
    with api_client(
        schedules_module,
        blocked_router,
        role="guest",
        user_id=8,
        username="guest",
    ) as (client, Session):
        resp = client.post("/api/device-blocked-periods", json=BASE_PAYLOAD)

        assert resp.status_code == 403
        with Session() as db:
            assert db.query(DeviceBlockedPeriod).count() == 0
            assert db.query(AuditLog).count() == 0


def test_blocked_period_create_rolls_back_when_audit_fails(api_client, monkeypatch):
    def fail_audit(*_args, **_kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(schedules_module, "log_audit", fail_audit)

    with api_client(
        schedules_module,
        blocked_router,
        role="admin",
        user_id=7,
        username="tester",
    ) as (client, Session):
        with pytest.raises(RuntimeError, match="audit unavailable"):
            client.post("/api/device-blocked-periods", json=BASE_PAYLOAD)

        with Session() as db:
            assert db.query(DeviceBlockedPeriod).count() == 0
            assert db.query(AuditLog).count() == 0
