"""
T-11: 設備校驗 & 維護排程 API 測試
- CalibrationCRUD（list / create / update / delete）
- MaintenanceCRUD（list / create）
- calibration-status 摘要端點
"""
import datetime

import pytest

from app.devices_maintenance import router as maintenance_router
from app.models import AuditLog


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
        "result": "pass",
        "notes": "測試校驗",
        "created_by": "admin",
    }
    resp = admin_client.post("/api/devices/CH-01/calibrations", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["device_id"] == "CH-01"
    assert data["result"] == "pass"
    assert "certificate_number" not in data

    # GET 確認
    list_resp = admin_client.get("/api/devices/CH-01/calibrations")
    assert list_resp.status_code == 200
    records = list_resp.json()
    assert len(records) == 1
    assert "certificate_number" not in records[0]


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


def test_update_maintenance_can_clear_next_date(admin_client):
    """未傳下次維護日期時保留原值；明確傳 null 時清空。"""
    create_resp = admin_client.post(
        "/api/devices/CH-02/maintenances",
        json={
            "maintenance_date": "2026-02-10T00:00:00",
            "maintenance_type": "preventive",
            "description": "更換密封條",
            "performed_by": "王工程師",
            "next_maintenance_date": "2026-08-10T00:00:00",
        },
    )
    assert create_resp.status_code == 201
    maint_id = create_resp.json()["id"]

    update_resp = admin_client.put(
        f"/api/devices/CH-02/maintenances/{maint_id}",
        json={"description": "更換密封條與濾網"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["next_maintenance_date"] == "2026-08-10T00:00:00"

    clear_resp = admin_client.put(
        f"/api/devices/CH-02/maintenances/{maint_id}",
        json={"next_maintenance_date": None},
    )
    assert clear_resp.status_code == 200
    assert clear_resp.json()["next_maintenance_date"] is None

    list_resp = admin_client.get("/api/devices/CH-02/maintenances")
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["next_maintenance_date"] is None


# ── Audit Trail Tests ─────────────────────────────────────────────────────────


def test_calibration_writes_audit_trail(api_client):
    """建立與刪除校驗紀錄都要留下 audit（ISO 17025：校驗紀錄需可追溯），
    且 actor/role 帶入真實登入者（非寫死）。"""
    import app.devices_maintenance as dm_module
    payload = {
        "calibration_date": "2026-05-01T00:00:00",
        "next_calibration_date": "2027-05-01T00:00:00",
        "interval_days": 365,
        "result": "pass",
        "created_by": "admin",
    }
    with api_client(
        dm_module, maintenance_router, role="admin", user_id=7, username="tester",
    ) as (client, Session):
        create_resp = client.post("/api/devices/CH-04/calibrations", json=payload)
        assert create_resp.status_code == 201
        cal_id = create_resp.json()["id"]

        with Session() as s:
            row = (
                s.query(AuditLog)
                .filter(AuditLog.action == "CALIBRATION_CREATE")
                .one()
            )
            assert row.entity_type == "device"
            assert row.entity_id == "CH-04"
            assert row.actor == "7"      # 帶入真實 user_id，非 "unknown"
            assert row.role == "admin"   # 帶入真實 role，非寫死字串

        del_resp = client.delete(f"/api/devices/CH-04/calibrations/{cal_id}")
        assert del_resp.status_code == 200

        with Session() as s:
            actions = {r.action for r in s.query(AuditLog).all()}
            assert actions == {"CALIBRATION_CREATE", "CALIBRATION_DELETE"}


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


# ── 維護類型的允許值 ──────────────────────────────────────────────────────────


def test_create_maintenance_rejects_unknown_type(admin_client):
    """類型只收 preventive／corrective／inspection，其他一律擋。

    這個欄位以前是不設限的字串，前端各自維護一張中文對照表，於是種子資料寫進一個
    表上沒有的值（routine），畫面就把內部代碼原樣印給使用者看。值的權威要在後端。
    """
    resp = admin_client.post("/api/devices/CH-01/maintenances", json={
        "maintenance_date": "2026-02-10T00:00:00",
        "maintenance_type": "routine",
        "description": "例行清潔",
        "performed_by": "王工程師",
    })

    assert resp.status_code == 422
    assert admin_client.get("/api/devices/CH-01/maintenances").json() == []


def test_update_maintenance_rejects_unknown_type(admin_client):
    """編輯也要擋——不然舊資料改一改就能把不認得的值寫回去。"""
    created = admin_client.post("/api/devices/CH-01/maintenances", json={
        "maintenance_date": "2026-02-10T00:00:00",
        "maintenance_type": "preventive",
        "description": "更換密封條",
        "performed_by": "王工程師",
    })
    assert created.status_code == 201

    resp = admin_client.put(
        f"/api/devices/CH-01/maintenances/{created.json()['id']}",
        json={"maintenance_type": "routine"},
    )

    assert resp.status_code == 422
    after = admin_client.get("/api/devices/CH-01/maintenances").json()
    assert after[0]["maintenance_type"] == "preventive"

    # 換成合法值要存成乾淨的字串。欄位在 DB 是純字串，列舉如果落盤成
    # "MaintenanceType.INSPECTION" 之類的東西，畫面會安靜地變成未知類型。
    ok = admin_client.put(
        f"/api/devices/CH-01/maintenances/{created.json()['id']}",
        json={"maintenance_type": "inspection"},
    )
    assert ok.status_code == 200
    assert admin_client.get("/api/devices/CH-01/maintenances").json()[0]["maintenance_type"] == "inspection"


def test_legacy_unknown_type_still_reads(api_client):
    """資料庫裡躺著不認得的舊值時，讀取端不得整頁壞掉。

    寫入端收斂成三個值之後，很容易順手把輸出定義也改成同一個列舉——那樣舊資料
    一讀就 500，而前端「未知類型」那段畫面也永遠走不到。這條把那個不對稱釘住。
    """
    import app.devices_maintenance as dm_module
    from app.models import DeviceMaintenance

    with api_client(dm_module, maintenance_router, role="admin") as (client, Session):
        with Session() as db:
            db.add(DeviceMaintenance(
                device_id="CH-01",
                maintenance_date=datetime.datetime(2026, 2, 10),
                maintenance_type="routine",     # 這個值現在已經寫不進來了，只會存在於舊資料庫
                description="例行清潔",
                performed_by="王工程師",
            ))
            db.commit()

        resp = client.get("/api/devices/CH-01/maintenances")

        assert resp.status_code == 200, resp.text
        assert resp.json()[0]["maintenance_type"] == "routine"
