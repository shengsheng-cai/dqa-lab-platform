"""治具 Excel adapter 的資料完整性測試。"""

import pandas as pd
import pytest
from fastapi import HTTPException

from app.fixture_excel import _run_import_db
from app.models import Fixture


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
