"""治具 Excel adapter 的資料完整性測試。"""

import pandas as pd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.fixture_excel import _fixture_excel_row, _run_import_db
from app.fixtures import keeper_name_map
from app.models import Fixture, User


def test_full_app_template_route_precedes_fixture_id(monkeypatch):
    """Production app 必須先匹配 /template，不可落到 /{fixture_id}。"""
    import app.auth as auth_module
    import app.main as main_module

    monkeypatch.setattr(auth_module, "DEMO_PASSWORD", "")
    client = TestClient(main_module.app)
    try:
        response = client.get("/api/fixtures/template")
    finally:
        client.close()

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_import_rejects_negative_stock(patched_session):
    dataframe = pd.DataFrame([
        {"介面": "USB-C", "型態": "轉接頭", "現有數量": -1, "缺貨數": 0},
    ])
    column_map = {
        "interface_type": "介面",
        "form_factor": "型態",
        "total_quantity": "現有數量",
        "shortage": "缺貨數",
    }

    with patched_session("app.fixture_excel") as Session:
        with pytest.raises(HTTPException) as error:
            _run_import_db(
                dataframe,
                column_map,
                actor="1",
                role="admin",
            )

        assert error.value.status_code == 400
        assert "不可為負數" in error.value.detail
        with Session() as db:
            assert db.query(Fixture).count() == 0


def test_import_updates_stock_through_lifecycle_guard(patched_session):
    dataframe = pd.DataFrame([
        {"介面": "USB-C", "型態": "轉接頭", "現有數量": 7, "缺貨數": 0},
    ])
    column_map = {
        "interface_type": "介面",
        "form_factor": "型態",
        "total_quantity": "現有數量",
        "shortage": "缺貨數",
    }

    with patched_session("app.fixture_excel") as Session:
        result = _run_import_db(
            dataframe,
            column_map,
            actor="1",
            role="admin",
        )

        assert result["imported"] == 1
        with Session() as db:
            fixture = db.query(Fixture).one()
            assert fixture.total_quantity == 7


def test_import_links_keeper_to_user_when_name_matches(patched_session):
    """匯入的保管人名字對得到人員就連起來；對不到就照原文留著，不要偷偷丟掉。

    Excel 只有名字，是保管人唯一還會產生「純文字、沒連到人」的來源。連得起來的直接連，
    連不起來的畫面會標成「未連結人員」，讓人知道那個名字沒有指向任何人。
    """
    dataframe = pd.DataFrame([
        {"介面": "USB-C", "型態": "轉接頭", "現有數量": 1, "缺貨數": 0, "保管人": "陳工"},
        {"介面": "RJ45", "型態": "1GbE", "現有數量": 1, "缺貨數": 0, "保管人": "查無此人"},
    ])
    column_map = {
        "interface_type": "介面",
        "form_factor": "型態",
        "total_quantity": "現有數量",
        "shortage": "缺貨數",
        "keeper_name": "保管人",
    }

    with patched_session("app.fixture_excel") as Session:
        with Session() as db:
            db.add(User(id=2, username="chen", display_name="陳工", hashed_password="x", role="admin"))
            db.commit()

        result = _run_import_db(dataframe, column_map, actor="1", role="admin")

        assert result["imported"] == 2
        with Session() as db:
            linked = db.query(Fixture).filter(Fixture.interface_type == "USB-C").one()
            assert (linked.keeper_name, linked.keeper_user_id) == ("陳工", 2)

            unlinked = db.query(Fixture).filter(Fixture.interface_type == "RJ45").one()
            assert unlinked.keeper_name == "查無此人"
            assert unlinked.keeper_user_id is None


def test_export_uses_the_keepers_current_name(patched_session):
    """匯出的保管人要寫「那個人現在叫什麼」，不是連結當下存下來的名字。

    匯出的檔案常常是改一改再匯回來，而匯回來是拿名字去對人。匯出舊名字的話，
    改過名的人就對不回自己，會變成一筆沒有保管人的治具。
    """
    with patched_session("app.fixture_excel", "app.fixtures") as Session:
        with Session() as db:
            user = User(id=2, username="chen", display_name="陳工", hashed_password="x", role="admin")
            db.add(user)
            db.flush()  # 先讓人員落地，治具的外鍵才指得到
            db.add(Fixture(
                interface_type="M.2", form_factor="2280", total_quantity=1, shortage=0,
                keeper_name="陳工", keeper_user_id=2,
            ))
            db.commit()

            user.display_name = "陳大文"
            db.commit()

            fixture = db.query(Fixture).one()
            row = _fixture_excel_row(fixture, keeper_name_map(db, [fixture]))

        assert row["保管人"] == "陳大文"


def test_import_leaves_columns_the_sheet_does_not_have_alone(patched_session):
    """表格上沒有的欄位不要動。

    匯入以前是整份覆蓋：拿一份只有數量的表格來更新庫存，會順手把備註、廠商、
    保管人全部清空。保管人被清掉還會繞過畫面上那道清除確認。
    """
    dataframe = pd.DataFrame([
        {"介面": "M.2", "型態": "2280", "現有數量": 9},
    ])
    column_map = {
        "interface_type": "介面",
        "form_factor": "型態",
        "total_quantity": "現有數量",
    }

    with patched_session("app.fixture_excel") as Session:
        with Session() as db:
            db.add(User(id=2, username="chen", display_name="陳工", hashed_password="x", role="admin"))
            db.flush()  # 先讓人員落地，治具的外鍵才指得到
            db.add(Fixture(
                interface_type="M.2", form_factor="2280", total_quantity=1, shortage=0,
                keeper_name="陳工", keeper_user_id=2, vendor="固緯電子", note="原本的備註",
            ))
            db.commit()

        result = _run_import_db(dataframe, column_map, actor="1", role="admin")

        assert result["updated"] == 1
        with Session() as db:
            fixture = db.query(Fixture).one()
            assert fixture.total_quantity == 9          # 表格上有的照樣更新
            assert fixture.keeper_name == "陳工"         # 表格上沒有的原封不動
            assert fixture.keeper_user_id == 2
            assert fixture.vendor == "固緯電子"
            assert fixture.note == "原本的備註"
