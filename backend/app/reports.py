import io
import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from .models import SessionLocal, SopExecution, StepRecord, DeviceData
from .standards import get_standard, STANDARDS_AND_SOPS

router = APIRouter(prefix="/api/reports", tags=["reports"])

REPORT_VERSION = "1.0"
LAB_NAME = "DQA Lab - KSON AICM Digital Twin"


def _write(output: io.BytesIO, text: str):
    output.write((text + "\r\n").encode("big5", errors="replace"))


def _section(output: io.BytesIO, title: str):
    _write(output, "")
    _write(output, "=" * 60)
    _write(output, f"  {title}")
    _write(output, "=" * 60)


def _row(output: io.BytesIO, label: str, value):
    _write(output, f"  {label:<30}{value}")


@router.get("/csv/{execution_id}")
def download_csv_report(execution_id: int):
    """
    下載測試報告（依照 ISO/IEC 17025:2017 §7.8 格式）
    注意：
    - §7.8.6：符合性宣告（PASS/FAIL）須由授權人員判定，系統不自動產生
    - §7.5.1：技術記錄應包含責任人與日期
    - §8.4.2：原始數據依實際測試時間區間查詢，永久保存
    """
    db = SessionLocal()
    try:
        execution = (
            db.query(SopExecution).filter(SopExecution.id == execution_id).first()
        )
        if not execution:
            raise HTTPException(status_code=404, detail="找不到此執行紀錄")

        steps = (
            db.query(StepRecord)
            .filter(StepRecord.execution_id == execution_id)
            .order_by(StepRecord.step_id)
            .all()
        )

        # §7.5.2：依實際測試開始/結束時間查詢原始數據
        # 若前端有傳入 test_started_at / test_ended_at 則使用，
        # 否則以 created_at 前後各 24 小時作為備用區間（待前端整合後移除備用邏輯）
        if execution.test_started_at and execution.test_ended_at:
            start_time = execution.test_started_at
            end_time = execution.test_ended_at
        else:
            start_time = execution.created_at - datetime.timedelta(hours=24)
            end_time = execution.created_at + datetime.timedelta(hours=24)

        device_id_filter = execution.device_id or "KSON_CH01"
        device_records = (
            db.query(DeviceData)
            .filter(
                DeviceData.device_id == device_id_filter,
                DeviceData.timestamp >= start_time,
                DeviceData.timestamp <= end_time,
            )
            .order_by(DeviceData.timestamp)
            .all()
        )

        # 從 standards.py 取得測試條件
        sop_data = None
        standard_id = None
        for std_id, std_data in STANDARDS_AND_SOPS.items():
            if std_data.get("sop_id") == execution.sop_id:
                sop_data = std_data
                standard_id = std_id
                break

        standard = get_standard(standard_id) if standard_id else {}

        # 從 standards.py 讀取各標準專屬容差
        temp_tolerance = standard.get("temp_tolerance", 2.0)
        humi_tolerance = standard.get("humi_tolerance", 5.0)

        # 統計溫濕度數據
        temps = [r.temperature for r in device_records if r.temperature is not None]
        humis = [r.humidity for r in device_records if r.humidity is not None]

        temp_max = round(max(temps), 2) if temps else "N/A"
        temp_min = round(min(temps), 2) if temps else "N/A"
        temp_avg = round(sum(temps) / len(temps), 2) if temps else "N/A"
        humi_avg = round(sum(humis) / len(humis), 1) if humis else "N/A"

        target_high = standard.get("high_temperature") or standard.get(
            "target_temperature"
        )
        target_low = standard.get("low_temperature")

        # 產生報告
        output = io.BytesIO()
        report_no = f"RPT-{execution.created_at.strftime('%Y%m%d')}-{execution_id:03d}"

        _write(output, "")
        _write(output, "  " + "=" * 56)
        _write(output, f"  {LAB_NAME}")
        _write(output, "  環境測試報告  Environmental Test Report")
        _write(output, "  " + "=" * 56)

        # 1. 報告識別（ISO/IEC 17025:2017 §7.8.2）
        _section(output, "1. 報告識別  Report Identification")
        _row(output, "報告編號 Report No.:", report_no)
        _row(output, "報告版本 Version:", REPORT_VERSION)
        _row(
            output,
            "產生日期 Issue Date:",
            datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )
        _row(output, "執行記錄 ID:", execution_id)

        # 2. 受測樣品（§7.8.2.1 g, h）
        _section(output, "2. 受測樣品資訊  Test Item Information")
        _row(output, "設備編號 Device ID:", device_id_filter)
        _row(output, "SOP ID:", execution.sop_id)
        _row(
            output,
            "測試名稱 Test Name:",
            sop_data.get("name", "N/A") if sop_data else "N/A",
        )
        _row(
            output,
            "測試類型 Test Type:",
            sop_data.get("test_type", "N/A") if sop_data else "N/A",
        )
        _row(
            output,
            "SOP 版本 SOP Version:",
            sop_data.get("version", "N/A") if sop_data else "N/A",
        )
        _row(
            output,
            "參考法規 Reference:",
            standard.get("reference", "N/A") if standard else "N/A",
        )

        # 3. 測試條件（§7.8.3.1 a）
        _section(output, "3. 測試條件  Test Conditions")
        _row(output, "測試標準 Standard:", standard_id or "N/A")
        _row(output, "目標高溫 Target High (C):", target_high or "N/A")
        _row(output, "目標低溫 Target Low (C):", target_low or "N/A")
        _row(
            output,
            "升降溫速率 Ramp Rate (C/min):",
            standard.get("ramp_rate", "N/A") if standard else "N/A",
        )
        _row(
            output,
            "停留時間 Dwell Time (min):",
            standard.get("dwell_time", "N/A") if standard else "N/A",
        )
        _row(
            output,
            "循環次數 Cycles:",
            standard.get("cycles", "N/A") if standard else "N/A",
        )
        _row(
            output,
            "濕度設定 Humidity (%RH):",
            standard.get("humidity", "N/A") if standard else "N/A",
        )
        _row(output, "溫度容差 Temp Tolerance (C):", f"± {temp_tolerance}")
        _row(output, "濕度容差 Humi Tolerance (%RH):", f"± {humi_tolerance}")
        _row(
            output,
            "測試開始 Start Time:",
            execution.test_started_at.strftime("%Y-%m-%d %H:%M:%S")
            if execution.test_started_at
            else "N/A",
        )
        _row(
            output,
            "測試結束 End Time:",
            execution.test_ended_at.strftime("%Y-%m-%d %H:%M:%S")
            if execution.test_ended_at
            else "N/A",
        )
        _row(
            output,
            "紀錄建立 Record Created:",
            execution.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        )
        _row(output, "數據筆數 Data Points:", len(device_records))

        # 4. 步驟執行記錄（§7.5.1 責任人與日期）
        _section(output, "4. 步驟執行記錄  Step Execution Records")
        # §7.8.2.1 o：報告批准人識別
        _row(output, "執行人員 Operator:", execution.operator or "(待填寫)")
        _write(output, "")
        _write(output, f"  {'步驟':>6}  {'狀態':<12}")
        _write(output, "  " + "-" * 30)
        for step in steps:
            status = "完成" if step.completed else "未完成"
            _write(output, f"  Step {step.step_id:<4}  {status}")
        if not steps:
            _write(output, "  (無步驟記錄)")

        # 5. 測試數據統計（§7.8.3.1 c 量測不確定度）
        _section(output, "5. 測試數據統計  Measurement Summary")
        _row(output, "最高溫度 Max Temp (C):", temp_max)
        _row(output, "最低溫度 Min Temp (C):", temp_min)
        _row(output, "平均溫度 Avg Temp (C):", temp_avg)
        _row(output, "平均濕度 Avg Humi (%RH):", humi_avg)
        _row(
            output,
            "溫度容差範圍 Temp Limit (C):",
            f"{round(target_high - temp_tolerance, 1)} ~ {round(target_high + temp_tolerance, 1)}"
            if target_high
            else "N/A",
        )
        _row(output, "量測不確定度 Uncertainty:", "待儀器校正證書確認")

        # 6. 測試結論（§7.8.6 & §7.8.7）
        # 依照 ISO/IEC 17025:2017 §7.8.6：符合性宣告須由授權人員判定
        # 依照 §7.8.7.1：意見和解釋須由授權人員發佈
        # 系統僅提供數據統計，PASS/FAIL 由工程師人工判定後填寫
        _section(output, "6. 測試結論  Test Conclusion")
        _write(output, "  ※ 依照 ISO/IEC 17025:2017 §7.8.6 及 §7.8.7，")
        _write(output, "     符合性宣告及測試意見須由授權工程師人工判定。")
        _write(output, "")
        _row(output, "判定結果 Result:", "[          ]  (工程師人工填寫)")
        _row(
            output,
            "判定依據 Based on:",
            standard.get("reference", "IEC 60068") if standard else "IEC 60068",
        )
        _row(output, "判定人員 Judged by:", "(工程師簽名)")
        _row(output, "判定日期 Judge Date:", "(填寫日期)")

        # 7. 原始數據（§7.5.1 原始觀察結果）
        _section(output, "7. 原始溫濕度數據  Raw Temperature & Humidity Data")
        _write(output, f"  {'時間戳':<22}  {'溫度(C)':>10}  {'濕度(%RH)':>10}")
        _write(output, "  " + "-" * 48)
        for record in device_records:
            ts = record.timestamp.strftime("%Y-%m-%d %H:%M:%S")
            temp = (
                f"{round(record.temperature, 2):.2f}" if record.temperature else "N/A"
            )
            humi = f"{round(record.humidity, 1):.1f}" if record.humidity else "N/A"
            _write(output, f"  {ts:<22}  {temp:>10}  {humi:>10}")

        _write(output, "")
        _write(output, "  " + "=" * 56)
        _write(output, f"  報告結束  End of Report  [{report_no}]")
        _write(output, "  " + "=" * 56)
        _write(output, "")

        output.seek(0)
        filename = f"{report_no}_{execution.sop_id}.csv"

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    finally:
        db.close()


@router.get("/list")
def list_executions():
    """取得所有執行紀錄列表"""
    db = SessionLocal()
    try:
        executions = (
            db.query(SopExecution).order_by(SopExecution.created_at.desc()).all()
        )
        return [
            {
                "id": e.id,
                "sop_id": e.sop_id,
                "device_id": e.device_id,
                "operator": e.operator,
                "test_started_at": e.test_started_at.strftime("%Y-%m-%d %H:%M:%S")
                if e.test_started_at
                else None,
                "test_ended_at": e.test_ended_at.strftime("%Y-%m-%d %H:%M:%S")
                if e.test_ended_at
                else None,
                "created_at": e.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            }
            for e in executions
        ]
    finally:
        db.close()
