# backend/init_db.py
# ⚠️ 注意：此檔案供首次建立資料庫 + Docker build time seed demo 資料使用。
# 後續 DB 結構變更請使用 Alembic：
#   alembic revision --autogenerate -m "描述變更"
#   alembic upgrade head
import datetime
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.models import (
    Base, engine, ensure_admin_user, SessionLocal,
    DeviceCalibration, DeviceMaintenance, DeviceBlockedPeriod,
    DeviceData, DeviceState,
    ErrorLog,
    Fixture, FixtureLoan,
    PurchaseOrder,
    Schedule, SopExecution,
)
from app.sop import STANDARDS_AND_SOPS

random.seed(42)  # 固定 seed，波形可重現


def _dt(**kw) -> datetime.datetime:
    return datetime.datetime.utcnow() - datetime.timedelta(**kw)


print("正在建立資料表...")
Base.metadata.create_all(bind=engine)
print("✅ 資料表建立完成！")

ensure_admin_user()
print("✅ Admin 帳號就緒！")

print("正在寫入 Demo 資料...")

with SessionLocal() as db:

    # ── 1. Fixtures ────────────────────────────────────────────────
    f1 = Fixture(interface_type="M.2", form_factor="2280",
                 size="22×80mm", total_quantity=4, shortage=0,
                 keeper_name="陳工", vendor="固緯電子", unit_price=1200.0, loan_count=8)
    f2 = Fixture(interface_type="PCIe x4", form_factor="Half-Height",
                 size="167×76mm", total_quantity=2, shortage=0,
                 keeper_name="陳工", vendor="Molex", unit_price=3500.0, loan_count=3)
    f3 = Fixture(interface_type="USB-A", form_factor="Type-A 2.0",
                 total_quantity=6, shortage=0,
                 keeper_name="林工", unit_price=450.0, loan_count=15)
    f4 = Fixture(interface_type="USB-C", form_factor="Gen2",
                 total_quantity=3, shortage=1,
                 keeper_name="林工", vendor="Samtec", unit_price=2200.0, loan_count=6)
    f5 = Fixture(interface_type="RJ45", form_factor="1GbE",
                 total_quantity=5, shortage=0,
                 keeper_name="陳工", unit_price=800.0, loan_count=20)
    f6 = Fixture(interface_type="MXM", form_factor="MXM-B",
                 total_quantity=1, shortage=0,
                 keeper_name="王工", vendor="NVIDIA", unit_price=15000.0, loan_count=2)
    db.add_all([f1, f2, f3, f4, f5, f6])
    db.flush()

    # ── 2. Schedules ───────────────────────────────────────────────
    sch1 = Schedule(
        project_number="PRJ-2025-087", sample_name="IEC60068 熱循環模組測試",
        applicant_name="陳工", device_id="CH-01", standard="IEC 60068",
        conditions=json.dumps(["iec60068_nb_-40_+85_5cycle"]),
        start_time=_dt(hours=2), end_time=_dt(hours=-10),
        status="進行中", current_condition_index=0,
    )
    sch2 = Schedule(
        project_number="PRJ-2025-091", sample_name="EN50155 軌道車輛環境測試",
        applicant_name="林工", device_id="CH-02", standard="EN 50155",
        conditions=json.dumps(["iec60068_nb_-25_+70_3cycle"]),
        start_time=_dt(hours=3), end_time=_dt(hours=-7),
        status="進行中", current_condition_index=0,
    )
    sch3 = Schedule(
        project_number="PRJ-2025-095", sample_name="IEC61850 繼電保護裝置高溫測試",
        applicant_name="王工", device_id="CH-04", standard="IEC 61850-3",
        conditions=json.dumps(["iec61850_ed2_c1_high"]),
        start_time=_dt(hours=-20), end_time=_dt(hours=-36),
        status="已確認", current_condition_index=0,
    )
    sch4 = Schedule(
        project_number="PRJ-2025-099", sample_name="IEC60068 低溫儲存評估",
        applicant_name="張工", device_id=None, standard="IEC 60068",
        conditions=json.dumps(["iec60068_ab_-25_16h"]),
        status="待審核", current_condition_index=0,
    )
    sch5 = Schedule(
        project_number="PRJ-2025-072", sample_name="EN50155 完成品高低溫驗收",
        applicant_name="陳工", device_id="CH-04", standard="EN 50155",
        conditions=json.dumps(["en50155_2017_ot3_high", "en50155_2017_ot3_low"]),
        start_time=_dt(days=7), end_time=_dt(days=6),
        status="已完成", current_condition_index=1,
    )
    sch6 = Schedule(
        project_number="PRJ-2025-080", sample_name="IEC60068 濕熱循環測試",
        applicant_name="林工", device_id="CH-03", standard="IEC 60068",
        conditions=json.dumps(["iec60068_db_25_55_6cycle"]),
        status="已取消", current_condition_index=0,
        rejection_note="設備 CH-03 進入維修期，排程取消",
    )
    db.add_all([sch1, sch2, sch3, sch4, sch5, sch6])
    db.flush()

    # ── 3. SOP Executions ──────────────────────────────────────────
    ex1 = SopExecution(
        sop_id="iec60068_nb_-40_+85_5cycle", device_id="CH-01",
        operator="陳工", test_started_at=_dt(hours=2),
    )
    ex2 = SopExecution(
        sop_id="iec60068_nb_-25_+70_3cycle", device_id="CH-02",
        operator="林工", test_started_at=_dt(hours=3),
    )
    ex3 = SopExecution(
        sop_id="en50155_2017_ot3_high", device_id="CH-04",
        operator="陳工",
        test_started_at=_dt(days=7), test_ended_at=_dt(days=6),
    )
    db.add_all([ex1, ex2, ex3])
    db.flush()

    # ── 4. Device States ───────────────────────────────────────────
    def _sop_json(sop_id: str) -> str:
        data = dict(STANDARDS_AND_SOPS.get(sop_id, {}))
        data["sop_id"] = sop_id
        data["name"] = data.get("name", sop_id)
        return json.dumps(data, ensure_ascii=False)

    db.add_all([
        DeviceState(
            device_id="CH-01", status="RUNNING", temperature=85.0, humidity=50.2,
            running_sop_id="iec60068_nb_-40_+85_5cycle",
            running_sop_name="Test Nb 漸進溫度循環：-40°C ↔ +85°C，2°C/min，5 循環",
            standard_id="iec60068_nb_-40_+85_5cycle",
            active_sop_json=_sop_json("iec60068_nb_-40_+85_5cycle"),
            sim_phase="dwell_high", sim_cycle=1,
            started_at=_dt(hours=2),
            dwell_high_start=_dt(minutes=25),
            active_execution_id=ex1.id,
        ),
        DeviceState(
            device_id="CH-02", status="RUNNING", temperature=-25.0, humidity=48.5,
            running_sop_id="iec60068_nb_-25_+70_3cycle",
            running_sop_name="Test Nb 漸進溫度循環：-25°C ↔ +70°C，2°C/min，3 循環",
            standard_id="iec60068_nb_-25_+70_3cycle",
            active_sop_json=_sop_json("iec60068_nb_-25_+70_3cycle"),
            sim_phase="dwell_low", sim_cycle=1,
            started_at=_dt(hours=3),
            dwell_low_start=_dt(minutes=30),
            active_execution_id=ex2.id,
        ),
        DeviceState(device_id="CH-03", status="IDLE", temperature=25.0, humidity=55.0),
        DeviceState(device_id="CH-04", status="IDLE", temperature=25.0, humidity=55.0),
        DeviceState(device_id="CH-05", status="IDLE", temperature=25.0, humidity=55.0),
    ])

    # ── 5. Device Data（波形正確對齊 sim_phase）────────────────────
    # 每筆間隔 2 分鐘，共 60 筆 = 120 分鐘歷史
    # CH-01 dwell_high 85°C：ramp 25→-40（15pt）→ ramp -40→85（32pt）→ dwell 85（13pt）
    # CH-02 dwell_low -25°C：dwell 70（10pt）→ ramp 70→-25（35pt）→ dwell -25（15pt）
    INTERVAL = 2  # minutes

    def _linspace(start: float, end: float, n: int) -> list[float]:
        if n == 1:
            return [start]
        return [round(start + (end - start) * i / (n - 1), 1) for i in range(n)]

    def _dwell(temp: float, n: int, jitter: float = 0.3) -> list[float]:
        return [round(temp + random.uniform(-jitter, jitter), 1) for _ in range(n)]

    ch01_temps = _linspace(25.0, -40.0, 15) + _linspace(-40.0, 85.0, 32) + _dwell(85.0, 13)
    ch02_temps = _dwell(70.0, 10) + _linspace(70.0, -25.0, 35) + _dwell(-25.0, 15)

    records = []
    total = len(ch01_temps)  # 60
    for i, temp in enumerate(ch01_temps):
        ts = datetime.datetime.utcnow() - datetime.timedelta(minutes=INTERVAL * (total - i))
        records.append(DeviceData(
            device_id="CH-01", timestamp=ts,
            temperature=temp,
            humidity=round(50.0 + random.uniform(-2.0, 2.0), 1),
        ))
    for i, temp in enumerate(ch02_temps):
        ts = datetime.datetime.utcnow() - datetime.timedelta(minutes=INTERVAL * (total - i))
        records.append(DeviceData(
            device_id="CH-02", timestamp=ts,
            temperature=temp,
            humidity=round(52.0 + random.uniform(-2.0, 2.0), 1),
        ))
    db.add_all(records)

    # ── 6. DeviceBlockedPeriod（CH-03 維修中）─────────────────────
    db.add(DeviceBlockedPeriod(
        device_id="CH-03",
        start_time=_dt(days=2),
        end_time=_dt(days=-5),
        reason="冷凍壓縮機例行保養（每年一次）",
    ))

    # ── 7. Device Calibrations ─────────────────────────────────────
    db.add_all([
        DeviceCalibration(
            device_id="CH-01",
            calibration_date=datetime.datetime(2025, 11, 1),
            next_calibration_date=datetime.datetime(2026, 11, 1),
            interval_days=365, certificate_number="CAL-2025-001", result="pass",
            created_by="陳工", notes="溫度 ±0.3°C，濕度 ±1.5%RH，符合規範",
        ),
        DeviceCalibration(
            device_id="CH-02",
            calibration_date=datetime.datetime(2025, 6, 1),
            next_calibration_date=datetime.datetime(2026, 6, 1),
            interval_days=365, certificate_number="CAL-2025-002", result="pass",
            created_by="林工", notes="低溫精度 ±0.4°C，符合規範",
        ),
        DeviceCalibration(
            device_id="CH-03",
            calibration_date=datetime.datetime(2025, 4, 1),
            next_calibration_date=datetime.datetime(2026, 4, 1),
            interval_days=365, certificate_number="CAL-2025-003", result="pass",
            created_by="陳工", notes="校驗合格，下次校驗日期已逾期，待安排複校",
        ),
        DeviceCalibration(
            device_id="CH-04",
            calibration_date=datetime.datetime(2026, 1, 1),
            next_calibration_date=datetime.datetime(2027, 1, 1),
            interval_days=365, certificate_number="CAL-2026-001", result="pass",
            created_by="王工", notes="溫濕度全範圍校驗通過",
        ),
    ])

    # ── 8. Device Maintenances ─────────────────────────────────────
    db.add_all([
        DeviceMaintenance(
            device_id="CH-03", maintenance_date=_dt(days=2),
            maintenance_type="preventive",
            description="冷凍壓縮機冷媒補充、過濾器更換、電氣連接件點檢",
            performed_by="廠商技師（鑫泰制冷）",
            next_maintenance_date=_dt(days=-363),
        ),
        DeviceMaintenance(
            device_id="CH-01", maintenance_date=_dt(days=60),
            maintenance_type="routine",
            description="例行清潔，加熱管目視檢查，溫度均勻性確認",
            performed_by="陳工",
            next_maintenance_date=_dt(days=-305),
        ),
        DeviceMaintenance(
            device_id="CH-02", maintenance_date=_dt(days=25),
            maintenance_type="corrective",
            description="溫控板更換（原廠備料），更換後重新校驗確認",
            performed_by="廠商技師（安捷環境）",
        ),
    ])

    # ── 9. Fixture Loans ───────────────────────────────────────────
    db.add_all([
        FixtureLoan(
            fixture_id=f1.id, borrower_name="陳工",
            device_id="CH-01", project_name="PRJ-2025-087",
            quantity=2, loan_date=_dt(hours=2), due_date=_dt(hours=-10),
            status="loaned", schedule_id=sch1.id,
        ),
        FixtureLoan(
            fixture_id=f2.id, borrower_name="林工",
            device_id="CH-02", project_name="PRJ-2025-091",
            quantity=1, loan_date=_dt(hours=3), due_date=_dt(hours=-8),
            status="loaned", schedule_id=sch2.id,
        ),
        FixtureLoan(
            fixture_id=f5.id, borrower_name="陳工",
            device_id="CH-04", project_name="PRJ-2025-072",
            quantity=2, loan_date=_dt(days=7), due_date=_dt(days=6),
            return_date=_dt(days=6), status="returned", return_condition="normal",
            schedule_id=sch5.id,
        ),
        FixtureLoan(
            fixture_id=f4.id, borrower_name="張工",
            project_name="維修備料",
            quantity=1, loan_date=_dt(days=5), due_date=_dt(days=2),
            status="overdue",
        ),
    ])

    # ── 10. Error Logs ─────────────────────────────────────────────
    db.add_all([
        ErrorLog(
            device_id="CH-03", error_type="sensor_fault",
            sop_id="iec60068_db_25_55_6cycle", sop_name="濕熱循環 Test Db",
            temperature=42.3, humidity=91.2,
            note="PT100 溫度感測器斷路，測試中止，待廠商更換",
            completed_steps=3, total_steps=8,
            created_at=_dt(days=3),
        ),
        ErrorLog(
            device_id="CH-05", error_type="humidity_out_of_range",
            temperature=25.1, humidity=32.4,
            note="加濕器水位不足，濕度低於下限 40%RH，補水後恢復正常",
            created_at=_dt(days=8),
        ),
    ])

    # ── 11. Purchase Order ─────────────────────────────────────────
    db.add(PurchaseOrder(
        fixture_id=f4.id, quantity=3,
        vendor="Samtec Taiwan", unit_price=2200.0, total_price=6600.0,
        status="pending", note="補庫存，USB-C Gen2 治具因損耗造成缺貨",
    ))

    db.commit()

print("✅ Demo 資料寫入完成！")
