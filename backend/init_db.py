# backend/init_db.py
# ⚠️ 注意：此檔案僅供首次建立資料庫使用。
# 後續 DB 結構變更請使用 Alembic：
#   alembic revision --autogenerate -m "描述變更"
#   alembic upgrade head
import os
import json
import math
import datetime
from app.models import Base, engine, SessionLocal, User, Fixture, Schedule, SopExecution, DeviceData, ScheduleStatus, _utcnow
from app.auth import hash_password

print("正在建立資料表...")
Base.metadata.create_all(bind=engine)
print("✅ 資料表建立完成！")

_pwd = os.getenv("ADMIN_PASSWORD", "")
db = SessionLocal()
try:
    if _pwd and not db.query(User).filter(User.username == "admin").first():
        db.add(User(username="admin", display_name="Admin", hashed_password=hash_password(_pwd), role="admin"))
        db.commit()
        print("✅ Admin 帳號建立完成！")

    if db.query(Fixture).count() == 0:
        _demo_fixtures = [
            Fixture(priority=1, interface_type="USB Type-A", form_factor="Standard-A", size="4.5×12mm",
                    purpose="USB 2.0/3.0 訊號完整性測試", total_quantity=10, shortage=0,
                    keeper_name="林怡君", vendor="Molex", model_number="105450-0101",
                    unit_price=380, replacement_years="3", loan_count=4, is_active=True),
            Fixture(priority=2, interface_type="USB Type-C", form_factor="Receptacle", size="8.34×2.56mm",
                    purpose="USB PD / Alt-Mode 充放電測試", total_quantity=8, shortage=1,
                    keeper_name="林怡君", vendor="Amphenol", model_number="12401610E4#2A",
                    unit_price=520, replacement_years="2", loan_count=7, is_active=True),
            Fixture(priority=3, interface_type="HDMI", form_factor="Type-A Receptacle", size="13.9×4.45mm",
                    purpose="4K@60Hz 影像輸出驗證", total_quantity=5, shortage=0,
                    keeper_name="陳柏宇", vendor="JAE", model_number="TX24-30P-6ST",
                    unit_price=750, replacement_years="4", loan_count=2, is_active=True),
            Fixture(priority=4, interface_type="PCIe x16", form_factor="Edge Connector", size="98.0×8.5mm",
                    purpose="GPU 顯示卡高低溫功耗測試", total_quantity=3, shortage=0,
                    keeper_name="陳柏宇", vendor="Yamaichi", model_number="CP3-128B1-0100",
                    unit_price=2800, replacement_years="5", loan_count=1, is_active=True),
            Fixture(priority=5, interface_type="RJ-45", form_factor="8P8C Jack", size="15.88×13.46mm",
                    purpose="GbE / 2.5GbE 網路壓力測試", total_quantity=12, shortage=2,
                    keeper_name="王詠晴", vendor="Amphenol", model_number="RJHSE-5380",
                    unit_price=290, replacement_years="3", loan_count=9, is_active=True),
            Fixture(priority=6, interface_type="3.5mm Audio", form_factor="TRS Jack", size="Ø3.5mm",
                    purpose="音訊 THD+N / 頻響量測", total_quantity=6, shortage=0,
                    keeper_name="王詠晴", vendor="CUI Devices", model_number="SJ1-3515-SMT-TR",
                    unit_price=120, replacement_years="3", loan_count=3, is_active=True),
            Fixture(priority=7, interface_type="M.2 (M-Key)", form_factor="M.2 2280 Socket", size="22×80mm",
                    purpose="NVMe SSD 高低溫 I/O 效能測試", total_quantity=4, shortage=1,
                    keeper_name="林怡君", vendor="Kyocera", model_number="5031760892",
                    unit_price=1850, replacement_years="4", loan_count=5, is_active=True),
            Fixture(priority=8, interface_type="SD Card", form_factor="microSD Push-Pull", size="11×15mm",
                    purpose="記憶卡讀寫耐久性測試", total_quantity=15, shortage=0,
                    keeper_name="陳柏宇", vendor="Hirose", model_number="DM3AT-SF-PEJM5",
                    unit_price=95, replacement_years="2", loan_count=11, is_active=True),
        ]
        db.add_all(_demo_fixtures)
        db.commit()
        print(f"✅ Demo 治具資料 {len(_demo_fixtures)} 筆建立完成！")

    _now = _utcnow()

    if db.query(Schedule).count() == 0:
        _schedules = [
            Schedule(
                project_number="PRJ-2025-001", sample_name="車載 USB Hub 模組 v2",
                applicant_name="林怡君", device_id="CH-01",
                standard="IEC 60068-2-14", conditions=json.dumps(["IEC60068-2-14_TC"]),
                start_time=_now - datetime.timedelta(days=5),
                end_time=_now - datetime.timedelta(days=3),
                status=ScheduleStatus.DONE, current_condition_index=0,
            ),
            Schedule(
                project_number="PRJ-2025-002", sample_name="工業用 RJ-45 Switch",
                applicant_name="陳柏宇", device_id="CH-02",
                standard="IEC 60068-2-1", conditions=json.dumps(["IEC60068-2-1_Ab", "IEC60068-2-2_Bb"]),
                start_time=_now - datetime.timedelta(days=2),
                end_time=_now - datetime.timedelta(hours=6),
                status=ScheduleStatus.DONE, current_condition_index=1,
            ),
            Schedule(
                project_number="PRJ-2025-003", sample_name="PCIe x16 顯示卡擴充板",
                applicant_name="王詠晴", device_id=None,
                standard="IEC 60068-2-14", conditions=json.dumps(["IEC60068-2-14_TC"]),
                start_time=_now + datetime.timedelta(days=1),
                end_time=_now + datetime.timedelta(days=3),
                status=ScheduleStatus.PENDING, current_condition_index=0,
            ),
        ]
        db.add_all(_schedules)
        db.commit()
        print(f"✅ Demo 排程資料 {len(_schedules)} 筆建立完成！")

    if db.query(SopExecution).count() == 0:
        _executions = [
            SopExecution(
                sop_id="IEC60068-2-14_TC", device_id="CH-01", operator="林怡君",
                test_started_at=_now - datetime.timedelta(days=5),
                test_ended_at=_now - datetime.timedelta(days=3),
            ),
            SopExecution(
                sop_id="IEC60068-2-1_Ab", device_id="CH-02", operator="陳柏宇",
                test_started_at=_now - datetime.timedelta(days=2),
                test_ended_at=_now - datetime.timedelta(days=1),
            ),
        ]
        db.add_all(_executions)
        db.commit()
        print(f"✅ Demo SOP 執行紀錄 {len(_executions)} 筆建立完成！")

    if db.query(DeviceData).count() == 0:
        _device_data = []
        for i in range(60):
            t = _now - datetime.timedelta(minutes=(59 - i) * 2)
            # CH-01：模擬高低溫循環（-40°C → 85°C → -40°C）
            phase = (i / 60) * 2 * math.pi
            temp_ch01 = 22.5 + 62.5 * math.sin(phase)
            _device_data.append(DeviceData(device_id="CH-01", timestamp=t,
                temperature=round(temp_ch01, 1), humidity=round(45 + 5 * math.sin(phase * 0.5), 1)))
            # CH-02：模擬低溫測試（穩定在 -25°C）
            temp_ch02 = -25.0 + 0.5 * math.sin(phase * 3)
            _device_data.append(DeviceData(device_id="CH-02", timestamp=t,
                temperature=round(temp_ch02, 1), humidity=round(60 + 2 * math.sin(phase), 1)))
        db.add_all(_device_data)
        db.commit()
        print(f"✅ Demo 設備資料 {len(_device_data)} 筆建立完成！")
finally:
    db.close()
