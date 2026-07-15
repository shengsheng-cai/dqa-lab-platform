"""
報告產生的降級與健全性。

- 找不到執行紀錄 → 乾淨 404（PDF 與 CSV 共用 _fetch_execution_data），非 500 崩潰。
- PDF 產生走真實 reportlab（行內函式庫，不 mock），輸出必須是合法 PDF。
"""
import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.reports as reports_module
from app.models import Base, SopExecution
from app.reports import download_csv_report, download_pdf_report


@pytest.fixture()
def session_patched():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine)
    original = reports_module.SessionLocal
    reports_module.SessionLocal = lambda: TestSession()  # type: ignore[assignment]
    yield TestSession
    reports_module.SessionLocal = original  # type: ignore[assignment]
    Base.metadata.drop_all(engine)


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
