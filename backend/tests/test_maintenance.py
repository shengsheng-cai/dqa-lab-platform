"""
T-11: 設備校驗 & 維護排程 API 測試
- CalibrationCRUD（list / create / update / delete）
- MaintenanceCRUD（list / create）
- calibration-status 摘要端點
"""
import pytest

from app.devices_maintenance import router as maintenance_router


@pytest.fixture()
def client(api_client):
    """無角色 client（相當於匿名，唯讀端點應通過），role=guest"""
    import app.devices_maintenance as dm_module
    with api_client(dm_module, maintenance_router, role="guest") as (c, _Session):
        yield c


@pytest.fixture()
def admin_client(api_client):
    """admin role client"""
    import app.devices_maintenance as dm_module
    with api_client(dm_module, maintenance_router, role="admin") as (c, _Session):
        yield c


@pytest.fixture()
def guest_client(api_client):
    """guest role client（不可寫入）"""
    import app.devices_maintenance as dm_module
    with api_client(dm_module, maintenance_router, role="guest") as (c, _Session):
        yield c


# ── Calibration Tests ─────────────────────────────────────────────────────────


def test_list_calibrations_empty(client):
    """GET /api/devices/CH-99/calibrations → 200, []"""
    resp = client.get("/api/devices/CH-99/calibrations")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_calibration(admin_client):
    """POST → 201；GET 確認紀錄存在"""
    payload = {
        "calibration_date": "2026-01-15T00:00:00",
        "next_calibration_date": "2027-01-15T00:00:00",
        "interval_days": 365,
        "certificate_number": "CAL-TEST-001",
        "result": "pass",
        "notes": "測試校驗",
        "created_by": "admin",
    }
    resp = admin_client.post("/api/devices/CH-01/calibrations", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["device_id"] == "CH-01"
    assert data["result"] == "pass"
    assert data["certificate_number"] == "CAL-TEST-001"

    # GET 確認
    list_resp = admin_client.get("/api/devices/CH-01/calibrations")
    assert list_resp.status_code == 200
    records = list_resp.json()
    assert len(records) == 1
    assert records[0]["certificate_number"] == "CAL-TEST-001"


def test_create_calibration_guest_forbidden(guest_client):
    """guest 無法 POST → 403"""
    payload = {
        "calibration_date": "2026-01-15T00:00:00",
        "next_calibration_date": "2027-01-15T00:00:00",
        "interval_days": 365,
        "result": "pass",
        "created_by": "guest",
    }
    resp = guest_client.post("/api/devices/CH-01/calibrations", json=payload)
    assert resp.status_code == 403


def test_update_calibration(admin_client):
    """POST 建立後 PUT 更新 notes → 200，GET 確認"""
    payload = {
        "calibration_date": "2026-03-01T00:00:00",
        "next_calibration_date": "2027-03-01T00:00:00",
        "interval_days": 365,
        "result": "pass",
        "notes": "原始備註",
        "created_by": "admin",
    }
    create_resp = admin_client.post("/api/devices/CH-02/calibrations", json=payload)
    assert create_resp.status_code == 201
    cal_id = create_resp.json()["id"]

    update_resp = admin_client.put(
        f"/api/devices/CH-02/calibrations/{cal_id}",
        json={"notes": "已更新備註"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["notes"] == "已更新備註"

    list_resp = admin_client.get("/api/devices/CH-02/calibrations")
    assert list_resp.json()[0]["notes"] == "已更新備註"


def test_delete_calibration(admin_client):
    """POST 建立後 DELETE → 200，GET 確認消失"""
    payload = {
        "calibration_date": "2026-04-01T00:00:00",
        "next_calibration_date": "2027-04-01T00:00:00",
        "interval_days": 365,
        "result": "pass",
        "created_by": "admin",
    }
    create_resp = admin_client.post("/api/devices/CH-03/calibrations", json=payload)
    assert create_resp.status_code == 201
    cal_id = create_resp.json()["id"]

    del_resp = admin_client.delete(f"/api/devices/CH-03/calibrations/{cal_id}")
    assert del_resp.status_code == 200

    list_resp = admin_client.get("/api/devices/CH-03/calibrations")
    assert list_resp.json() == []


# ── Maintenance Tests ─────────────────────────────────────────────────────────


def test_list_maintenances_empty(client):
    """GET /api/devices/CH-99/maintenances → 200, []"""
    resp = client.get("/api/devices/CH-99/maintenances")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_maintenance(admin_client):
    """POST → 201；GET 確認"""
    payload = {
        "maintenance_date": "2026-02-10T00:00:00",
        "maintenance_type": "preventive",
        "description": "更換密封條",
        "performed_by": "王工程師",
        "next_maintenance_date": "2026-08-10T00:00:00",
    }
    resp = admin_client.post("/api/devices/CH-01/maintenances", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["device_id"] == "CH-01"
    assert data["maintenance_type"] == "preventive"
    assert data["performed_by"] == "王工程師"

    list_resp = admin_client.get("/api/devices/CH-01/maintenances")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1


# ── Calibration Status API ────────────────────────────────────────────────────


def test_calibration_status_api(admin_client):
    """GET /api/maintenance/calibration-status → 200，包含 CH-01 到 CH-05，每項有 status"""
    resp = admin_client.get("/api/maintenance/calibration-status")
    assert resp.status_code == 200
    data = resp.json()

    for device_id in ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"]:
        assert device_id in data
        assert "status" in data[device_id]

    # 空 DB 時所有設備皆為 unknown
    for device_id in ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"]:
        assert data[device_id]["status"] == "unknown"
