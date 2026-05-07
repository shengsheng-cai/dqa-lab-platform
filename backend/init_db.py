# backend/init_db.py
# ⚠️ 注意：此檔案僅供首次建立資料庫使用。
# 後續 DB 結構變更請使用 Alembic：
#   alembic revision --autogenerate -m "描述變更"
#   alembic upgrade head
import json
import math
import random
import datetime
from app.models import (
    Base, engine, SessionLocal, Fixture, Schedule, SopExecution,
    DeviceData, DeviceState, ErrorLog, FixtureLoan, ScheduleFixture, ScheduleStatus, AuditLog, _utcnow,
    ensure_admin_user, DeviceCalibration, DeviceMaintenance,
)
from app.standards import STANDARDS_AND_SOPS

def _sop_json(sop_id):
    d = STANDARDS_AND_SOPS.get(sop_id, {})
    return json.dumps(d, ensure_ascii=False)

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
            # 待審核（排在 CH-01 RUNNING 結束後，CH-05 保持完全空閒）
            Schedule(
                project_number="PRJ-2026-003", sample_name="PCIe x16 顯示卡擴充板",
                applicant_name="王詠晴", device_id="CH-01",
                standard="IEC 60068-2-14",
                conditions=json.dumps(["iec60068_nb_-40_+85_5cycle"]),
                start_time=_now + datetime.timedelta(hours=24),
                end_time=_now + datetime.timedelta(hours=96),
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
            test_started_at=_now,
        )
        _exec_running_ch02 = SopExecution(
            sop_id="iec60068_ab_-25_16h", device_id="CH-02", operator="陳柏宇",
            test_started_at=_now,
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
                device_id="CH-01", status="RUNNING", temperature=25.0, humidity=52.0,
                sim_phase="ramp_to_low", sim_cycle=1,
                running_sop_id="iec60068_nb_-40_+85_5cycle",
                running_sop_name="Test Nb 漸進溫度循環：-40°C ↔ +85°C，2°C/min，5 循環",
                standard_id="iec60068_nb_-40_+85_5cycle",
                active_sop_json=_sop_json("iec60068_nb_-40_+85_5cycle"),
                started_at=_now,
                active_execution_id=_exec_running_ch01_id,
                updated_at=_now,
            ),
            DeviceState(
                device_id="CH-02", status="RUNNING", temperature=25.0, humidity=55.0,
                sim_phase="ramp_to_low", sim_cycle=1,
                running_sop_id="iec60068_ab_-25_16h",
                running_sop_name="低溫儲存 Test Ab：-25°C，16 小時（非通電）",
                standard_id="iec60068_ab_-25_16h",
                active_sop_json=_sop_json("iec60068_ab_-25_16h"),
                started_at=_now,
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
            # 逾期未還（due_date 已過，status 仍 loaned）
            FixtureLoan(
                fixture_id=_fmap["RJHSE-5380"].id, borrower_name="王詠晴",
                device_id="CH-05", project_name="PRJ-2026-008 工業 IoT 網關模組",
                quantity=3, loan_date=_now - datetime.timedelta(days=7),
                due_date=_now - datetime.timedelta(days=2),
                status="loaned",
            ),
            FixtureLoan(
                fixture_id=_fmap["DM3AT-SF-PEJM5"].id, borrower_name="陳柏宇",
                device_id="CH-04", project_name="PRJ-2026-002 工業用 RJ-45 Switch",
                quantity=2, loan_date=_now - datetime.timedelta(days=9),
                due_date=_now - datetime.timedelta(days=3),
                status="loaned",
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

    # ── 稽核日誌 ──────────────────────────────────────────────────────────
    if db.query(AuditLog).count() == 0:
        _smap3 = {s.project_number: s for s in db.query(Schedule).all()}
        _fmap3 = {f.model_number: f for f in db.query(Fixture).all()}

        def _ts(days=0, hours=0, minutes=0):
            return _now - datetime.timedelta(days=days, hours=hours, minutes=minutes)

        _audit_entries = [
            # ── 歷史已完成排程 ──────────────────────────────
            AuditLog(timestamp=_ts(days=14, hours=2),  actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-009"].id), detail="PRJ-2026-009 / 車用 HDMI 傳輸模組"),
            AuditLog(timestamp=_ts(days=13, hours=22), actor="1", role="admin", action="CONFIRM",   entity_type="schedule", entity_id=str(_smap3["PRJ-2026-009"].id), detail="PRJ-2026-009 / 車用 HDMI 傳輸模組"),
            AuditLog(timestamp=_ts(days=14),           actor="system:scheduler", role=None, action="AUTO_START", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-009"].id), detail="PRJ-2026-009 / 車用 HDMI 傳輸模組"),
            AuditLog(timestamp=_ts(days=11),           actor="1", role="admin", action="COMPLETE",  entity_type="schedule", entity_id=str(_smap3["PRJ-2026-009"].id), detail="PRJ-2026-009 / 車用 HDMI 傳輸模組"),

            AuditLog(timestamp=_ts(days=11),           actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-007"].id), detail="PRJ-2026-007 / PCIe x16 顯示卡散熱模組"),
            AuditLog(timestamp=_ts(days=10, hours=12), actor="1", role="admin", action="CONFIRM",   entity_type="schedule", entity_id=str(_smap3["PRJ-2026-007"].id), detail="PRJ-2026-007 / PCIe x16 顯示卡散熱模組"),
            AuditLog(timestamp=_ts(days=10),           actor="system:scheduler", role=None, action="AUTO_START", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-007"].id), detail="PRJ-2026-007 / PCIe x16 顯示卡散熱模組"),
            AuditLog(timestamp=_ts(days=7),            actor="1", role="admin", action="COMPLETE",  entity_type="schedule", entity_id=str(_smap3["PRJ-2026-007"].id), detail="PRJ-2026-007 / PCIe x16 顯示卡散熱模組"),

            AuditLog(timestamp=_ts(days=7),            actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-008"].id), detail="PRJ-2026-008 / 工業 IoT 網關模組"),
            AuditLog(timestamp=_ts(days=6, hours=16),  actor="1", role="admin", action="CONFIRM",   entity_type="schedule", entity_id=str(_smap3["PRJ-2026-008"].id), detail="PRJ-2026-008 / 工業 IoT 網關模組"),
            AuditLog(timestamp=_ts(days=6),            actor="system:scheduler", role=None, action="AUTO_START", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-008"].id), detail="PRJ-2026-008 / 工業 IoT 網關模組"),
            AuditLog(timestamp=_ts(days=4),            actor="1", role="admin", action="COMPLETE",  entity_type="schedule", entity_id=str(_smap3["PRJ-2026-008"].id), detail="PRJ-2026-008 / 工業 IoT 網關模組"),

            AuditLog(timestamp=_ts(days=6),            actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-001"].id), detail="PRJ-2026-001 / 車載 USB Hub 模組 v2"),
            AuditLog(timestamp=_ts(days=5, hours=16),  actor="1", role="admin", action="CONFIRM",   entity_type="schedule", entity_id=str(_smap3["PRJ-2026-001"].id), detail="PRJ-2026-001 / 車載 USB Hub 模組 v2"),
            AuditLog(timestamp=_ts(days=5),            actor="system:scheduler", role=None, action="AUTO_START", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-001"].id), detail="PRJ-2026-001 / 車載 USB Hub 模組 v2"),
            AuditLog(timestamp=_ts(days=3),            actor="1", role="admin", action="COMPLETE",  entity_type="schedule", entity_id=str(_smap3["PRJ-2026-001"].id), detail="PRJ-2026-001 / 車載 USB Hub 模組 v2"),

            AuditLog(timestamp=_ts(days=3),            actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-002"].id), detail="PRJ-2026-002 / 工業用 RJ-45 Switch"),
            AuditLog(timestamp=_ts(days=2, hours=16),  actor="1", role="admin", action="CONFIRM",   entity_type="schedule", entity_id=str(_smap3["PRJ-2026-002"].id), detail="PRJ-2026-002 / 工業用 RJ-45 Switch"),
            AuditLog(timestamp=_ts(days=2),            actor="system:scheduler", role=None, action="AUTO_START", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-002"].id), detail="PRJ-2026-002 / 工業用 RJ-45 Switch"),
            AuditLog(timestamp=_ts(hours=6),           actor="1", role="admin", action="COMPLETE",  entity_type="schedule", entity_id=str(_smap3["PRJ-2026-002"].id), detail="PRJ-2026-002 / 工業用 RJ-45 Switch"),

            # ── 進行中排程 ──────────────────────────────────
            AuditLog(timestamp=_ts(hours=3),           actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-004"].id), detail="PRJ-2026-004 / Wi-Fi 6E M.2 無線模組"),
            AuditLog(timestamp=_ts(hours=2, minutes=30), actor="1", role="admin", action="CONFIRM", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-004"].id), detail="PRJ-2026-004 / Wi-Fi 6E M.2 無線模組"),
            AuditLog(timestamp=_ts(hours=2),           actor="system:scheduler", role=None, action="AUTO_START", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-004"].id), detail="PRJ-2026-004 / Wi-Fi 6E M.2 無線模組"),

            AuditLog(timestamp=_ts(hours=5),           actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-005"].id), detail="PRJ-2026-005 / 低溫工作 NVMe SSD 模組"),
            AuditLog(timestamp=_ts(hours=4, minutes=30), actor="1", role="admin", action="CONFIRM", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-005"].id), detail="PRJ-2026-005 / 低溫工作 NVMe SSD 模組"),
            AuditLog(timestamp=_ts(hours=4),           actor="system:scheduler", role=None, action="AUTO_START", entity_type="schedule", entity_id=str(_smap3["PRJ-2026-005"].id), detail="PRJ-2026-005 / 低溫工作 NVMe SSD 模組"),

            # ── 已確認 / 待審核 ─────────────────────────────
            AuditLog(timestamp=_ts(hours=8),           actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-006"].id), detail="PRJ-2026-006 / 防水連接器 IP67 模組"),
            AuditLog(timestamp=_ts(hours=2),           actor="1", role="admin", action="CONFIRM",   entity_type="schedule", entity_id=str(_smap3["PRJ-2026-006"].id), detail="PRJ-2026-006 / 防水連接器 IP67 模組"),
            AuditLog(timestamp=_ts(minutes=30),        actor="1", role="admin", action="CREATE",    entity_type="schedule", entity_id=str(_smap3["PRJ-2026-003"].id), detail="PRJ-2026-003 / PCIe x16 顯示卡擴充板"),

            # ── 治具借出 ────────────────────────────────────
            AuditLog(timestamp=_ts(hours=2),  actor="1", role="admin", action="LOAN", entity_type="fixture", entity_id=str(_fmap3["12401610E4#2A"].id), detail="USB Type-C Receptacle x2，借用人：林怡君"),
            AuditLog(timestamp=_ts(hours=4),  actor="1", role="admin", action="LOAN", entity_type="fixture", entity_id=str(_fmap3["5031760892"].id),   detail="M.2 (M-Key) M.2 2280 Socket x1，借用人：陳柏宇"),
            AuditLog(timestamp=_ts(days=7),   actor="1", role="admin", action="LOAN", entity_type="fixture", entity_id=str(_fmap3["RJHSE-5380"].id),   detail="RJ-45 8P8C Jack x3，借用人：王詠晴"),
            AuditLog(timestamp=_ts(days=9),   actor="1", role="admin", action="LOAN", entity_type="fixture", entity_id=str(_fmap3["DM3AT-SF-PEJM5"].id), detail="SD Card microSD Push-Pull x2，借用人：陳柏宇"),
            AuditLog(timestamp=_ts(days=5),   actor="1", role="admin", action="LOAN", entity_type="fixture", entity_id=str(_fmap3["105450-0101"].id),  detail="USB Type-A Standard-A x3，借用人：林怡君"),
            AuditLog(timestamp=_ts(days=10),  actor="1", role="admin", action="LOAN", entity_type="fixture", entity_id=str(_fmap3["RJHSE-5380"].id),   detail="RJ-45 8P8C Jack x2，借用人：王詠晴"),
            AuditLog(timestamp=_ts(days=14),  actor="1", role="admin", action="LOAN", entity_type="fixture", entity_id=str(_fmap3["TX24-30P-6ST"].id), detail="HDMI Type-A Receptacle x1，借用人：林怡君"),

            # ── 治具歸還 ────────────────────────────────────
            AuditLog(timestamp=_ts(days=3),   actor="1", role="admin", action="RETURN", entity_type="fixture", entity_id=str(_fmap3["105450-0101"].id),  detail="loan#5，狀態：正常"),
            AuditLog(timestamp=_ts(days=7),   actor="1", role="admin", action="RETURN", entity_type="fixture", entity_id=str(_fmap3["RJHSE-5380"].id),   detail="loan#6，狀態：正常"),
            AuditLog(timestamp=_ts(days=11),  actor="1", role="admin", action="RETURN", entity_type="fixture", entity_id=str(_fmap3["TX24-30P-6ST"].id), detail="loan#7，狀態：正常"),

            # ── 緊急停止（歷史事件） ─────────────────────────
            AuditLog(timestamp=_ts(days=8),   actor="1", role="admin", action="EMERGENCY_STOP", entity_type="device", entity_id="CH-03", detail="操作人員：陳柏宇，測試：低溫儲存 Test Ab：-40°C，16 小時（非通電）"),
        ]
        db.add_all(_audit_entries)
        db.commit()
        print(f"✅ Demo 稽核日誌 {len(_audit_entries)} 筆建立完成！")

    # ── 設備校驗紀錄 ──────────────────────────────────────────────────────
    if db.query(DeviceCalibration).count() == 0:
        today = _utcnow()
        _calibrations = [
            DeviceCalibration(
                device_id="CH-01", calibration_date=datetime.datetime(2026, 1, 15),
                next_calibration_date=datetime.datetime(2027, 1, 15), interval_days=365,
                certificate_number="CAL-2026-001", result="pass", notes="年度校驗通過", created_by="admin",
            ),
            DeviceCalibration(
                device_id="CH-02", calibration_date=datetime.datetime(2025, 5, 22),
                next_calibration_date=today + datetime.timedelta(days=15), interval_days=365,
                certificate_number="CAL-2025-002", result="pass", notes="即將到期請安排", created_by="admin",
            ),
            DeviceCalibration(
                device_id="CH-03", calibration_date=datetime.datetime(2025, 3, 7),
                next_calibration_date=today - datetime.timedelta(days=60), interval_days=365,
                certificate_number="CAL-2025-003", result="pass", notes="逾期未重新校驗", created_by="admin",
            ),
            DeviceCalibration(
                device_id="CH-04", calibration_date=datetime.datetime(2026, 3, 1),
                next_calibration_date=datetime.datetime(2027, 3, 1), interval_days=365,
                certificate_number="CAL-2026-004", result="pass", notes="", created_by="admin",
            ),
        ]
        db.add_all(_calibrations)
        db.commit()
        print(f"✅ Demo 設備校驗紀錄 {len(_calibrations)} 筆建立完成！")

    # ── 設備維護紀錄 ──────────────────────────────────────────────────────
    if db.query(DeviceMaintenance).count() == 0:
        _maintenances = [
            DeviceMaintenance(
                device_id="CH-01", maintenance_date=datetime.datetime(2026, 2, 10),
                maintenance_type="preventive", description="更換密封條、清潔冷凝器",
                performed_by="王工程師", next_maintenance_date=datetime.datetime(2026, 8, 10),
            ),
            DeviceMaintenance(
                device_id="CH-02", maintenance_date=datetime.datetime(2026, 1, 20),
                maintenance_type="inspection", description="例行點檢，無異常",
                performed_by="李技術員", next_maintenance_date=datetime.datetime(2026, 7, 20),
            ),
            DeviceMaintenance(
                device_id="CH-03", maintenance_date=datetime.datetime(2026, 3, 5),
                maintenance_type="corrective", description="修復溫控板異常，已更換零件",
                performed_by="陳工程師", next_maintenance_date=None,
            ),
            DeviceMaintenance(
                device_id="CH-04", maintenance_date=datetime.datetime(2026, 4, 1),
                maintenance_type="preventive", description="潤滑傳動部件",
                performed_by="王工程師", next_maintenance_date=datetime.datetime(2026, 10, 1),
            ),
            DeviceMaintenance(
                device_id="CH-05", maintenance_date=datetime.datetime(2026, 2, 28),
                maintenance_type="inspection", description="例行點檢",
                performed_by="李技術員", next_maintenance_date=datetime.datetime(2026, 8, 28),
            ),
        ]
        db.add_all(_maintenances)
        db.commit()
        print(f"✅ Demo 設備維護紀錄 {len(_maintenances)} 筆建立完成！")

    # ── 設備時序資料 ──────────────────────────────────────────────────────
    if db.query(DeviceData).count() == 0:
        _device_data = []
        _rng = random.Random(42)
        _steps = 12  # 1h 常溫基線，每 5 分鐘一筆；simulator 啟動後自動累積 live 資料
        for i in range(_steps):
            t = _now - datetime.timedelta(minutes=(_steps - i) * 5)
            phase = i / _steps * 2 * math.pi
            for dev, base_t, base_h in [
                ("CH-01", 25.0, 52.0), ("CH-02", 25.0, 55.0),
                ("CH-03", 25.2, 54.5), ("CH-04", 24.8, 56.1), ("CH-05", 25.5, 53.8),
            ]:
                _device_data.append(DeviceData(
                    device_id=dev, timestamp=t,
                    temperature=round(base_t + _rng.gauss(0, 0.2) + 0.3 * math.sin(phase), 1),
                    humidity=round(max(30, min(90, base_h + _rng.gauss(0, 0.3))), 1),
                ))
        db.add_all(_device_data)
        db.commit()
        print(f"✅ Demo 設備基線資料 {len(_device_data)} 筆建立完成（simulator 啟動後持續累積）")
finally:
    db.close()
