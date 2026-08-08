"""
報告產生的降級與健全性。

- 找不到執行紀錄 → 乾淨 404（PDF 與 CSV 共用 _fetch_execution_data），非 500 崩潰。
- PDF 產生走真實 reportlab（行內函式庫，不 mock），輸出必須是合法 PDF。
- 前端存執行紀錄時送的是帶時區的 ISO 時間，落地後仍要對得上 naive UTC 的感測資料。
- 送進來的時間若不是 UTC，要先換算再存，不是把時區直接丟掉。
"""
import asyncio
import datetime

import pytest
from fastapi import HTTPException

from app.models import DeviceData, SopExecution
from app.reports import _fetch_execution_data, download_csv_report, download_pdf_report


@pytest.fixture()
def session_patched(patched_session):
    with patched_session("app.reports") as TestSession:
        yield TestSession


def _seed_execution(Session) -> int:
    with Session() as db:
        e = SopExecution(sop_id="iec60068_ab_-40_16h", device_id="CH-01", operator="測試員")
        db.add(e)
        db.commit()
        return e.id


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

    async def _collect():
        chunks = []
        async for c in resp.body_iterator:
            chunks.append(c)
        return b"".join(chunks)

    loop = asyncio.new_event_loop()
    try:
        body = loop.run_until_complete(_collect())
    finally:
        loop.close()

    assert body.startswith(b"%PDF"), "輸出不是合法 PDF"
    assert len(body) > 1000, "PDF 內容過小，可能產生失敗"


def test_frontend_iso_timestamps_still_match_sensor_data(api_client, monkeypatch):
    """前端送的帶時區 ISO 時間，經真實路由存進去後，報告仍要撈得到感測資料。

    前端存執行紀錄時送的是字串：開始時間來自設備狀態（帶 +00:00）、結束時間是
    new Date().toISOString()（帶 Z）。兩者經 pydantic 解析成 aware UTC 後直接寫進
    naive UTC 欄位，而感測資料的時間戳是 naive UTC。這兩者要對得上，報告才有數據。
    對不上時不會有錯誤訊息，只是量測數據整段消失（步驟表還在，最高／最低／平均溫全空）。

    刻意走 HTTP 而非直接塞 ORM：要涵蓋的正是「ISO 字串 → pydantic → DB」這段，
    直接塞 ORM 會跳過解析，只驗到 SQLAlchemy 丟棄 tzinfo 的框架行為。
    """
    import app.sop as sop_module

    async def _no_push(*_a, **_kw):
        return None
    monkeypatch.setattr(sop_module, "push_message", _no_push)

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


def test_non_utc_timestamps_are_converted_before_saving(api_client, monkeypatch):
    """送進來的時間不是 UTC 時，要換算成 UTC 再存，不是把時區直接丟掉。

    目前前端送的一定是 UTC，丟掉時區剛好等於正確答案，所以這條守的是往後：
    哪天有人改成送本地時間（+08:00），台北 17:30 會被當成 UTC 17:30 存進去，
    報告就去撈晚了 8 小時的區間。整段過程沒有任何錯誤訊息，只有數據不對。

    走 HTTP 而非直接塞 ORM，理由同上一條：要涵蓋的是「ISO 字串 → pydantic → DB」。
    """
    import app.sop as sop_module

    async def _no_push(*_a, **_kw):
        return None
    monkeypatch.setattr(sop_module, "push_message", _no_push)

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
