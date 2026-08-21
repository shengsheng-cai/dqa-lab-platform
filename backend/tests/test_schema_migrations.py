"""Alembic 是 schema 的唯一權威——這裡驗證它真的蓋得住 model。

`init_db()` 只 `create_all`，那條路只服務全新的資料庫；既有資料庫補欄一律
`alembic upgrade head`。所以「migration 全跑完的資料庫」必須和 model 定義一致：
少一張表或少一欄，本地舊 DB 升級後一查就是 no such column，整個後端起不來。

這裡是真的把 migration 跑起來再對照，不是掃 migration 檔的字串——掃字串分不出
`upgrade()` 的 add_column 和 `downgrade()` 的 drop_column，也驗不到 migration 本身跑不跑得動。

外鍵的刪除行為（父列被刪時子列 SET NULL／CASCADE／擋下來）也一起比對：這個行為只寫在
建表語句裡，改了 model 卻沒寫 migration 的話，既有資料庫會安靜地維持舊行為。
"""

import pathlib
import tempfile
from typing import NamedTuple
from unittest.mock import patch

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.models import Base


class MigratedSchema(NamedTuple):
    columns: dict[str, set[str]]
    # (表, 欄位) -> (指向的表, 刪除行為)
    foreign_keys: dict[tuple[str, str], tuple[str, str]]

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]


def _schema_after_upgrade(db_path: pathlib.Path) -> MigratedSchema:
    """在全新的暫存 SQLite 上跑完整條 migration chain，回傳實際建出的表與欄位。

    這裡是全套測試裡唯一用檔案型 SQLite 的地方：Alembic 要對一個真的能反覆連線的
    資料庫跑 DDL，conftest 那顆 in-memory 引擎進不去。指定 DB 位置也不能用 conftest
    的 `patched_session`——alembic/env.py 是自己 `from app.models import
    SQLALCHEMY_DATABASE_URL` 再塞進 `sqlalchemy.url`，所以要蓋的是那個常數。
    兩個保險一起下，任一條路被改掉都不會讓 migration 跑進開發用的 aicm.db。

    刻意不讀 alembic.ini：env.py 只要看到 config 有 ini 檔就會呼叫 `fileConfig()`，
    那會停用先前建立的 logger，害後面用 caplog 斷言的測試莫名其妙變紅。
    這裡需要的設定只有 script_location，直接給就好。
    """
    url = f"sqlite:///{db_path}"
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with patch("app.models.SQLALCHEMY_DATABASE_URL", url), patch.dict(
        "os.environ", {"DATABASE_URL": url}
    ):
        command.upgrade(config, "head")

    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        columns = {
            table: {column["name"] for column in inspector.get_columns(table)}
            for table in tables
        }
        foreign_keys = {
            (table, ",".join(fk["constrained_columns"])): (
                fk["referred_table"],
                (fk.get("options") or {}).get("ondelete") or "NO ACTION",
            )
            for table in tables
            for fk in inspector.get_foreign_keys(table)
        }
        return MigratedSchema(columns=columns, foreign_keys=foreign_keys)
    finally:
        engine.dispose()


def _model_foreign_keys() -> dict[tuple[str, str], tuple[str, str]]:
    """model 宣告的外鍵與刪除行為，格式與 migration 跑出來的那份對齊。"""
    return {
        (name, ",".join(column.name for column in constraint.columns)): (
            constraint.referred_table.name,
            constraint.ondelete or "NO ACTION",
        )
        for name, table in Base.metadata.tables.items()
        for constraint in table.foreign_key_constraints
    }


@pytest.fixture(scope="module")
def migrated_schema() -> MigratedSchema:
    """整條 migration chain 跑完的樣子，一個模組只跑一次。"""
    with tempfile.TemporaryDirectory() as tmp_dir:
        return _schema_after_upgrade(pathlib.Path(tmp_dir) / "migrated.db")


def test_migrations_cover_every_model_table_and_column(migrated_schema):
    migrated = migrated_schema.columns

    missing_tables = sorted(set(Base.metadata.tables) - set(migrated))
    assert missing_tables == [], f"model 有表但 migration 沒建：{missing_tables}"

    missing_columns = {}
    for name, table in Base.metadata.tables.items():
        missing = {column.name for column in table.columns} - migrated.get(name, set())
        if missing:
            missing_columns[name] = sorted(missing)
    assert missing_columns == {}, f"model 有欄位但 migration 沒補：{missing_columns}"


def test_migrations_match_model_foreign_key_delete_behaviour(migrated_schema):
    """外鍵指到哪張表、父列被刪時怎麼辦，migration 要和 model 說的一樣。"""
    assert migrated_schema.foreign_keys == _model_foreign_keys()
