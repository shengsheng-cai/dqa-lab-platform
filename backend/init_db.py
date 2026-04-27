# backend/init_db.py
# ⚠️ 注意：此檔案僅供首次建立資料庫使用。
# 後續 DB 結構變更請使用 Alembic：
#   alembic revision --autogenerate -m "描述變更"
#   alembic upgrade head
import json
import math
import datetime
from app.models import (
    Base, engine, SessionLocal, Fixture, Schedule, SopExecution,
    DeviceData, DeviceState, ErrorLog, FixtureLoan, ScheduleFixture, ScheduleStatus, _utcnow,
    ensure_admin_user,
)

print("正在建立資料表...")
Base.metadata.create_all(bind=engine)
print("✅ 資料表建立完成！")

ensure_admin_user()

db = SessionLocal()
try:

    # ── 治具 ──────────────────────────────────────────────────────────────
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

    # ── 排程 ──────────────────────────────────────────────────────────────
    _now = _utcnow()

    if db.query(Schedule).count() == 0:
        _schedules = [
            # 歷史完成
            Schedule(
                project_number="PRJ-2026-009", sample_name="車用 HDMI 傳輸模組",
                applicant_name="林怡君", device_id="CH-03",
                standard="IEC 60068-2-1",
                conditions=json.dumps(["iec60068_ab_-40_16h"]),
                start_time=_now - datetime.timedelta(days=14),
                end_time=_now - datetime.timedelta(days=11),
                status=ScheduleStatus.DONE, current_condition_index=0,
            ),
            Schedule(
                project_number="PRJ-2026-007", sample_name="PCIe x16 顯示卡散熱模組",
                applicant_name="王詠晴", device_id="CH-04",
                standard="IEC 60068-2-2",
                conditions=json.dumps(["iec60068_ba_+85_16h"]),
                start_time=_now - datetime.timedelta(days=10),
                end_time=_now - datetime.timedelta(days=7),
                status=ScheduleStatus.DONE, current_condition_index=0,
            ),
            Schedule(
                project_number="PRJ-2026-008", sample_name="工業 IoT 網關模組",
                applicant_name="陳柏宇", device_id="CH-04",
                standard="IEC 60068-2-30",
                conditions=json.dumps(["iec60068_db_25_55_6cycle"]),
                start_time=_now - datetime.timedelta(days=6),
                end_time=_now - datetime.timedelta(days=4),
                status=ScheduleStatus.DONE, current_condition_index=0,
            ),
            Schedule(
                project_number="PRJ-2026-001", sample_name="車載 USB Hub 模組 v2",
                applicant_name="林怡君", device_id="CH-01",
                standard="IEC 60068-2-14",
                conditions=json.dumps(["iec60068_nb_-40_+85_5cycle"]),
                start_time=_now - datetime.timedelta(days=5),
                end_time=_now - datetime.timedelta(days=3),
                status=ScheduleStatus.DONE, current_condition_index=0,
            ),
            Schedule(
                project_number="PRJ-2026-002", sample_name="工業用 RJ-45 Switch",
                applicant_name="陳柏宇", device_id="CH-02",
                standard="IEC 60068-2-1",
                conditions=json.dumps(["iec60068_ab_-25_16h"]),
                start_time=_now - datetime.timedelta(days=2),
                end_time=_now - datetime.timedelta(hours=6),
                status=ScheduleStatus.DONE, current_condition_index=0,
            ),
            # 進行中
            Schedule(
                project_number="PRJ-2026-004", sample_name="Wi-Fi 6E M.2 無線模組",
                applicant_name="林怡君", device_id="CH-01",
                standard="IEC 60068-2-14",
                conditions=json.dumps(["iec60068_nb_-40_+85_5cycle"]),
                start_time=_now - datetime.timedelta(hours=2),
                end_time=_now + datetime.timedelta(hours=22),
                status=ScheduleStatus.RUNNING, current_condition_index=0,
            ),
            Schedule(
                project_number="PRJ-2026-005", sample_name="低溫工作 NVMe SSD 模組",
                applicant_name="陳柏宇", device_id="CH-02",
                standard="IEC 60068-2-1",
                conditions=json.dumps(["iec60068_ab_-25_16h"]),
                start_time=_now - datetime.timedelta(hours=4),
                end_time=_now + datetime.timedelta(hours=20),
                status=ScheduleStatus.RUNNING, current_condition_index=0,
            ),
            # 已確認待開始
            Schedule(
                project_number="PRJ-2026-006", sample_name="防水連接器 IP67 模組",
                applicant_name="王詠晴", device_id="CH-03",
                standard="IEC 60068-2-78",
                conditions=json.dumps(["iec60068_cab_65_16h_95rh"]),
                start_time=_now + datetime.timedelta(days=1),
                end_time=_now + datetime.timedelta(days=2),
                status=ScheduleStatus.CONFIRMED, current_condition_index=0,
            ),
            # 待審核
            Schedule(
                project_number="PRJ-2026-003", sample_name="PCIe x16 顯示卡擴充板",
                applicant_name="王詠晴", device_id="CH-05",
                standard="IEC 60068-2-14",
                conditions=json.dumps(["iec60068_nb_-40_+85_5cycle"]),
                start_time=_now + datetime.timedelta(days=3),
                end_time=_now + datetime.timedelta(days=6),
                status=ScheduleStatus.PENDING, current_condition_index=0,
            ),
        ]
        db.add_all(_schedules)
        db.commit()
        print(f"✅ Demo 排程資料 {len(_schedules)} 筆建立完成！")

    # ── SOP 執行紀錄 ──────────────────────────────────────────────────────
    _exec_running_ch01_id = None
    _exec_running_ch02_id = None

    if db.query(SopExecution).count() == 0:
        _exec_done_1 = SopExecution(
            sop_id="iec60068_nb_-40_+85_5cycle", device_id="CH-01", operator="林怡君",
            test_started_at=_now - datetime.timedelta(days=5),
            test_ended_at=_now - datetime.timedelta(days=3),
        )
        _exec_done_2 = SopExecution(
            sop_id="iec60068_ab_-25_16h", device_id="CH-02", operator="陳柏宇",
            test_started_at=_now - datetime.timedelta(days=2),
            test_ended_at=_now - datetime.timedelta(hours=6),
        )
        _exec_done_3 = SopExecution(
            sop_id="iec60068_ba_+85_16h", device_id="CH-04", operator="王詠晴",
            test_started_at=_now - datetime.timedelta(days=10),
            test_ended_at=_now - datetime.timedelta(days=7),
        )
        _exec_done_4 = SopExecution(
            sop_id="iec60068_ab_-40_16h", device_id="CH-03", operator="林怡君",
            test_started_at=_now - datetime.timedelta(days=14),
            test_ended_at=_now - datetime.timedelta(days=11),
        )
        _exec_running_ch01 = SopExecution(
            sop_id="iec60068_nb_-40_+85_5cycle", device_id="CH-01", operator="林怡君",
            test_started_at=_now - datetime.timedelta(hours=2),
        )
        _exec_running_ch02 = SopExecution(
            sop_id="iec60068_ab_-25_16h", device_id="CH-02", operator="陳柏宇",
            test_started_at=_now - datetime.timedelta(hours=4),
        )
        db.add_all([_exec_done_1, _exec_done_2, _exec_done_3, _exec_done_4,
                    _exec_running_ch01, _exec_running_ch02])
        db.flush()
        _exec_running_ch01_id = _exec_running_ch01.id
        _exec_running_ch02_id = _exec_running_ch02.id
        db.commit()
        print("✅ Demo SOP 執行紀錄 6 筆建立完成！")

    # ── 設備狀態（重啟後由 simulator 恢復 sim_phase 繼續執行）────────────
    if db.query(DeviceState).count() == 0:
        db.add_all([
            DeviceState(
                device_id="CH-01", status="RUNNING", temperature=72.5, humidity=42.0,
                sim_phase="dwell_high", sim_cycle=2,
                running_sop_id="iec60068_nb_-40_+85_5cycle",
                running_sop_name="Test Nb 漸進溫度循環：-40°C ↔ +85°C，2°C/min，5 循環",
                standard_id="iec60068_nb_-40_+85_5cycle",
                started_at=_now - datetime.timedelta(hours=2),
                active_execution_id=_exec_running_ch01_id,
                updated_at=_now,
            ),
            DeviceState(
                device_id="CH-02", status="RUNNING", temperature=-24.8, humidity=62.0,
                sim_phase="dwell_low", sim_cycle=1,
                running_sop_id="iec60068_ab_-25_16h",
                running_sop_name="低溫儲存 Test Ab：-25°C，16 小時（非通電）",
                standard_id="iec60068_ab_-25_16h",
                started_at=_now - datetime.timedelta(hours=4),
                active_execution_id=_exec_running_ch02_id,
                updated_at=_now,
            ),
            DeviceState(device_id="CH-03", status="IDLE", temperature=25.2, humidity=54.5,
                        updated_at=_now),
            DeviceState(device_id="CH-04", status="IDLE", temperature=24.8, humidity=56.1,
                        updated_at=_now),
            DeviceState(device_id="CH-05", status="IDLE", temperature=25.5, humidity=53.8,
                        updated_at=_now),
        ])
        db.commit()
        print("✅ Demo 設備狀態 5 筆建立完成！")

    # ── 異常紀錄 ──────────────────────────────────────────────────────────
    if db.query(ErrorLog).count() == 0:
        db.add_all([
            ErrorLog(
                device_id="CH-03", error_type="temperature_deviation",
                sop_id="iec60068_ab_-40_16h",
                sop_name="低溫儲存 Test Ab：-40°C，16 小時（非通電）",
                temperature=-32.5, humidity=58.0,
                note="溫度偏差超過 ±3°C 容許值（目標 -40°C，實測 -32.5°C），已自動暫停並通知負責人",
                completed_steps=3, total_steps=8,
                created_at=_now - datetime.timedelta(days=8),
            ),
            ErrorLog(
                device_id="CH-01", error_type="sensor_timeout",
                sop_id=None, sop_name=None,
                temperature=None, humidity=None,
                note="CH-01 溫度感測器通訊逾時（5s），重連後自動恢復正常，無需人工介入",
                completed_steps=None, total_steps=None,
                created_at=_now - datetime.timedelta(days=12),
            ),
        ])
        db.commit()
        print("✅ Demo 異常紀錄 2 筆建立完成！")

    # ── 治具借還紀錄 ──────────────────────────────────────────────────────
    if db.query(FixtureLoan).count() == 0:
        _fmap = {f.model_number: f for f in db.query(Fixture).all()}
        _smap = {s.project_number: s for s in db.query(Schedule).all()}

        _loans = [
            # 進行中借出
            FixtureLoan(
                fixture_id=_fmap["12401610E4#2A"].id, borrower_name="林怡君",
                device_id="CH-01", project_name="PRJ-2026-004 Wi-Fi 6E M.2 無線模組",
                quantity=2, loan_date=_now - datetime.timedelta(hours=2),
                due_date=_now + datetime.timedelta(days=2),
                status="loaned", schedule_id=_smap["PRJ-2026-004"].id,
            ),
            FixtureLoan(
                fixture_id=_fmap["5031760892"].id, borrower_name="陳柏宇",
                device_id="CH-02", project_name="PRJ-2026-005 低溫工作 NVMe SSD 模組",
                quantity=1, loan_date=_now - datetime.timedelta(hours=4),
                due_date=_now + datetime.timedelta(days=2),
                status="loaned", schedule_id=_smap["PRJ-2026-005"].id,
            ),
            # 已歸還
            FixtureLoan(
                fixture_id=_fmap["105450-0101"].id, borrower_name="林怡君",
                device_id="CH-01", project_name="PRJ-2026-001 車載 USB Hub 模組 v2",
                quantity=3, loan_date=_now - datetime.timedelta(days=5),
                due_date=_now - datetime.timedelta(days=3),
                return_date=_now - datetime.timedelta(days=3),
                status="returned", return_condition="normal",
                schedule_id=_smap["PRJ-2026-001"].id,
            ),
            FixtureLoan(
                fixture_id=_fmap["RJHSE-5380"].id, borrower_name="王詠晴",
                device_id="CH-04", project_name="PRJ-2026-007 PCIe x16 顯示卡散熱模組",
                quantity=2, loan_date=_now - datetime.timedelta(days=10),
                due_date=_now - datetime.timedelta(days=7),
                return_date=_now - datetime.timedelta(days=7),
                status="returned", return_condition="normal",
                schedule_id=_smap["PRJ-2026-007"].id,
            ),
            FixtureLoan(
                fixture_id=_fmap["TX24-30P-6ST"].id, borrower_name="林怡君",
                device_id="CH-03", project_name="PRJ-2026-009 車用 HDMI 傳輸模組",
                quantity=1, loan_date=_now - datetime.timedelta(days=14),
                due_date=_now - datetime.timedelta(days=11),
                return_date=_now - datetime.timedelta(days=11),
                status="returned", return_condition="normal",
                schedule_id=_smap["PRJ-2026-009"].id,
            ),
        ]
        db.add_all(_loans)
        db.commit()
        print(f"✅ Demo 治具借還紀錄 {len(_loans)} 筆建立完成！")

    # ── 排程治具預約（schedule_fixtures）────────────────────────────────────
    if db.query(ScheduleFixture).count() == 0:
        _fmap2 = {f.model_number: f for f in db.query(Fixture).all()}
        _smap2 = {s.project_number: s for s in db.query(Schedule).all()}
        _sf_list = [
            # CONFIRMED 排程 PRJ-2026-006 預約 HDMI + USB Type-C 治具
            ScheduleFixture(
                schedule_id=_smap2["PRJ-2026-006"].id,
                fixture_id=_fmap2["TX24-30P-6ST"].id,
                quantity=1,
            ),
            ScheduleFixture(
                schedule_id=_smap2["PRJ-2026-006"].id,
                fixture_id=_fmap2["12401610E4#2A"].id,
                quantity=2,
            ),
            # PENDING 排程 PRJ-2026-003 預約 PCIe 治具
            ScheduleFixture(
                schedule_id=_smap2["PRJ-2026-003"].id,
                fixture_id=_fmap2["CP3-128B1-0100"].id,
                quantity=1,
            ),
        ]
        db.add_all(_sf_list)
        db.commit()
        print(f"✅ Demo 排程治具預約 {len(_sf_list)} 筆建立完成！")

    # ── 設備時序資料 ──────────────────────────────────────────────────────
    if db.query(DeviceData).count() == 0:
        _device_data = []
        for i in range(60):
            t = _now - datetime.timedelta(minutes=(59 - i) * 2)
            phase = (i / 60) * 2 * math.pi

            # CH-01：過去 2h 從 -35°C 升溫至 72.5°C（ramp_to_high → dwell_high）
            temp_ch01 = -35.0 + (i / 59) * 107.5 + 1.2 * math.sin(phase * 6)
            _device_data.append(DeviceData(device_id="CH-01", timestamp=t,
                temperature=round(temp_ch01, 1),
                humidity=round(42 + 3 * math.sin(phase * 0.5), 1)))

            # CH-02：穩定低溫 -25°C（dwell_low）
            temp_ch02 = -24.8 + 0.4 * math.sin(phase * 2.5)
            _device_data.append(DeviceData(device_id="CH-02", timestamp=t,
                temperature=round(temp_ch02, 1),
                humidity=round(62 + 1.5 * math.sin(phase), 1)))

            # CH-03/04/05：常溫待機
            _device_data.append(DeviceData(device_id="CH-03", timestamp=t,
                temperature=round(25.2 + 0.8 * math.sin(phase * 0.7), 1),
                humidity=round(54.5 + 1.2 * math.sin(phase * 0.5), 1)))
            _device_data.append(DeviceData(device_id="CH-04", timestamp=t,
                temperature=round(24.8 + 0.6 * math.sin(phase * 0.9), 1),
                humidity=round(56.1 + 1.0 * math.sin(phase * 0.4), 1)))
            _device_data.append(DeviceData(device_id="CH-05", timestamp=t,
                temperature=round(25.5 + 0.5 * math.sin(phase * 1.1), 1),
                humidity=round(53.8 + 0.8 * math.sin(phase * 0.6), 1)))

        db.add_all(_device_data)
        db.commit()
        print(f"✅ Demo 設備資料 {len(_device_data)} 筆建立完成！")
finally:
    db.close()
