"""外鍵補上刪除行為並開啟檢查

SQLite 預設不檢查外鍵，刪掉被引用的資料只會留下孤兒 ID。
連線那端已改成一律 PRAGMA foreign_keys=ON，這裡把「父列被刪時子列該怎麼辦」寫進 schema：

- 指向 users：SET NULL。刪人是管理動作，不該被歷史資料卡住；顯示用的姓名另有文字欄位，
  責任追溯留在稽核紀錄。
- 指向 fixtures：RESTRICT。治具走軟刪除（is_active=False），這等於把「不准硬刪」寫死。
- 指向 schedules：中間表 schedule_fixtures 跟著 CASCADE，借用紀錄與執行紀錄 SET NULL
  （執行紀錄原本沒人清，刪排程就會留下孤兒）。
- step_records 跟著 sop_executions CASCADE。

Revision ID: b7f4c2e91a05
Revises: 245015128670
Create Date: 2026-08-21

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b7f4c2e91a05'
down_revision: Union[str, Sequence[str], None] = '245015128670'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 舊表的外鍵多數沒有名字，SQLite 也不能單獨 ALTER 掉一個約束。batch mode 會整表重建，
# 但重建前得先叫得出約束的名字才能 drop，所以給 alembic 一套命名規則，讓它反射出來時
# 自動補上與 models.py 相同的名字。
NAMING_CONVENTION = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

# 表 -> [(欄位, 指向的表, 刪除行為)]；同一張表的外鍵一次重建完，不要重複開 batch。
FOREIGN_KEYS: dict[str, list[tuple[str, str, str]]] = {
    "fixtures": [("keeper_user_id", "users", "SET NULL")],
    "fixture_inventory_logs": [("fixture_id", "fixtures", "RESTRICT")],
    "fixture_loans": [
        ("fixture_id", "fixtures", "RESTRICT"),
        ("borrower_user_id", "users", "SET NULL"),
        ("schedule_id", "schedules", "SET NULL"),
    ],
    "schedule_fixtures": [
        ("schedule_id", "schedules", "CASCADE"),
        ("fixture_id", "fixtures", "RESTRICT"),
    ],
    "purchase_orders": [("fixture_id", "fixtures", "RESTRICT")],
    "demo_tokens": [("created_by", "users", "SET NULL")],
    "sop_executions": [("schedule_id", "schedules", "SET NULL")],
    "step_records": [("execution_id", "sop_executions", "CASCADE")],
    "schedules": [
        ("applicant_user_id", "users", "SET NULL"),
        ("created_by", "users", "SET NULL"),
        ("confirmed_by", "users", "SET NULL"),
    ],
    "device_blocked_periods": [("created_by", "users", "SET NULL")],
}


def _assert_no_orphans() -> None:
    """升級前先掃一遍舊資料。

    外鍵檢查以前沒開，資料庫可能已經存在指向不存在資料的舊 ID。整表重建會原樣複製過去，
    打開檢查也不會回頭驗算，那些資料只會在下次被更新時才突然炸開。這裡先攔下來。
    只回報不自動清：要留著還是清空得看實際資料，不該由 migration 替人決定。
    """
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        return

    counts: dict[tuple[str, str], int] = {}
    for child, _rowid, parent, _fk_index in bind.exec_driver_sql("PRAGMA foreign_key_check"):
        counts[(child, parent)] = counts.get((child, parent), 0) + 1
    if counts:
        detail = "、".join(
            f"{child} 有 {n} 列指向不存在的 {parent}" for (child, parent), n in sorted(counts.items())
        )
        raise RuntimeError(f"資料庫有指向不存在資料的舊資料，請先處理再升級：{detail}")


def _rewrite_foreign_keys(*, with_ondelete: bool) -> None:
    """整表重建，把外鍵換成宣告的刪除行為；with_ondelete=False 用於還原成沒有行為。"""
    for table, columns in FOREIGN_KEYS.items():
        with op.batch_alter_table(table, naming_convention=NAMING_CONVENTION) as batch_op:
            for column, referred_table, ondelete in columns:
                name = f"fk_{table}_{column}"
                batch_op.drop_constraint(name, type_="foreignkey")
                batch_op.create_foreign_key(
                    name,
                    referred_table,
                    [column],
                    ["id"],
                    ondelete=ondelete if with_ondelete else None,
                )


def upgrade() -> None:
    """Upgrade schema."""
    _assert_no_orphans()
    _rewrite_foreign_keys(with_ondelete=True)


def downgrade() -> None:
    """Downgrade schema."""
    _rewrite_foreign_keys(with_ondelete=False)
