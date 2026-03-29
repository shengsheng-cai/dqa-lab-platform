import io
import os
import datetime
import urllib.parse
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from .models import SessionLocal, SopExecution, StepRecord, DeviceData
from .standards import STANDARDS_AND_SOPS
from . import uncertainty as unc

router = APIRouter(prefix="/api/reports", tags=["reports"])

REPORT_VERSION = "1.0"
LAB_NAME = "DQA Lab Digital Twin"
# fix: 限制單次查詢最大筆數，避免長時間測試資料塞爆記憶體
MAX_DATA_POINTS = 10000


def _write(output: io.BytesIO, text: str):
    output.write((text + "\r\n").encode("big5", errors="replace"))


def _section(output: io.BytesIO, title: str):
    _write(output, "")
    _write(output, "=" * 60)
    _write(output, f"  {title}")
    _write(output, "=" * 60)


def _row(output: io.BytesIO, label: str, value):
    _write(output, f"  {label:<30}{value}")


def _fmt_dt(dt) -> str:
    if dt is None:
        return "N/A"
    if isinstance(dt, datetime.datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return str(dt)


@router.get("/csv/{execution_id}")
def download_csv_report(execution_id: int):
    """
    下載測試報告（依照 ISO/IEC 17025:2017 §7.8 格式）
    注意：
    - §7.8.6：符合性宣告（PASS/FAIL）須由授權人員判定，系統不自動產生
    - §7.5.1：技術記錄應包含責任人與日期
    - §8.4.2：原始數據依實際測試時間區間查詢，永久保存
    """
    with SessionLocal() as db:
        execution, steps, device_records, truncated = _fetch_execution_data(execution_id, db)
        device_id_filter = execution.device_id or "CH-01"
        sop_data = STANDARDS_AND_SOPS.get(execution.sop_id, {})
        temp_tolerance = sop_data.get("temp_tolerance", 2.0)
        humi_tolerance = sop_data.get("humi_tolerance", 5.0)

        temps = [r.temperature for r in device_records if r.temperature is not None]
        humis = [r.humidity for r in device_records if r.humidity is not None]

        temp_max = round(max(temps), 2) if temps else "N/A"
        temp_min = round(min(temps), 2) if temps else "N/A"
        temp_avg = round(sum(temps) / len(temps), 2) if temps else "N/A"
        humi_avg = round(sum(humis) / len(humis), 1) if humis else "N/A"

        target_high = sop_data.get("high_temperature") or sop_data.get(
            "target_temperature"
        )
        target_low = sop_data.get("low_temperature")

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
        _row(output, "測試名稱 Test Name:", sop_data.get("name", "N/A"))
        _row(output, "測試類型 Test Type:", sop_data.get("test_type", "N/A"))
        _row(output, "SOP 版本 SOP Version:", sop_data.get("version", "N/A"))
        _row(output, "參考法規 Reference:", sop_data.get("reference", "N/A"))

        # 3. 測試條件（§7.8.3.1 a）
        _section(output, "3. 測試條件  Test Conditions")
        _row(output, "測試標準 Standard:", execution.sop_id)
        _row(output, "目標高溫 Target High (C):", target_high or "N/A")
        _row(output, "目標低溫 Target Low (C):", target_low or "N/A")
        _row(output, "升降溫速率 Ramp Rate (C/min):", sop_data.get("ramp_rate", "N/A"))
        _row(
            output, "停留時間 Dwell Time (h):", sop_data.get("dwell_time_hours", "N/A")
        )
        _row(output, "循環次數 Cycles:", sop_data.get("cycles", "N/A"))
        _row(
            output,
            "濕度設定 Humidity (%RH):",
            sop_data.get("humidity_rh_percent", "N/A"),
        )
        _row(output, "溫度容差 Temp Tolerance (C):", f"± {temp_tolerance}")
        _row(output, "濕度容差 Humi Tolerance (%RH):", f"± {humi_tolerance}")
        _row(output, "測試開始 Start Time:", _fmt_dt(execution.test_started_at))
        _row(output, "測試結束 End Time:", _fmt_dt(execution.test_ended_at))
        _row(output, "紀錄建立 Record Created:", _fmt_dt(execution.created_at))
        _row(
            output,
            "數據筆數 Data Points:",
            f"{len(device_records)}{' (已截斷，上限 ' + str(MAX_DATA_POINTS) + ' 筆)' if truncated else ''}"
            if execution.test_started_at
            else "測試時間未記錄",
        )

        # 4. 步驟執行記錄（§7.5.1 責任人與日期）
        _section(output, "4. 步驟執行記錄  Step Execution Records")
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
        _section(output, "6. 測試結論  Test Conclusion")
        _write(output, "  ※ 依照 ISO/IEC 17025:2017 §7.8.6 及 §7.8.7，")
        _write(output, "     符合性宣告及測試意見須由授權工程師人工判定。")
        _write(output, "")
        _row(output, "判定結果 Result:", "[          ]  (工程師人工填寫)")
        _row(output, "判定依據 Based on:", sop_data.get("reference", "IEC 60068"))
        _row(output, "判定人員 Judged by:", "(工程師簽名)")
        _row(output, "判定日期 Judge Date:", "(填寫日期)")

        # 7. 原始數據（§7.5.1 原始觀察結果）
        _section(output, "7. 原始溫濕度數據  Raw Temperature & Humidity Data")
        if truncated:
            _write(
                output,
                f"  ⚠️ 資料量超過上限（{MAX_DATA_POINTS} 筆），僅顯示前 {MAX_DATA_POINTS} 筆原始數據。",
            )
        if not device_records:
            _write(output, "  (測試時間未記錄或無原始數據)")
        else:
            _write(output, f"  {'時間戳':<22}  {'溫度(C)':>10}  {'濕度(%RH)':>10}")
            _write(output, "  " + "-" * 48)
            for record in device_records:
                ts = record.timestamp.strftime("%Y-%m-%d %H:%M:%S")
                temp = (
                    f"{round(record.temperature, 2):.2f}"
                    if record.temperature is not None
                    else "N/A"
                )
                humi = (
                    f"{round(record.humidity, 1):.1f}"
                    if record.humidity is not None
                    else "N/A"
                )
                _write(output, f"  {ts:<22}  {temp:>10}  {humi:>10}")

        _write(output, "")
        _write(output, "  " + "=" * 56)
        _write(output, f"  報告結束  End of Report  [{report_no}]")
        _write(output, "  " + "=" * 56)
        _write(output, "")

        output.seek(0)
        filename = f"{report_no}_{execution.sop_id}.csv"
        encoded_filename = urllib.parse.quote(filename)

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            },
        )


@router.get("/list")
def list_executions():
    with SessionLocal() as db:
        executions = (
            db.query(SopExecution).order_by(SopExecution.created_at.desc()).all()
        )
        return [
            {
                "id": e.id,
                "sop_id": e.sop_id,
                "sop_name": STANDARDS_AND_SOPS.get(e.sop_id, {}).get("name")
                or e.sop_id,
                "device_id": e.device_id,
                "operator": e.operator,
                "test_started_at": _fmt_dt(e.test_started_at),
                "test_ended_at": _fmt_dt(e.test_ended_at),
                "created_at": _fmt_dt(e.created_at),
                "photo_before": bool(getattr(e, "photo_before_path", None)),
                "photo_after": bool(getattr(e, "photo_after_path", None)),
            }
            for e in executions
        ]


def _fetch_execution_data(execution_id: int, db):
    """CSV / PDF 共用的 DB 查詢邏輯，回傳 (execution, steps, device_records, truncated)。"""
    execution = db.query(SopExecution).filter(SopExecution.id == execution_id).first()
    if not execution:
        raise HTTPException(status_code=404, detail="找不到此執行紀錄")

    steps = (
        db.query(StepRecord)
        .filter(StepRecord.execution_id == execution_id)
        .order_by(StepRecord.step_id)
        .all()
    )

    device_records = []
    truncated = False
    device_id_filter = execution.device_id or "CH-01"
    if execution.test_started_at and execution.test_ended_at:
        device_records = (
            db.query(DeviceData)
            .filter(
                DeviceData.device_id == device_id_filter,
                DeviceData.timestamp >= execution.test_started_at,
                DeviceData.timestamp <= execution.test_ended_at,
            )
            .order_by(DeviceData.timestamp)
            .limit(MAX_DATA_POINTS)
            .all()
        )
        truncated = len(device_records) == MAX_DATA_POINTS

    return execution, steps, device_records, truncated


# ─────────────────────────────────────────────────────────────────────────────
# PDF 報告（ISO/IEC 17025:2017）
# ─────────────────────────────────────────────────────────────────────────────

_CJK_FONT_NAME = "CJK"
_CJK_FONT_PATHS = [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
]
_cjk_font_resolved = "unset"  # sentinel; None = not available

def _get_cjk_font():
    """初次呼叫時偵測並註冊 CJK 字型，結果快取於模組變數。"""
    global _cjk_font_resolved
    if _cjk_font_resolved != "unset":
        return _cjk_font_resolved
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        for path in _CJK_FONT_PATHS:
            if os.path.exists(path):
                pdfmetrics.registerFont(TTFont(_CJK_FONT_NAME, path, subfontIndex=0))
                _cjk_font_resolved = _CJK_FONT_NAME
                return _CJK_FONT_NAME
    except Exception:
        pass
    _cjk_font_resolved = None
    return None


def _build_pdf(execution, steps, device_records, sop_data, report_no, truncated) -> bytes:
    font_name = _get_cjk_font() or "Helvetica"
    bold_font = font_name if font_name == _CJK_FONT_NAME else "Helvetica-Bold"

    base = ParagraphStyle("base", fontName=font_name, fontSize=9, leading=14,
                          spaceAfter=2)
    h1 = ParagraphStyle("h1", fontName=bold_font, fontSize=13, leading=18,
                        spaceAfter=4, textColor=colors.HexColor("#1f6feb"))
    h2 = ParagraphStyle("h2", fontName=bold_font, fontSize=10, leading=14,
                        spaceBefore=10, spaceAfter=4,
                        textColor=colors.HexColor("#58a6ff"))
    small = ParagraphStyle("small", fontName=font_name, fontSize=8, leading=12,
                           textColor=colors.HexColor("#8b949e"))
    warn = ParagraphStyle("warn", fontName=font_name, fontSize=8, leading=12,
                          textColor=colors.HexColor("#d29922"))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=2*cm, rightMargin=2*cm,
                            topMargin=2*cm, bottomMargin=2*cm)
    story = []

    _kv_style = TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#161b22")),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#30363d")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ])

    def kv_table(rows):
        t = Table([[Paragraph(k, small), Paragraph(str(v), base)] for k, v in rows],
                  colWidths=[5*cm, None])
        t.setStyle(_kv_style)
        return t

    device_id = execution.device_id or "CH-01"
    temps = [r.temperature for r in device_records if r.temperature is not None]
    humis = [r.humidity for r in device_records if r.humidity is not None]
    temp_tolerance = sop_data.get("temp_tolerance", 2.0)
    humi_tolerance = sop_data.get("humi_tolerance", 5.0)
    target_high = sop_data.get("high_temperature") or sop_data.get("target_temperature")
    target_low = sop_data.get("low_temperature")
    humi_target = sop_data.get("humidity_rh_percent")

    # ── 封面 ──────────────────────────────────────────────────────────────────
    story.append(Paragraph("DQA Lab Digital Twin", h1))
    story.append(Paragraph(
        "環境測試報告 Environmental Test Report" if font_name == _CJK_FONT_NAME
        else "Environmental Test Report",
        ParagraphStyle("sub", fontName=bold_font, fontSize=11, leading=16,
                       textColor=colors.HexColor("#c9d1d9"))))
    story.append(HRFlowable(width="100%", thickness=1,
                            color=colors.HexColor("#30363d"), spaceAfter=10))

    # ── 1. 報告識別 ───────────────────────────────────────────────────────────
    story.append(Paragraph("1. 報告識別  Report Identification", h2))
    story.append(kv_table([
        ["報告編號 Report No.", report_no],
        ["產生日期 Issue Date", datetime.datetime.now().strftime("%Y-%m-%d %H:%M")],
        ["執行記錄 Execution ID", str(execution.id)],
    ]))

    # ── 2. 受測樣品 ───────────────────────────────────────────────────────────
    story.append(Paragraph("2. 受測樣品  Test Item", h2))
    story.append(kv_table([
        ["設備編號 Device ID", device_id],
        ["SOP ID", execution.sop_id],
        ["測試名稱 Test Name", sop_data.get("name", "N/A")],
        ["參考法規 Reference", sop_data.get("reference", "N/A")],
        ["SOP 版本 SOP Version", sop_data.get("version", "N/A")],
    ]))

    # ── 3. 測試條件 ───────────────────────────────────────────────────────────
    story.append(Paragraph("3. 測試條件  Test Conditions", h2))
    story.append(kv_table([
        ["目標高溫 Target High", f"{target_high} °C" if target_high else "N/A"],
        ["目標低溫 Target Low", f"{target_low} °C" if target_low else "N/A"],
        ["升降溫速率 Ramp Rate", f"{sop_data.get('ramp_rate', 'N/A')} °C/min"],
        ["停留時間 Dwell Time", f"{sop_data.get('dwell_time_hours', 'N/A')} h"],
        ["循環次數 Cycles", str(sop_data.get("cycles", "N/A"))],
        ["濕度設定 Humidity", f"{humi_target} %RH" if humi_target else "N/A"],
        ["溫度容差 Temp Tolerance", f"± {temp_tolerance} °C"],
        ["測試開始 Start Time", _fmt_dt(execution.test_started_at)],
        ["測試結束 End Time", _fmt_dt(execution.test_ended_at)],
    ]))

    # ── 4. 步驟記錄 ───────────────────────────────────────────────────────────
    story.append(Paragraph("4. 步驟執行記錄  Step Records", h2))
    story.append(Paragraph(
        f"執行人員 Operator: {execution.operator or '(未填寫)'}",
        base))
    if steps:
        step_data = [[
            Paragraph("步驟 Step", small),
            Paragraph("狀態 Status", small),
        ]]
        for s in steps:
            status = "✔ 完成" if s.completed else "✘ 未完成"
            step_data.append([
                Paragraph(f"Step {s.step_id}", base),
                Paragraph(status, base),
            ])
        ts = Table(step_data, colWidths=[3*cm, None])
        ts.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#21262d")),
            ("GRID", (0,0), (-1,-1), 0.3, colors.HexColor("#30363d")),
            ("LEFTPADDING", (0,0), (-1,-1), 6),
            ("TOPPADDING", (0,0), (-1,-1), 3),
            ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ]))
        story.append(ts)
    else:
        story.append(Paragraph("(無步驟記錄)", small))

    # ── 5. 量測不確定度（核心新功能）────────────────────────────────────────
    story.append(Paragraph("5. 量測不確定度分析  Measurement Uncertainty (GUM)", h2))

    u_temp = None
    u_humi = None

    if temps and target_high is not None:
        u_temp = unc.calc_temp(temps, float(target_high), float(temp_tolerance))
    if humis and humi_target is not None:
        u_humi = unc.calc_humi(humis, float(humi_target), float(humi_tolerance))

    def _unc_table(u: unc.UncertaintyResult, qty_label: str):
        header = [Paragraph(h, ParagraphStyle("th", fontName=bold_font,
                                              fontSize=8, leading=12,
                                              textColor=colors.white))
                  for h in ["不確定度來源 Source", "類型\nType", "分佈\nDist.",
                             "標準不確定度\nu(xi)"]]
        data = [header]
        stable_note = "穩定段" if u.using_stable_only else "全段"
        data.append([
            Paragraph(f"重複測量（{stable_note} n={u.n}）\nRepeated measurement", base),
            Paragraph("A", base),
            Paragraph("常態 Normal", base),
            Paragraph(f"{u.uA:.4f} {u.unit}", base),
        ])
        data.append([
            Paragraph(f"感測器解析度 {unc.TEMP_RESOLUTION if u.unit=='°C' else unc.HUMI_RESOLUTION} {u.unit}\nSensor resolution", base),
            Paragraph("B", base),
            Paragraph("矩形 Rect.", base),
            Paragraph(f"{u.uB:.4f} {u.unit}", base),
        ])
        data.append([
            Paragraph("組合標準不確定度 uc\nCombined standard uncertainty", base),
            Paragraph("—", base),
            Paragraph("—", base),
            Paragraph(f"{u.uc:.4f} {u.unit}", base),
        ])
        data.append([
            Paragraph("擴充不確定度 U（k=2, 95%）\nExpanded uncertainty", base),
            Paragraph("—", base),
            Paragraph("—", base),
            Paragraph(f"<b>{u.U:.4f} {u.unit}</b>", base),
        ])
        tw = Table(data, colWidths=[6.5*cm, 1.5*cm, 2.5*cm, None])
        tw.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1f6feb")),
            ("GRID", (0,0), (-1,-1), 0.3, colors.HexColor("#30363d")),
            ("LEFTPADDING", (0,0), (-1,-1), 6),
            ("TOPPADDING", (0,0), (-1,-1), 3),
            ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ("ROWBACKGROUNDS", (0,1), (-1,-1),
             [colors.HexColor("#0d1117"), colors.HexColor("#161b22")]),
        ]))
        result_text = (
            f"<b>量測結果：{qty_label} = {u.mean:.2f} ± {u.U:.4f} {u.unit}</b>"
            f"　（k = {u.k}，信賴水準 ≈ 95%）"
        )
        return [tw, Spacer(1, 4),
                Paragraph(result_text,
                          ParagraphStyle("result", fontName=bold_font, fontSize=9,
                                         leading=13,
                                         textColor=colors.HexColor("#3fb950")))]

    if u_temp:
        story.append(Paragraph("5.1 溫度不確定度 Temperature Uncertainty", h2))
        if u_temp.note:
            story.append(Paragraph(f"⚠ {u_temp.note}", warn))
        story.extend(_unc_table(u_temp, "T"))
    else:
        story.append(Paragraph("(溫度數據不足，無法計算不確定度)", small))

    if u_humi:
        story.append(Spacer(1, 8))
        story.append(Paragraph("5.2 濕度不確定度 Humidity Uncertainty", h2))
        if u_humi.note:
            story.append(Paragraph(f"⚠ {u_humi.note}", warn))
        story.extend(_unc_table(u_humi, "RH"))

    story.append(Paragraph(
        "※ Type B 僅含感測器解析度；校正證書誤差須取得後另行補充。",
        warn))

    # ── 6. 數據統計 ───────────────────────────────────────────────────────────
    story.append(Paragraph("6. 數據統計  Measurement Summary", h2))
    temp_max = round(max(temps), 2) if temps else "N/A"
    temp_min = round(min(temps), 2) if temps else "N/A"
    temp_avg = round(sum(temps)/len(temps), 2) if temps else "N/A"
    humi_avg = round(sum(humis)/len(humis), 1) if humis else "N/A"
    data_note = (f"{len(device_records)} 筆"
                 + (f" (已截斷，上限 {MAX_DATA_POINTS} 筆)" if truncated else ""))
    story.append(kv_table([
        ["最高溫度 Max Temp", f"{temp_max} °C"],
        ["最低溫度 Min Temp", f"{temp_min} °C"],
        ["平均溫度 Avg Temp", f"{temp_avg} °C"],
        ["平均濕度 Avg Humi", f"{humi_avg} %RH"],
        ["數據筆數 Data Points", data_note if device_records else "測試時間未記錄"],
    ]))

    # ── 7. 測試結論 ───────────────────────────────────────────────────────────
    story.append(Paragraph("7. 測試結論  Test Conclusion", h2))
    story.append(Paragraph(
        "依照 ISO/IEC 17025:2017 §7.8.6 及 §7.8.7，"
        "符合性宣告及測試意見須由授權工程師人工判定，不由系統自動產生。",
        base))
    story.append(kv_table([
        ["判定結果 Result", "[ __________ ]  (工程師人工填寫)"],
        ["判定依據 Based on", sop_data.get("reference", "IEC 60068")],
        ["判定人員 Judged by", "(工程師簽名)"],
        ["判定日期 Judge Date", "(填寫日期)"],
    ]))

    # ── 頁尾 ──────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.5,
                            color=colors.HexColor("#30363d")))
    story.append(Paragraph(
        f"報告結束  End of Report  [{report_no}]",
        ParagraphStyle("footer", fontName=font_name, fontSize=8, leading=12,
                       textColor=colors.HexColor("#484f58"), alignment=1)))

    doc.build(story)
    return buf.getvalue()


@router.get("/pdf/{execution_id}")
def download_pdf_report(execution_id: int):
    """
    下載 PDF 測試報告（含量測不確定度分析）
    依照 ISO/IEC 17025:2017 §7.6 量測不確定度、§7.8 報告格式
    """
    with SessionLocal() as db:
        execution, steps, device_records, truncated = _fetch_execution_data(execution_id, db)
        sop_data = STANDARDS_AND_SOPS.get(execution.sop_id, {})
        report_no = f"RPT-{execution.created_at.strftime('%Y%m%d')}-{execution_id:03d}"

        pdf_bytes = _build_pdf(
            execution, steps, device_records, sop_data, report_no, truncated
        )

        filename = f"{report_no}_{execution.sop_id}.pdf"
        encoded_filename = urllib.parse.quote(filename)
        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            },
        )
