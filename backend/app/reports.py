import io
import os
import datetime
import urllib.parse
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from .models import SessionLocal, Schedule, SopExecution, StepRecord, DeviceData
from .standards import STANDARDS_AND_SOPS
from .constants import DEVICE_IDS
from . import uncertainty as unc
from .utils import _now_utc

router = APIRouter(prefix="/api/reports", tags=["reports"])

REPORT_VERSION = "1.0"
LAB_NAME = "DQA Lab Platform"
# §7.8.2.1(b) 要求實驗室名稱與地址。本專案是作品展示、沒有實體實驗室，
# 因此誠實標示為模擬環境，不掛一個編出來的地址冒充受認證實驗室。
LAB_ADDRESS = "作品展示用模擬實驗室，無實體地址  Portfolio demonstration laboratory (simulated); no physical address"
# §7.8.2.1(l)
RESULTS_SCOPE_STATEMENT = "本報告結果僅適用於本次所測之樣品。  The results relate only to the items tested."
# 執行紀錄沒接到排程時，樣品欄位要明示沒有案件，不能拿設備編號冒充樣品資訊。
NO_CASE_TEXT = "(臨時測試，無對應案件)  Ad-hoc test; no associated case"
# 報告只讀取固定上限，避免長時間測試累積的資料一次塞滿記憶體。
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


def _primary_setpoint(sop_data: dict):
    """這支 SOP 的主設定點：雙溫是高溫那端，單溫就是它唯一的那個點。

    單溫冷測（如 Test Ab −40°C）只填 low_temperature 與 target_temperature，
    所以這裡會回傳負值——名字不叫 high 就是為了不讓人以為冷測會回 None。
    """
    v = sop_data.get("high_temperature")
    return v if v is not None else sop_data.get("target_temperature")


# 雙溫的兩端只有這一份名字與順序（高溫在前），段名與目標溫度列都吃它
TEMP_SEGMENT_NAMES = (("高溫", "High"), ("低溫", "Low"))


def _temperature_segments(sop_data: dict) -> list[tuple[str, str, float]]:
    """這次測試要分別交代的溫度段，回傳 [(中文段名, 英文段名, 目標溫度)]。

    雙溫循環在高溫與低溫各停留數小時，兩段是分別要驗證的對象，各有各的容差。
    只算高溫那段的話，報告的「最低溫度」會印成高溫段裡最低的那一筆——例如
    −25↔+70 的測試印出 69.8°C，而實際跑到 −25.3°C，低溫段等於沒發生過。
    單溫測試只有一段，但段名照樣寫出是冷測還是熱測——不分段和不標形狀是兩件事，
    同一份報告的條件節已經寫「目標低溫 −40°C」，統計節不該又回到中性的說法。
    """
    high = _primary_setpoint(sop_data)
    low = sop_data.get("low_temperature")
    # 算不算雙溫跟模擬器同一條判準（`simulator.py` 的 is_two_temp、`utils.py` 的
    # curve_total_minutes 都是差距超過 0.1 才算兩段），不然模擬器只跑一段的測試，
    # 報告會多長出一段從來沒發生過的低溫統計。
    # 另外單溫的低溫測試（如 Test Ab −40°C）只填 low_temperature 與 target_temperature，
    # 而 _primary_setpoint 會退回 target_temperature，兩邊本來就拿到同一個值。
    if high is not None and low is not None and abs(float(high) - float(low)) > 0.1:
        return [
            (zh, en, float(value))
            for (zh, en), value in zip(TEMP_SEGMENT_NAMES, (high, low))
        ]
    only = high if high is not None else low
    if only is None:
        return []
    # 冷熱只有「有沒有填 high_temperature」講得準：熱測有 +5°C 這種正值不高的，
    # 冷測也不保證是負值，拿溫度正負去猜會猜錯
    zh, en = TEMP_SEGMENT_NAMES[1] if sop_data.get("high_temperature") is None \
        else TEMP_SEGMENT_NAMES[0]
    return [(zh, en, float(only))]


def _setpoint_rows(sop_data: dict) -> list[tuple[str, str]]:
    """「測試條件」那節的目標溫度列，依這支 SOP 真正有幾個設定點決定標籤。

    以前固定印「目標高溫」與「目標低溫」兩列，而單溫冷測只填 low_temperature 與
    target_temperature，`_primary_setpoint` 會退回那個負值——於是 24 支冷測的報告都
    印成「目標高溫 −40°C」，一個叫高溫的欄位寫著零下四十度。熱測則兩列印同一個值。
    """
    segments = _temperature_segments(sop_data)
    if not segments:
        return [("目標溫度 Target Temp", "N/A")]
    # 形狀在 _temperature_segments 判過了，這裡只把段名換成欄位標籤，不再自己讀 sop_data
    return [(f"目標{zh} Target {en}", f"{target} °C") for zh, en, target in segments]


def _fmt_dt(dt) -> str:
    if dt is None:
        return "N/A"
    if isinstance(dt, datetime.datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return str(dt)


def _report_no(execution) -> str:
    """報告編號。CSV 與 PDF 共用同一份算式，兩種格式的同一筆紀錄編號才會一致。"""
    return f"RPT-{execution.created_at.strftime('%Y%m%d')}-{execution.id:03d}"


def _compute_uncertainties(temps, humis, segments, humi_target, temp_tolerance, humi_tolerance):
    """CSV 與 PDF 共用：算出各溫度段與濕度的不確定度分析。

    回傳 (溫度段清單, u_humi)，溫度段是 [(段名, 目標, UncertaintyResult)]；沒有數據或
    沒有目標時回傳空清單。兩種格式都呼叫這個函式，結構上保證同一筆執行紀錄下載兩種
    格式時，摘要統計（見 `_summary_avg`/`_summary_stats`）用的是同一段資料。
    """
    temp_results = []
    if temps:
        multi_segment = len(segments) > 1
        for zh, en, target in segments:
            u = unc.calc_temp(temps, target, float(temp_tolerance))
            if u is None:
                continue
            # 分段時不接受「穩定段不足就改用全段」那個退回：全段裡有另一段的資料，
            # 低溫段會拿高溫段的數字算出平均，報告等於捏造一段從沒跑到的低溫。
            # 中止在高溫階段的雙溫測試就會走到這裡，那時低溫段一筆資料都沒有。
            if multi_segment and not u.using_stable_only:
                temp_results.append((zh, en, target, None))
                continue
            temp_results.append((zh, en, target, u))
    u_humi = None
    if humis and humi_target is not None:
        u_humi = unc.calc_humi(humis, float(humi_target), float(humi_tolerance))
    return temp_results, u_humi


def _case_info(db, execution) -> dict:
    """報告的受測樣品識別（§7.8.2.1 e、g）。樣品名稱／案號／客戶都在 Schedule 上，
    執行紀錄靠 schedule_id 連過去。沒接到排程時誠實回報沒有案件，不退回去印設備編號——
    印設備編號正是 BUG-009：那識別的是試驗箱，不是受測樣品。CSV 與 PDF 共用這一份，
    兩種格式的樣品識別不會各講一套。
    """
    schedule = (
        db.get(Schedule, execution.schedule_id)
        if execution.schedule_id is not None
        else None
    )
    if schedule is None:
        return {"sample_name": NO_CASE_TEXT, "project_number": "N/A", "customer": "N/A"}
    return {
        "sample_name": schedule.sample_name or "N/A",
        "project_number": schedule.project_number or "N/A",
        "customer": schedule.applicant_name or "N/A",
    }


def _summary_avg(u: Optional[unc.UncertaintyResult], raw_values: list, ndigits: int):
    """報告「數據統計」的平均值。有不確定度分析時直接沿用 u.mean（跟不確定度分析
    取同一段資料：u.data，即穩定段或其退回段），沒有時（如無 target）才退回全段
    raw_values 自算。避免報告因兩處取不同資料窗，印出兩個矛盾的平均值。
    資料為空時回傳 "N/A"。
    """
    data = u.data if u else raw_values
    if not data:
        return "N/A"
    return round(u.mean, ndigits) if u else round(sum(data) / len(data), ndigits)


def _summary_stats(u: Optional[unc.UncertaintyResult], raw_values: list, ndigits: int):
    """同 `_summary_avg`，另外回傳 max/min，供需要溫度範圍的呼叫點使用。
    回傳 (max, min, avg)，資料為空時三者皆為 "N/A"。
    """
    data = u.data if u else raw_values
    if not data:
        return "N/A", "N/A", "N/A"
    return round(max(data), ndigits), round(min(data), ndigits), _summary_avg(u, raw_values, ndigits)


# ── 報告內容 ────────────────────────────────────────────────────────────────
# 欄位清單與空值寫法只有這一份，CSV 與 PDF 都拿它去排版。以前兩種格式各寫一次，
# 於是 PDF 少了報告版本、測試類型、濕度容差與紀錄建立四列，執行人員空白時一個寫
# 「(待填寫)」一個寫「(未填寫)」，連「有沒有數據」的判斷條件都不一樣。

NOT_FILLED = "(待填寫)"
NO_DATA_TEXT = "測試時間未記錄"
# 雙溫循環的某一段完全沒有落在容差內的資料時（例如測試中止在另一段）要寫出來，
# 不能留白、也不能拿全段資料湊一組數字頂替
NO_SEGMENT_DATA = "無有效數據"


def _data_points_text(device_records, truncated, execution) -> str:
    """數據筆數。沒有開始時間就是這次測試根本沒記到資料，不能寫成「0 筆」——
    那看起來像測了但一筆都沒收到，跟沒測是兩件事。"""
    if not execution.test_started_at:
        return NO_DATA_TEXT
    suffix = f"（已截斷，上限 {MAX_DATA_POINTS} 筆）" if truncated else ""
    return f"{len(device_records)} 筆{suffix}"


def uncertainty_section_titles(content: dict) -> list[str]:
    """PDF 第 5 節每個小節的標題。雙溫循環有兩段溫度，編號要接得上（5.1、5.2、5.3），
    寫死的話兩段都會叫 5.1。抽出來是為了讓測試驗的就是 PDF 實際印的那一份。"""
    titles = []
    # 沒有自己資料的段落不出不確定度表，編號也不佔位：留一個空的 5.2 會讓人以為漏印了
    measured = [s for s in content["temp_segments"] if s["uncertainty"] is not None]
    for idx, seg in enumerate(measured, start=1):
        title = f"5.{idx} 溫度不確定度 Temperature Uncertainty"
        if seg["label"]:
            title += f"（{seg['label']} {seg['target']} °C）"
        titles.append(title)
    if content["humidity"]["uncertainty"]:
        titles.append(f"5.{len(measured) + 1} 濕度不確定度 Humidity Uncertainty")
    return titles


def _summary_rows(segments, humidity_avg) -> list[tuple[str, object, str]]:
    """第 5 節的統計列，回傳 (標籤, 值, 單位)。

    單位分開給，是因為兩種格式放的位置不同：CSV 寫在標籤裡（「最高溫度 Max Temp (C)」），
    PDF 寫在值後面（「70.3 °C」）。欄位本身只有這一份，PDF 以前少了溫度容差範圍那列。
    """
    rows = []
    if not segments:
        rows += [("最高溫度 Max Temp", "N/A", "°C"),
                 ("最低溫度 Min Temp", "N/A", "°C"),
                 ("平均溫度 Avg Temp", "N/A", "°C")]
    for seg in segments:
        prefix = f"{seg['label']} " if seg["label"] else ""
        rows += [
            (f"{prefix}最高溫度 Max Temp", seg["max"], "°C"),
            (f"{prefix}最低溫度 Min Temp", seg["min"], "°C"),
            (f"{prefix}平均溫度 Avg Temp", seg["avg"], "°C"),
            (f"{prefix}溫度容差範圍 Temp Limit", seg["limit"], "°C"),
        ]
    rows.append(("平均濕度 Avg Humi", humidity_avg, "%RH"))
    return rows


def _build_report_content(execution, steps, device_records, sop_data, truncated, case) -> dict:
    """把報告要寫的東西算成一份結構，CSV 與 PDF 只負責畫出來。

    回傳的每一節都是 [(標籤, 值)]，值已經是排好的字串；`temp_segments` 另外給
    每個溫度段的統計與不確定度，雙溫循環會有兩段。
    """
    device_id = execution.device_id or DEVICE_IDS[0]
    temp_tolerance = sop_data.get("temp_tolerance", 2.0)
    humi_tolerance = sop_data.get("humi_tolerance", 3.0)
    humi_target = sop_data.get("humidity_rh_percent")

    data_points = _data_points_text(device_records, truncated, execution)
    temps = [r.temperature for r in device_records if r.temperature is not None]
    humis = [r.humidity for r in device_records if r.humidity is not None]
    temp_results, u_humi = _compute_uncertainties(
        temps, humis, _temperature_segments(sop_data), humi_target,
        temp_tolerance, humi_tolerance,
    )

    segments = []
    for zh, en, target, u in temp_results:
        # u 是 None 代表這段沒有自己的資料（例如測試中止在另一段）。不能退回全段去算，
        # 那會拿另一段的溫度湊出一組數字，讓報告宣稱跑過一段其實沒發生的溫度。
        if u is None:
            t_max = t_min = t_avg = NO_SEGMENT_DATA
        else:
            t_max, t_min, t_avg = _summary_stats(u, temps, 2)
        segments.append({
            # 統計列與 PDF 小節標題用的名字，帶「段」字是因為它講的是一段測試
            "label": f"{zh}段 {en}",
            "target": target,
            "max": t_max,
            "min": t_min,
            "avg": t_avg,
            # 容差範圍跟「溫度容差」那列讀同一個值，不讓排版端自己再取一次 sop_data：
            # 分成兩個來源的話，容差改了只改一邊，同一份報告上兩個數字會互相矛盾
            "limit": (f"{round(target - temp_tolerance, 1)} ~ "
                      f"{round(target + temp_tolerance, 1)}"),
            "uncertainty": u,
        })

    humidity_avg = _summary_avg(u_humi, humis, 1)
    report_no = _report_no(execution)
    return {
        "report_no": report_no,
        "data_points": data_points,
        "identification": [
            ("實驗室 Laboratory", LAB_NAME),
            ("實驗室地址 Address", LAB_ADDRESS),
            ("報告編號 Report No.", report_no),
            ("報告版本 Version", REPORT_VERSION),
            ("產生日期 Issue Date", _now_utc().strftime("%Y-%m-%d %H:%M:%S UTC")),
            ("執行記錄 ID", str(execution.id)),
        ],
        "test_item": [
            ("樣品名稱 Sample Name", case["sample_name"]),
            ("案號 Project No.", case["project_number"]),
            ("客戶／申請人 Customer", case["customer"]),
            ("SOP ID", execution.sop_id),
            ("測試名稱 Test Name", sop_data.get("name", "N/A")),
            ("測試類型 Test Type", sop_data.get("test_type", "N/A")),
            ("SOP 版本 SOP Version", sop_data.get("version", "N/A")),
            ("參考法規 Reference", sop_data.get("reference", "N/A")),
        ],
        "conditions": [
            ("試驗設備 Chamber", device_id),
            *_setpoint_rows(sop_data),
            ("升降溫速率 Ramp Rate", f"{sop_data.get('ramp_rate', 'N/A')} °C/min"),
            ("停留時間 Dwell Time", f"{sop_data.get('dwell_time_hours', 'N/A')} h"),
            ("循環次數 Cycles", str(sop_data.get("cycles", "N/A"))),
            # 不控濕的 SOP 這個欄位存在但值是 None，直接印會在報告上留下英文的 None
            ("濕度設定 Humidity", f"{humi_target} %RH" if humi_target is not None else "N/A"),
            ("溫度容差 Temp Tolerance", f"± {temp_tolerance} °C"),
            ("濕度容差 Humi Tolerance", f"± {humi_tolerance} %RH"),
            ("測試開始 Start Time", _fmt_dt(execution.test_started_at)),
            ("測試結束 End Time", _fmt_dt(execution.test_ended_at)),
            ("紀錄建立 Record Created", _fmt_dt(execution.created_at)),
            ("數據筆數 Data Points", data_points),
        ],
        "operator": execution.operator or NOT_FILLED,
        "steps": [(f"Step {s.step_id}", "完成" if s.completed else "未完成") for s in steps],
        "summary": _summary_rows(segments, humidity_avg),
        "temp_segments": segments,
        "humidity": {
            "avg": humidity_avg,
            "uncertainty": u_humi,
        },
        "reference": sop_data.get("reference", "IEC 60068"),
    }


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
        sop_data = STANDARDS_AND_SOPS.get(execution.sop_id, {})
        content = _build_report_content(
            execution, steps, device_records, sop_data, truncated, _case_info(db, execution)
        )

        output = io.BytesIO()
        report_no = content["report_no"]

        _write(output, "")
        _write(output, "  " + "=" * 56)
        _write(output, f"  {LAB_NAME}")
        _write(output, "  環境測試報告  Environmental Test Report")
        _write(output, "  " + "=" * 56)

        # 1. 報告識別（ISO/IEC 17025:2017 §7.8.2）
        _section(output, "1. 報告識別  Report Identification")
        for label, value in content["identification"]:
            _row(output, f"{label}:", value)

        # 2. 受測樣品與測試方法（§7.8.2.1 e 客戶、g 樣品識別、f 方法）
        # 樣品欄位排在方法之前：這節先回答「測了什麼」，才回答「怎麼測」。
        _section(output, "2. 受測樣品與測試方法  Test Item and Method")
        for label, value in content["test_item"]:
            _row(output, f"{label}:", value)

        # 3. 測試條件（§7.8.3.1 a）
        # 試驗設備屬於「怎麼測」，放這裡；放在受測樣品那節會被誤讀成樣品識別。
        _section(output, "3. 測試條件  Test Conditions")
        for label, value in content["conditions"]:
            _row(output, f"{label}:", value)

        # 4. 步驟執行記錄（§7.5.1 責任人與日期）
        _section(output, "4. 步驟執行記錄  Step Execution Records")
        _row(output, "執行人員 Operator:", content["operator"])
        _write(output, "")
        _write(output, f"  {'步驟':>6}  {'狀態':<12}")
        _write(output, "  " + "-" * 30)
        for step_label, status in content["steps"]:
            _write(output, f"  {step_label:<11}{status}")
        if not content["steps"]:
            _write(output, "  (無步驟記錄)")

        # 5. 測試數據統計（§7.8.3.1 c 量測不確定度）
        # 雙溫循環的高低溫各出一組：兩段是分別要驗證的對象，混在一起算會讓「最低溫度」
        # 落在高溫段裡，低溫那幾小時等於沒進報告。
        _section(output, "5. 測試數據統計  Measurement Summary")
        for label, value, unit in content["summary"]:
            _row(output, f"{label} ({unit}):", value)
        _row(output, "量測不確定度 Uncertainty:", "本 Demo 僅估算感測器解析度")

        # 6. 測試結論（§7.8.6 & §7.8.7）
        _section(output, "6. 測試結論  Test Conclusion")
        _write(output, "  ※ 依照 ISO/IEC 17025:2017 §7.8.6 及 §7.8.7，")
        _write(output, "     符合性宣告及測試意見須由授權工程師人工判定。")
        _write(output, "")
        _row(output, "判定結果 Result:", "[          ]  (工程師人工填寫)")
        _row(output, "判定依據 Based on:", content["reference"])
        _row(output, "判定人員 Judged by:", "(工程師簽名)")
        _row(output, "判定日期 Judge Date:", "(填寫日期)")
        _write(output, "")
        _write(output, f"  ※ {RESULTS_SCOPE_STATEMENT}")

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
def list_executions(device_id: str = None, limit: int = None):
    with SessionLocal() as db:
        q = db.query(SopExecution).order_by(SopExecution.created_at.desc())
        if device_id:
            q = q.filter(SopExecution.device_id == device_id)
        if limit:
            q = q.limit(limit)
        executions = q.all()
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
    device_id_filter = execution.device_id or DEVICE_IDS[0]
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

_CJK_TTF_FONT_NAME = "CJK-TTF"
# TTF/OTF 路徑（Linux 環境）
_CJK_TTF_PATHS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansTC-Regular.ttf",
]
# TTC 路徑（macOS），用 BytesIO 方式載入讓 ReportLab 完整嵌入字體
_CJK_TTC_PATHS = [
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
]
_CJK_CID_FONT_CANDIDATES = [
    "MSung-Light",   # 繁中
    "STSong-Light",  # 簡中
]
_cjk_font_resolved = "unset"  # sentinel; None = not available


def _try_register_ttf(path: str):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    try:
        pdfmetrics.registerFont(TTFont(_CJK_TTF_FONT_NAME, path))
        return _CJK_TTF_FONT_NAME
    except Exception:
        return None


def _get_cjk_font():
    """初次呼叫時偵測並註冊 CJK 字型，結果快取於模組變數。
    優先順序：環境變數指定 > TTF/OTF（Linux）> TTC via BytesIO（macOS）> CID font（fallback）
    TTC 用 BytesIO 傳入讓 ReportLab 視為獨立字體並完整嵌入，避免 Preview/Edge 缺字問題。
    """
    global _cjk_font_resolved
    if _cjk_font_resolved != "unset":
        return _cjk_font_resolved

    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        env_font = os.getenv("REPORT_CJK_FONT_PATH", "").strip()
        if env_font:
            font_name = _try_register_ttf(env_font)
            if font_name:
                _cjk_font_resolved = font_name
                return font_name

        # 1. TTF/OTF（Linux 常見路徑）
        for path in _CJK_TTF_PATHS:
            font_name = _try_register_ttf(path)
            if font_name:
                _cjk_font_resolved = font_name
                return font_name

        # 2. TTC via BytesIO（macOS）
        # BytesIO 讓 ReportLab 完整嵌入字體，避免透過路徑載入時 CMap 不完整導致缺字
        for path in _CJK_TTC_PATHS:
            try:
                with open(path, "rb") as _f:
                    font_bytes = io.BytesIO(_f.read())
                pdfmetrics.registerFont(TTFont(_CJK_TTF_FONT_NAME, font_bytes))
                _cjk_font_resolved = _CJK_TTF_FONT_NAME
                return _CJK_TTF_FONT_NAME
            except Exception:
                continue

        # 3. CID font（fallback，macOS Preview 可能渲染不完整）
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        for cid_name in _CJK_CID_FONT_CANDIDATES:
            try:
                pdfmetrics.registerFont(UnicodeCIDFont(cid_name))
                _cjk_font_resolved = cid_name
                return cid_name
            except Exception:
                continue
    except Exception:
        pass

    _cjk_font_resolved = None
    return None


def _build_pdf(content) -> bytes:
    font_name = _get_cjk_font()
    if not font_name:
        # 極端情況才 fallback 英文字型
        font_name = "Helvetica"
    has_cjk_font = font_name != "Helvetica"
    # CJK 字型通常沒有獨立 Bold 名稱，直接沿用同一個 family
    bold_font = font_name if has_cjk_font else "Helvetica-Bold"

    base = ParagraphStyle("base", fontName=font_name, fontSize=9, leading=14,
                          spaceAfter=2, textColor=colors.HexColor("#1a1a1a"))
    h1 = ParagraphStyle("h1", fontName=bold_font, fontSize=13, leading=18,
                        spaceAfter=4, textColor=colors.HexColor("#1a5276"))
    h2 = ParagraphStyle("h2", fontName=bold_font, fontSize=10, leading=14,
                        spaceBefore=10, spaceAfter=4,
                        textColor=colors.HexColor("#1a5276"))
    small = ParagraphStyle("small", fontName=font_name, fontSize=8, leading=12,
                           textColor=colors.HexColor("#444444"))
    warn = ParagraphStyle("warn", fontName=font_name, fontSize=8, leading=12,
                          textColor=colors.HexColor("#b7770d"))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=2*cm, rightMargin=2*cm,
                            topMargin=2*cm, bottomMargin=2*cm)
    story = []

    _kv_style = TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#dde8f0")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#aaaaaa")),
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

    # ── 封面 ──────────────────────────────────────────────────────────────────
    story.append(Paragraph(LAB_NAME, h1))
    story.append(Paragraph(
        "環境測試報告 Environmental Test Report" if has_cjk_font
        else "Environmental Test Report",
        ParagraphStyle("sub", fontName=bold_font, fontSize=11, leading=16,
                       textColor=colors.HexColor("#444444"))))
    story.append(HRFlowable(width="100%", thickness=1,
                            color=colors.HexColor("#aaaaaa"), spaceAfter=10))

    # ── 1. 報告識別 ───────────────────────────────────────────────────────────
    story.append(Paragraph("1. 報告識別  Report Identification", h2))
    story.append(kv_table([list(row) for row in content["identification"]]))

    # ── 2. 受測樣品與測試方法 ─────────────────────────────────────────────────
    # 樣品欄位排在方法之前：這節先回答「測了什麼」，才回答「怎麼測」。
    story.append(Paragraph("2. 受測樣品與測試方法  Test Item and Method", h2))
    story.append(kv_table([list(row) for row in content["test_item"]]))

    # ── 3. 測試條件 ───────────────────────────────────────────────────────────
    # 試驗設備屬於「怎麼測」，放這裡；放在受測樣品那節會被誤讀成樣品識別。
    story.append(Paragraph("3. 測試條件  Test Conditions", h2))
    story.append(kv_table([list(row) for row in content["conditions"]]))

    # ── 4. 步驟記錄 ───────────────────────────────────────────────────────────
    story.append(Paragraph("4. 步驟執行記錄  Step Records", h2))
    story.append(Paragraph(f"執行人員 Operator: {content['operator']}", base))
    if content["steps"]:
        step_data = [[
            Paragraph("步驟 Step", small),
            Paragraph("狀態 Status", small),
        ]]
        # 狀態字串走 content，兩種格式不得各判一次 completed；勾叉是 PDF 自己的排版
        for step_label, status in content["steps"]:
            mark = "✔" if status == "完成" else "✘"
            step_data.append([
                Paragraph(step_label, base),
                Paragraph(f"{mark} {status}", base),
            ])
        ts = Table(step_data, colWidths=[3*cm, None])
        ts.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dde8f0")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#aaaaaa")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(ts)
    else:
        story.append(Paragraph("(無步驟記錄)", small))

    # ── 5. 量測不確定度（核心新功能）────────────────────────────────────────
    story.append(Paragraph("5. 量測不確定度分析  Measurement Uncertainty (GUM)", h2))

    def _unc_table(u: unc.UncertaintyResult, qty_label: str):
        header = [
            Paragraph(h, ParagraphStyle("th", fontName=bold_font,
                                        fontSize=8, leading=12,
                                        textColor=colors.HexColor("#1a1a1a")))
            for h in ["不確定度來源 Source", "類型\nType", "分佈\nDist.",
                      "標準不確定度\nu(xi)"]
        ]
        data = [header]
        stable_note = "穩定段" if u.using_stable_only else "全段"
        data.append([
            Paragraph(f"重複測量（{stable_note} n={u.n}）\nRepeated measurement", base),
            Paragraph("A", base),
            Paragraph("常態 Normal", base),
            Paragraph(f"{u.uA:.4f} {u.unit}", base),
        ])
        data.append([
            Paragraph(
                f"感測器解析度 {unc.TEMP_RESOLUTION if u.unit == '°C' else unc.HUMI_RESOLUTION}"
                f" {u.unit}\nSensor resolution", base),
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
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dde8f0")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#aaaaaa")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f5f8fb")]),
        ]))
        result_text = (
            f"<b>量測結果：{qty_label} = {u.mean:.2f} ± {u.U:.4f} {u.unit}</b>"
            f"　（k = {u.k}，信賴水準 ≈ 95%）"
        )
        return [tw, Spacer(1, 4),
                Paragraph(result_text,
                          ParagraphStyle("result", fontName=bold_font, fontSize=9,
                                         leading=13,
                                         textColor=colors.HexColor("#1a5276")))]

    # 雙溫循環的高低溫各出一份：兩段有各自的目標與容差，共用一份會讓低溫段沒有結果
    segments = content["temp_segments"]
    section_titles = uncertainty_section_titles(content)
    measured_segments = [s for s in segments if s["uncertainty"] is not None]
    if measured_segments:
        for idx, seg in enumerate(measured_segments, start=1):
            if idx > 1:
                story.append(Spacer(1, 8))
            story.append(Paragraph(section_titles[idx - 1], h2))
            u = seg["uncertainty"]
            if u.note:
                story.append(Paragraph(f"⚠ {u.note}", warn))
            story.extend(_unc_table(u, "T"))
        for seg in segments:
            if seg["uncertainty"] is None:
                story.append(Paragraph(
                    f"（{seg['label']} {seg['target']} °C：{NO_SEGMENT_DATA}，"
                    "這次測試沒有落在該段容差內的資料）", warn))
    else:
        story.append(Paragraph("(溫度數據不足，無法計算不確定度)", small))

    u_humi = content["humidity"]["uncertainty"]
    if u_humi:
        story.append(Spacer(1, 8))
        story.append(Paragraph(section_titles[-1], h2))
        if u_humi.note:
            story.append(Paragraph(f"⚠ {u_humi.note}", warn))
        story.extend(_unc_table(u_humi, "RH"))

    story.append(Paragraph(
        "※ 本 Demo 的 Type B 僅估算感測器解析度，不含外部校正資料。",
        warn))

    # ── 6. 數據統計 ───────────────────────────────────────────────────────────
    story.append(Paragraph("6. 數據統計  Measurement Summary", h2))
    summary_rows = [[label, f"{value} {unit}"] for label, value, unit in content["summary"]]
    summary_rows.append(["數據筆數 Data Points", content["data_points"]])
    story.append(kv_table(summary_rows))

    # ── 7. 測試結論 ───────────────────────────────────────────────────────────
    story.append(Paragraph("7. 測試結論  Test Conclusion", h2))
    story.append(Paragraph(
        "依照 ISO/IEC 17025:2017 §7.8.6 及 §7.8.7，"
        "符合性宣告及測試意見須由授權工程師人工判定，不由系統自動產生。",
        base))
    story.append(kv_table([
        ["判定結果 Result", "[ __________ ]  (工程師人工填寫)"],
        ["判定依據 Based on", content["reference"]],
        ["判定人員 Judged by", "(工程師簽名)"],
        ["判定日期 Judge Date", "(填寫日期)"],
    ]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"※ {RESULTS_SCOPE_STATEMENT}", small))

    # ── 頁尾 ──────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.5,
                            color=colors.HexColor("#30363d")))
    story.append(Paragraph(
        f"報告結束  End of Report  [{content['report_no']}]",
        ParagraphStyle("footer", fontName=font_name, fontSize=8, leading=12,
                       textColor=colors.HexColor("#888888"), alignment=1)))

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
        sop_id = execution.sop_id
        content = _build_report_content(
            execution, steps, device_records, sop_data, truncated, _case_info(db, execution)
        )
        report_no = content["report_no"]
        pdf_bytes = _build_pdf(content)

    filename = f"{report_no}_{sop_id}.pdf"
    encoded_filename = urllib.parse.quote(filename)
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
        },
    )
