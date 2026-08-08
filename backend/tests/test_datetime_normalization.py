"""外部送進來的時間一律換算成 naive UTC 再落地。

DB 的 datetime 欄位沒有時區，存的一律是 UTC。前端目前送的都是帶 Z 的 UTC，
所以「直接寫進去」剛好等於正確答案——但只要哪天有人改送本地時間，存進去的
會是牆上時間卻被當成 UTC，差幾小時，而且從頭到尾不會有任何錯誤訊息。

這個檔把整類不變式釘住：每個收外部時間的端點，送 +08:00 進去，存出來都必須是
換算後的 UTC。執行紀錄那條屬於同一類，測試在
`test_reports_degradation.py::test_non_utc_timestamps_are_converted_before_saving`。
"""
import datetime
import json

import app.devices_maintenance as maintenance_module
import app.fixtures as fixtures_module
import app.schedules as schedules_module
from app.devices_maintenance import router as maintenance_router
from app.fixtures import router as fixtures_router
from app.models import (
    DeviceBlockedPeriod,
    DeviceCalibration,
    DeviceMaintenance,
    Fixture,
    FixtureLoan,
    Schedule,
    ScheduleStatus,
)
from app.schedules import blocked_router, router as schedules_router

TAIPEI = datetime.timezone(datetime.timedelta(hours=8))

# 台北 1/1 08:00 = UTC 1/1 00:00。丟掉時區會存成 08:00，剛好差 8 小時。
LOCAL_START = datetime.datetime(2030, 1, 1, 8, 0, tzinfo=TAIPEI)
LOCAL_END = datetime.datetime(2030, 1, 1, 16, 0, tzinfo=TAIPEI)
UTC_START = datetime.datetime(2030, 1, 1, 0, 0)
UTC_END = datetime.datetime(2030, 1, 1, 8, 0)

# 用來當「改之前」的原值，跟上面那組錯開，這樣改不動時測試才會紅
OTHER_START = datetime.datetime(2030, 2, 1, 0, 0)
OTHER_END = datetime.datetime(2030, 2, 1, 8, 0)


def _seed_fixture(Session) -> int:
    with Session() as db:
        f = Fixture(
            interface_type="USB", form_factor="Desktop",
            total_quantity=5, shortage=0, is_active=True,
        )
        db.add(f)
        db.commit()
        return f.id


def _seed_schedule(Session) -> int:
    with Session() as db:
        s = Schedule(
            project_number="P-001", sample_name="樣品 A",
            standard="IEC 60068", conditions=json.dumps(["sop1"]),
            status=ScheduleStatus.PENDING, device_id="CH-01",
            start_time=OTHER_START, end_time=OTHER_END,
        )
        db.add(s)
        db.commit()
        return s.id


def test_blocked_period_create_converts_non_utc(api_client):
    with api_client(schedules_module, blocked_router, role="admin", user_id=7) as (client, Session):
        resp = client.post("/api/device-blocked-periods", json={
            "device_id": "CH-01",
            "start_time": LOCAL_START.isoformat(),
            "end_time": LOCAL_END.isoformat(),
            "reason": "年度校正",
        })
        assert resp.status_code == 201, resp.text

        with Session() as db:
            row = db.get(DeviceBlockedPeriod, resp.json()["id"])
            assert (row.start_time, row.end_time) == (UTC_START, UTC_END), (
                f"存成 {row.start_time}～{row.end_time}，台北 08:00～16:00 應是 UTC 00:00～08:00"
            )


def test_blocked_period_patch_converts_non_utc(api_client):
    with api_client(schedules_module, blocked_router, role="admin", user_id=7) as (client, Session):
        created = client.post("/api/device-blocked-periods", json={
            "device_id": "CH-01",
            "start_time": OTHER_START.isoformat() + "Z",
            "end_time": OTHER_END.isoformat() + "Z",
        })
        assert created.status_code == 201, created.text
        pid = created.json()["id"]

        resp = client.patch(f"/api/device-blocked-periods/{pid}", json={
            "start_time": LOCAL_START.isoformat(),
            "end_time": LOCAL_END.isoformat(),
        })
        assert resp.status_code == 200, resp.text

        with Session() as db:
            row = db.get(DeviceBlockedPeriod, pid)
            assert (row.start_time, row.end_time) == (UTC_START, UTC_END)


def test_schedule_patch_slot_converts_non_utc(api_client):
    with api_client(schedules_module, schedules_router, role="admin", user_id=7) as (client, Session):
        sid = _seed_schedule(Session)

        resp = client.patch(f"/api/schedules/{sid}", json={
            "start_time": LOCAL_START.isoformat(),
            "end_time": LOCAL_END.isoformat(),
        })
        assert resp.status_code == 200, resp.text

        with Session() as db:
            row = db.get(Schedule, sid)
            assert (row.start_time, row.end_time) == (UTC_START, UTC_END)


def test_schedule_confirm_with_explicit_slot_converts_non_utc(api_client):
    """確認排程時可以直接指定設備與時段，那條分支的時間同樣要換算。

    它跟上面那條走的是不同分支：這裡的時間會先拿去比對時段重疊，再落地。
    """
    with api_client(schedules_module, schedules_router, role="admin", user_id=7) as (client, Session):
        sid = _seed_schedule(Session)

        resp = client.patch(f"/api/schedules/{sid}", json={
            "status": "已確認",
            "device_id": "CH-01",
            "start_time": LOCAL_START.isoformat(),
            "end_time": LOCAL_END.isoformat(),
        })
        assert resp.status_code == 200, resp.text

        with Session() as db:
            row = db.get(Schedule, sid)
            assert (row.start_time, row.end_time) == (UTC_START, UTC_END)


def test_calibration_create_converts_non_utc(api_client):
    """校驗紀錄的兩個日期。這條路徑本來就有轉換，這裡是把它釘住不要退化。"""
    with api_client(maintenance_module, maintenance_router, role="admin", user_id=7) as (client, Session):
        resp = client.post("/api/devices/CH-01/calibrations", json={
            "calibration_date": LOCAL_START.isoformat(),
            "next_calibration_date": LOCAL_END.isoformat(),
            "result": "pass",
            "created_by": "測試員",
        })
        assert resp.status_code == 201, resp.text

        with Session() as db:
            row = db.get(DeviceCalibration, resp.json()["id"])
            assert (row.calibration_date, row.next_calibration_date) == (UTC_START, UTC_END)


def test_maintenance_create_converts_non_utc(api_client):
    """維護紀錄的兩個日期，同上。"""
    with api_client(maintenance_module, maintenance_router, role="admin", user_id=7) as (client, Session):
        resp = client.post("/api/devices/CH-01/maintenances", json={
            "maintenance_date": LOCAL_START.isoformat(),
            "maintenance_type": "定期保養",
            "description": "更換濾網",
            "performed_by": "測試員",
            "next_maintenance_date": LOCAL_END.isoformat(),
        })
        assert resp.status_code == 201, resp.text

        with Session() as db:
            row = db.get(DeviceMaintenance, resp.json()["id"])
            assert (row.maintenance_date, row.next_maintenance_date) == (UTC_START, UTC_END)


def test_loan_create_converts_non_utc_due_date(api_client):
    with api_client(fixtures_module, fixtures_router, role="admin", user_id=7) as (client, Session):
        fid = _seed_fixture(Session)

        resp = client.post("/api/fixtures/loans", json={
            "fixture_id": fid,
            "borrower_name": "測試人員",
            "quantity": 1,
            "due_date": LOCAL_END.isoformat(),
        })
        assert resp.status_code == 200, resp.text

        with Session() as db:
            loan = db.query(FixtureLoan).filter(FixtureLoan.fixture_id == fid).one()
            assert loan.due_date == UTC_END


def test_loan_extend_converts_non_utc_and_note_matches_stored_value(api_client):
    with api_client(fixtures_module, fixtures_router, role="admin", user_id=7) as (client, Session):
        fid = _seed_fixture(Session)
        with Session() as db:
            loan = FixtureLoan(
                fixture_id=fid, borrower_name="測試人員", quantity=1,
                status="loaned", loan_date=OTHER_START, due_date=OTHER_END,
            )
            db.add(loan)
            db.commit()
            lid = loan.id

        resp = client.post(f"/api/fixtures/loans/{lid}/extend", json={
            "new_due_date": LOCAL_END.isoformat(),
            "reason": "樣品延後",
        })
        assert resp.status_code == 200, resp.text

        with Session() as db:
            row = db.get(FixtureLoan, lid)
            assert row.due_date == UTC_END
            # 延期紀錄印的時間要跟實際存進去的一致，否則稽核軌跡對不上資料
            assert UTC_END.isoformat() in row.extension_note
