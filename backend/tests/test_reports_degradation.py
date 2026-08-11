"""
報告產生的降級與健全性。

- 找不到執行紀錄 → 乾淨 404（PDF 與 CSV 共用 _fetch_execution_data），非 500 崩潰。
- PDF 產生走真實 reportlab（行內函式庫，不 mock），輸出必須是合法 PDF。
- 前端存執行紀錄時送的是帶時區的 ISO 時間，落地後仍要對得上 naive UTC 的感測資料。
- 送進來的時間若不是 UTC，要先換算再存，不是把時區直接丟掉。
- 報告的數據統計要跟自己的不確定度分析取同一段資料（BUG-008）。
- 報告的受測樣品欄位要識別樣品，不是識別試驗箱；連不到案件時要明講（BUG-009）。
"""
import asyncio
import datetime

import pytest
from fastapi import HTTPException

from app import uncertainty as unc
from app.models import DeviceData, Schedule, ScheduleStatus, SopExecution
from app.reports import (
    NO_CASE_TEXT,
    _fetch_execution_data,
    _summary_avg,
    _summary_stats,
    download_csv_report,
    download_pdf_report,
)


@pytest.fixture()
def session_patched(patched_session):
    with patched_session("app.reports") as TestSession:
        yield TestSession


@pytest.fixture()
def no_line_push(monkeypatch):
    """走真實 sop 路由的測試都要擋掉 LINE 推播，否則測試會真的去打外部 API。"""
    import app.sop as sop_module

    async def _no_push(*_a, **_kw):
        return None

    monkeypatch.setattr(sop_module, "push_message", _no_push)
    return sop_module


def _seed_execution(Session) -> int:
    with Session() as db:
        e = SopExecution(sop_id="iec60068_ab_-40_16h", device_id="CH-01", operator="測試員")
        db.add(e)
        db.commit()
        return e.id


def _drain_streaming_response(resp) -> bytes:
    """收集 StreamingResponse 的完整內容，供直接呼叫 route 函式（非走 TestClient）的測試用。"""
    async def _collect():
        chunks = []
        async for c in resp.body_iterator:
            chunks.append(c)
        return b"".join(chunks)

    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(_collect())
    finally:
        loop.close()


def test_pdf_report_missing_execution_returns_404(session_patched):
    with pytest.raises(HTTPException) as exc:
        download_pdf_report(999999)
    assert exc.value.status_code == 404


def test_csv_report_missing_execution_returns_404(session_patched):
    with pytest.raises(HTTPException) as exc:
        download_csv_report(999999)
    assert exc.value.status_code == 404


def test_pdf_report_generates_valid_pdf(session_patched):
    """真實 reportlab 產生 PDF，輸出以 %PDF 魔數開頭且非空。"""
    eid = _seed_execution(session_patched)

    resp = download_pdf_report(eid)

    assert resp.media_type == "application/pdf"

    body = _drain_streaming_response(resp)

    assert body.startswith(b"%PDF"), "輸出不是合法 PDF"
    assert len(body) > 1000, "PDF 內容過小，可能產生失敗"


def test_frontend_iso_timestamps_still_match_sensor_data(api_client, no_line_push):
    """前端送的帶時區 ISO 時間，經真實路由存進去後，報告仍要撈得到感測資料。

    前端存執行紀錄時送的是字串：開始時間來自設備狀態（帶 +00:00）、結束時間是
    new Date().toISOString()（帶 Z）。兩者經 pydantic 解析成 aware UTC 後直接寫進
    naive UTC 欄位，而感測資料的時間戳是 naive UTC。這兩者要對得上，報告才有數據。
    對不上時不會有錯誤訊息，只是量測數據整段消失（步驟表還在，最高／最低／平均溫全空）。

    刻意走 HTTP 而非直接塞 ORM：要涵蓋的正是「ISO 字串 → pydantic → DB」這段，
    直接塞 ORM 會跳過解析，只驗到 SQLAlchemy 丟棄 tzinfo 的框架行為。
    """
    sop_module = no_line_push

    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    started = now - datetime.timedelta(minutes=15)

    with api_client(sop_module, sop_module.execution_router) as (client, Session):
        with Session() as db:
            # 感測資料：模擬器實際寫入的樣子（naive UTC）
            for i in range(10):
                db.add(DeviceData(
                    device_id="CH-01", temperature=-40.0 + i, humidity=5.0,
                    timestamp=now.replace(tzinfo=None) - datetime.timedelta(minutes=10 - i),
                ))
            db.commit()

        resp = client.post("/api/sop-executions/", json={
            "sop_id": "iec60068_ab_-40_16h",
            "device_id": "CH-01",
            "operator": "測試員",
            # 前端兩個欄位的實際字串格式，不要改寫成 naive
            "test_started_at": started.isoformat(),            # ...+00:00
            "test_ended_at": now.isoformat().replace("+00:00", "Z"),
            "steps": [],
        })
        assert resp.status_code == 200, resp.text
        eid = resp.json()["id"]

        with Session() as db:
            _, _, device_records, _ = _fetch_execution_data(eid, db)

    assert len(device_records) == 10, (
        f"報告只撈到 {len(device_records)} 筆感測資料，帶時區的時間與 naive 時間戳對不上"
    )


def test_non_utc_timestamps_are_converted_before_saving(api_client, no_line_push):
    """送進來的時間不是 UTC 時，要換算成 UTC 再存，不是把時區直接丟掉。

    目前前端送的一定是 UTC，丟掉時區剛好等於正確答案，所以這條守的是往後：
    哪天有人改成送本地時間（+08:00），台北 17:30 會被當成 UTC 17:30 存進去，
    報告就去撈晚了 8 小時的區間。整段過程沒有任何錯誤訊息，只有數據不對。

    走 HTTP 而非直接塞 ORM，理由同上一條：要涵蓋的是「ISO 字串 → pydantic → DB」。
    """
    sop_module = no_line_push

    taipei = datetime.timezone(datetime.timedelta(hours=8))
    started_local = datetime.datetime(2026, 8, 8, 17, 30, tzinfo=taipei)
    ended_local = datetime.datetime(2026, 8, 8, 18, 0, tzinfo=taipei)

    with api_client(sop_module, sop_module.execution_router) as (client, Session):
        resp = client.post("/api/sop-executions/", json={
            "sop_id": "iec60068_ab_-40_16h",
            "device_id": "CH-01",
            "operator": "測試員",
            "test_started_at": started_local.isoformat(),   # ...+08:00
            "test_ended_at": ended_local.isoformat(),
            "steps": [],
        })
        assert resp.status_code == 200, resp.text
        eid = resp.json()["id"]

        with Session() as db:
            row = db.get(SopExecution, eid)
            saved_start, saved_end = row.test_started_at, row.test_ended_at

    assert saved_start.tzinfo is None and saved_end.tzinfo is None, "欄位應維持 naive"
    assert saved_start == datetime.datetime(2026, 8, 8, 9, 30), (
        f"開始時間存成 {saved_start}，台北 17:30 應換算成 UTC 09:30"
    )
    assert saved_end == datetime.datetime(2026, 8, 8, 10, 0), (
        f"結束時間存成 {saved_end}，台北 18:00 應換算成 UTC 10:00"
    )


def test_summary_stats_matches_uncertainty_mean_not_full_window_average():
    """報告的平均溫要跟不確定度分析取同一段資料，不能各算各的。

    升溫段（遠離目標、佔多數）+ dwell 段（落在容差內）混合時，全資料窗的平均會被
    升溫段拉低；不確定度分析只取 dwell 段（穩定段）計算 mean。曾經 PDF 第 6 節與
    CSV 都直接對全部溫度取平均，導致同一筆執行紀錄的 PDF §5、PDF §6、CSV 三處平均溫互不相同。
    """
    ramp = [float(t) for t in range(25, 80)]              # 遠離目標，佔多數
    dwell = [85.0 + (i % 3) * 0.03 for i in range(30)]     # 落在 85±2 容差內
    all_temps = ramp + dwell

    u_temp = unc.calc_temp(all_temps, target=85.0, tolerance=2.0)
    assert u_temp.using_stable_only is True, "測試前提：這組資料應該能篩出穩定段"

    full_window_avg = round(sum(all_temps) / len(all_temps), 2)
    _, _, temp_avg = _summary_stats(u_temp, all_temps, 2)

    assert temp_avg == round(u_temp.mean, 2), "平均溫應該直接沿用不確定度分析的結果"
    assert temp_avg != full_window_avg, "這組資料下穩定段平均與全窗平均本該不同，測試前提才成立"
    # 只需要平均值的呼叫點（如濕度、CSV）跟需要 max/min 的呼叫點（如溫度）必須拿到同一個平均值
    assert _summary_avg(u_temp, all_temps, 2) == temp_avg


def test_summary_stats_falls_back_to_raw_values_without_uncertainty_result():
    """沒有 target（沒算不確定度）時，退回全段自算，行為與改動前一致。"""
    temps = [20.0, 22.0, 24.0]
    assert _summary_stats(None, temps, 2) == (24.0, 20.0, 22.0)
    assert _summary_avg(None, temps, 2) == 22.0


def test_summary_stats_empty_data_returns_na():
    assert _summary_stats(None, [], 2) == ("N/A", "N/A", "N/A")
    assert _summary_avg(None, [], 2) == "N/A"


def test_csv_report_avg_temp_matches_uncertainty_stable_segment(session_patched):
    """實際跑 CSV 報告路由（不只測 helper）：印出的平均溫要是穩定段平均，
    不能是全資料窗平均——CSV 之前完全沒算不確定度，這是新接上的路徑，要驗證真的接對。
    """
    now = datetime.datetime(2026, 1, 1, 0, 0, 0)
    ramp = [float(t) for t in range(25, -35, -1)]          # 遠離 -40 目標，佔多數
    dwell = [-40.0 + (i % 3) * 0.03 for i in range(30)]     # 落在 -40±2 容差內
    all_temps = ramp + dwell

    with session_patched() as db:
        e = SopExecution(
            sop_id="iec60068_ab_-40_16h", device_id="CH-01", operator="測試員",
            test_started_at=now, test_ended_at=now + datetime.timedelta(minutes=len(all_temps)),
        )
        db.add(e)
        db.commit()
        eid = e.id

        for i, t in enumerate(all_temps):
            db.add(DeviceData(
                device_id="CH-01", temperature=t,
                timestamp=now + datetime.timedelta(minutes=i),
            ))
        db.commit()

    expected = unc.calc_temp(all_temps, target=-40.0, tolerance=2.0)
    assert expected.using_stable_only is True, "測試前提：這組資料應該能篩出穩定段"
    full_window_avg = round(sum(all_temps) / len(all_temps), 2)
    assert round(expected.mean, 2) != full_window_avg, "測試前提：穩定段平均要跟全窗平均不同"

    resp = download_csv_report(eid)
    body = _drain_streaming_response(resp)
    text = body.decode("big5")
    avg_line = next(line for line in text.splitlines() if "平均溫度 Avg Temp" in line)
    assert str(round(expected.mean, 2)) in avg_line, (
        f"CSV 平均溫應該是穩定段平均 {round(expected.mean, 2)}，實際那行：{avg_line!r}"
    )
    assert str(full_window_avg) not in avg_line, "CSV 平均溫不該退回全窗平均"


# ── 受測樣品識別（BUG-009）────────────────────────────────────────────────────

SAMPLE_NAME = "MX-1000 工業乙太網路交換器"
PROJECT_NUMBER = "PRJ-2026-0042"
APPLICANT = "王小明"


def _make_schedule(status=ScheduleStatus.RUNNING, **overrides) -> Schedule:
    """帶完整案件資料的排程；報告要印的就是這三個欄位。"""
    return Schedule(**{
        "project_number": PROJECT_NUMBER, "sample_name": SAMPLE_NAME,
        "applicant_name": APPLICANT, "device_id": "CH-01", "standard": "IEC 60068",
        "conditions": '["iec60068_ab_-40_16h"]', "status": status,
        **overrides,
    })


def _seed_case(Session, *, link: bool) -> int:
    """建一張帶案件資料的排程 + 一筆執行紀錄，回傳 execution id。

    link=False 時執行紀錄不接排程，用來驗「臨時測試」那條路徑。
    """
    with Session() as db:
        sched = _make_schedule()
        db.add(sched)
        db.flush()
        e = SopExecution(
            sop_id="iec60068_ab_-40_16h", device_id="CH-01", operator="測試員",
            schedule_id=sched.id if link else None,
        )
        db.add(e)
        db.commit()
        return e.id


def _csv_text(execution_id: int) -> str:
    return _drain_streaming_response(download_csv_report(execution_id)).decode("big5")


def _section_between(text: str, start_marker: str, end_marker: str) -> str:
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if start_marker in line)
    end = next(i for i, line in enumerate(lines) if end_marker in line)
    return "\n".join(lines[start:end])


def test_report_identifies_the_sample_not_the_chamber(session_patched):
    """受測樣品那節要印真正的樣品，而且不能再把試驗箱編號放在那裡。

    修正前那節印的是設備編號 CH-01——識別的是試驗箱，不是受測樣品，
    等於報告聲稱識別了樣品但實際沒有（BUG-009）。
    """
    eid = _seed_case(session_patched, link=True)

    text = _csv_text(eid)
    item_section = _section_between(text, "2. 受測樣品與測試方法", "3. 測試條件")

    assert SAMPLE_NAME in item_section, "受測樣品那節要印樣品名稱"
    assert PROJECT_NUMBER in item_section, "受測樣品那節要印案號"
    assert APPLICANT in item_section, "受測樣品那節要印客戶／申請人"
    assert "CH-01" not in item_section, (
        "試驗箱編號不該出現在受測樣品那節——那正是 BUG-009 的症狀"
    )
    # 設備資訊本身沒有消失，只是搬到「怎麼測」那節
    assert "CH-01" in _section_between(text, "3. 測試條件", "4. 步驟執行記錄")


def test_report_states_no_case_when_execution_has_no_schedule(session_patched):
    """臨時測試沒有對應案件時要明講，不能退回去印設備編號充數。"""
    eid = _seed_case(session_patched, link=False)

    text = _csv_text(eid)
    item_section = _section_between(text, "2. 受測樣品與測試方法", "3. 測試條件")

    assert NO_CASE_TEXT in item_section, "沒接到排程時要明講無對應案件"
    assert SAMPLE_NAME not in item_section, "沒接到排程不該印出別張排程的樣品"
    assert "CH-01" not in item_section, "沒有案件時更不該用試驗箱編號充當樣品識別"


def test_report_carries_laboratory_identity_and_scope_statement(session_patched):
    """§7.8.2.1 (b) 實驗室識別與 (l) 結果適用範圍聲明要在報告裡。"""
    eid = _seed_case(session_patched, link=True)

    text = _csv_text(eid)

    assert "實驗室 Laboratory" in text
    assert "模擬實驗室" in text, "沒有實體實驗室就要誠實標示，不掛編出來的地址"
    assert "結果僅適用於本次所測之樣品" in text


def test_report_prints_na_for_uncontrolled_humidity(session_patched):
    """不控濕的 SOP，濕度設定要印 N/A，不能把 Python 的 None 印到報告上。

    這個欄位在 SOP 資料裡存在、值是 None，所以 `.get(key, "N/A")` 的預設值救不到，
    修正前報告上會出現英文的 None，看起來像程式漏東西。
    """
    eid = _seed_case(session_patched, link=True)  # iec60068_ab_-40_16h 不控濕

    conditions = _section_between(_csv_text(eid), "3. 測試條件", "4. 步驟執行記錄")

    humidity_line = next(line for line in conditions.splitlines() if "濕度設定" in line)
    assert "N/A" in humidity_line, f"不控濕時應印 N/A，實際：{humidity_line!r}"
    assert "None" not in humidity_line


def test_pdf_report_with_case_still_generates_valid_pdf(session_patched):
    """PDF 走的是另一條組版路徑，樣品欄位接上後仍要產得出合法 PDF。"""
    eid = _seed_case(session_patched, link=True)

    body = _drain_streaming_response(download_pdf_report(eid))

    assert body.startswith(b"%PDF")
    assert len(body) > 1000


def _post_execution(client, started_at: datetime.datetime | None) -> int:
    """模擬 SOP 頁面存執行紀錄（前端送的是帶時區的 ISO 字串）。"""
    body = {
        "sop_id": "iec60068_ab_-40_16h", "device_id": "CH-01",
        "operator": "測試員", "manual_mode": True, "steps": [],
    }
    if started_at is not None:
        body["test_started_at"] = started_at.replace(
            tzinfo=datetime.timezone.utc
        ).isoformat()
    resp = client.post("/api/sop-executions/", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_saved_execution_inherits_the_case_from_the_row_created_at_test_start(
    api_client, no_line_push,
):
    """SOP 頁面存的那列（使用者實際下載報告的那列）要繼承開始那列的案件。

    瀏覽器不知道排程編號，所以後端用「同一台設備 + 同一個開始時刻」認回測試開始
    時建的那列，直接沿用它的 schedule_id。沒接上的話，報告的樣品欄位對主要流程
    仍然是空的。
    """
    sop_module = no_line_push
    started = datetime.datetime(2026, 8, 10, 3, 0, 0, 123456)

    with api_client(sop_module, sop_module.execution_router) as (client, Session):
        with Session() as db:
            sched = _make_schedule()
            db.add(sched)
            db.flush()
            # 測試開始時建的那列：帶著正確的案件
            db.add(SopExecution(
                sop_id="iec60068_ab_-40_16h", device_id="CH-01",
                test_started_at=started, schedule_id=sched.id,
            ))
            db.commit()
            sid = sched.id

        eid = _post_execution(client, started)

        with Session() as db:
            assert db.get(SopExecution, eid).schedule_id == sid


def test_saved_execution_does_not_borrow_the_case_of_a_later_schedule(
    api_client, no_line_push,
):
    """舊測試存檔前，同台機器已經開始跑下一張排程時，不能接到那張的樣品。

    這是「問設備現在正在跑哪張排程」那種做法會踩到的坑：報告會印出別人的樣品，
    比留白更糟。繼承開始那列就沒有這個問題——認不回來就留白。
    """
    sop_module = no_line_push
    started = datetime.datetime(2026, 8, 10, 3, 0, 0, 123456)

    with api_client(sop_module, sop_module.execution_router) as (client, Session):
        with Session() as db:
            # 這次測試沒有案件（臨時測試），但同台機器現在正在跑另一張排程
            db.add(SopExecution(
                sop_id="iec60068_ab_-40_16h", device_id="CH-01",
                test_started_at=started, schedule_id=None,
            ))
            db.add(_make_schedule(sample_name="別人的樣品"))
            db.commit()

        eid = _post_execution(client, started)

        with Session() as db:
            assert db.get(SopExecution, eid).schedule_id is None


def test_start_row_timestamp_matches_the_one_the_browser_gets_back(patched_session):
    """測試開始那列的 test_started_at 要跟設備狀態的 started_at 是同一個瞬間。

    這是案件繼承的要害：瀏覽器拿到的是設備狀態的 started_at，存檔時原樣送回來，
    後端拿它去認開始那列。兩邊若各自呼叫 now()，會差幾微秒而永遠認不回來——
    報告的樣品欄位會安靜地全部變成「無對應案件」，不會有任何錯誤訊息。
    """
    import app.device_state as device_state_module
    import app.sop as sop_module

    with patched_session("app.sop", "app.device_state") as Session:
        states = device_state_module.DeviceStateManager(
            {"CH-01": {"status": "IDLE", "temperature": 25.0, "humidity": 55.0}}
        )

        asyncio.run(sop_module._start_device_sop(
            states, "CH-01", "iec60068_ab_-40_16h", "低溫測試",
            {"steps": []}, "測試員", 7,
        ))

        cache_started_at = states["CH-01"]["started_at"]
        with Session() as db:
            row_started_at = db.query(SopExecution).one().test_started_at

    assert row_started_at == cache_started_at.replace(tzinfo=None), (
        "開始那列的時間戳跟設備狀態對不上，存檔時就認不回這列、案件會繼承不到"
    )


def test_device_api_does_not_truncate_the_timestamp_the_browser_sends_back(patched_session):
    """設備 API 送出的 started_at 不能損失精度，否則案件繼承會整個失效。

    鏈路是：設備狀態 started_at →（這裡序列化成字串）→ 瀏覽器原樣存著 → 存執行紀錄時
    原樣送回 → 後端拿去認開始那列。這一步若被改成 `.replace(microsecond=0)` 之類的
    「整理」，認回來的條件就永遠不成立，每份報告的樣品欄位都會安靜地變成「無對應案件」，
    不會有任何錯誤訊息，也不會有別的測試變紅。
    """
    import app.devices as devices_module

    started = datetime.datetime(2026, 8, 10, 3, 0, 0, 123456, tzinfo=datetime.timezone.utc)

    with patched_session("app.devices", "app.schedule_service"):
        serialized = devices_module.build_device_list(
            {"CH-01": {"status": "RUNNING", "started_at": started}}
        )[0]["started_at"]

    assert datetime.datetime.fromisoformat(serialized) == started, (
        f"序列化後的 started_at 對不回原值（{serialized!r}），案件繼承會失效"
    )


def test_saved_execution_has_no_case_when_no_matching_start_row(api_client, no_line_push):
    """認不回開始那列（例如沒送開始時間）就留白，不亂認一張排程。"""
    sop_module = no_line_push

    with api_client(sop_module, sop_module.execution_router) as (client, Session):
        with Session() as db:
            db.add(_make_schedule())
            db.commit()

        eid = _post_execution(client, None)

        with Session() as db:
            assert db.get(SopExecution, eid).schedule_id is None
