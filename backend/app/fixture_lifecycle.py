"""治具庫存與借還生命週期的唯一業務邊界。

這個模組同時提供兩種不同層級的函式：

- 排程 service 可用的 transaction primitives 不依賴 FastAPI，包含
  ``activate_schedule_loans`` 與 ``release_schedule_loans``。
- route workflows 與 guards 會以 ``HTTPException`` 回報輸入或狀態錯誤，
  包含 ``assert_stock_available``、數量寫入及手動借還函式。

背景排程不得呼叫會丟出 ``HTTPException`` 的 route helpers；若要共用新的
守衛，應先回傳 domain result 或丟出 domain exception，再由 route 轉成 HTTP。
所有呼叫端都不得自行拼湊可借量公式或直接改借還狀態。
"""

import datetime
import time
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import OperationalError

from .audit_log import log_audit
from .models import Fixture, FixtureInventoryLog, FixtureLoan, ReturnCondition

LOAN_RESERVED = "reserved"
LOAN_LOANED = "loaned"
LOAN_RETURNED = "returned"
LOAN_DAMAGED = "damaged"
LOAN_LOST = "lost"

ACTIVE_LOAN_STATUSES = (LOAN_LOANED, LOAN_RESERVED)

_SQLITE_LOCK_RETRY_SECONDS = 5.0
_SQLITE_LOCK_POLL_SECONDS = 0.01


@dataclass(frozen=True)
class StockCounts:
    """一支治具的數量拆解：借出中 / 預約中 / 損壞 / 還能借。"""

    loaned: int
    reserved: int
    damaged: int
    available: int


def acquire_fixture_allocation_lock(db) -> None:
    """在第一次讀庫存前序列化 SQLite 的借用／預約交易。

    SQLite 沒有 row-level ``FOR UPDATE``；``BEGIN IMMEDIATE`` 會先取得寫入保留鎖，
    直到呼叫端 commit／rollback 才釋放。如此第二個請求只能在前一筆提交後重新計算
    可借量。這必須是 session 的第一個 DB 操作，否則先前讀到的資料可能已經過期。

    測試使用 shared-cache in-memory SQLite，鎖衝突會立即回 ``SQLITE_LOCKED``，不會
    像檔案型 SQLite 等待 busy timeout，因此在同一個短期限內重試。
    """
    if db.get_bind().dialect.name != "sqlite":
        return
    if db.in_transaction():
        raise RuntimeError("治具配置鎖必須在 session 的第一次資料庫操作前取得")

    deadline = time.monotonic() + _SQLITE_LOCK_RETRY_SECONDS
    while True:
        try:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            return
        except OperationalError as exc:
            db.rollback()
            if "locked" not in str(exc).lower() or time.monotonic() >= deadline:
                raise
            time.sleep(_SQLITE_LOCK_POLL_SECONDS)


def build_loan_qty_map(db, fixture_ids: list[int]) -> dict:
    """一次 GROUP BY 查回所有 fixture 的借用數量。"""
    if not fixture_ids:
        return {}
    rows = (
        db.query(FixtureLoan.fixture_id, FixtureLoan.status, func.sum(FixtureLoan.quantity))
        .filter(FixtureLoan.fixture_id.in_(fixture_ids))
        .group_by(FixtureLoan.fixture_id, FixtureLoan.status)
        .all()
    )
    return {(fixture_id, status): quantity for fixture_id, status, quantity in rows}


def stock_counts(fixture: Fixture, loan_map: dict) -> StockCounts:
    """回傳庫存拆解；所有顯示與借出守衛共用同一份公式。"""
    loaned = loan_map.get((fixture.id, LOAN_LOANED), 0)
    reserved = loan_map.get((fixture.id, LOAN_RESERVED), 0)
    damaged = loan_map.get((fixture.id, LOAN_DAMAGED), 0)
    return StockCounts(
        loaned=loaned,
        reserved=reserved,
        damaged=damaged,
        available=max(0, fixture.total_quantity - loaned - reserved - damaged),
    )


def fetch_fixtures_map(db, fixture_ids) -> dict[int, Fixture]:
    ids = set(fixture_ids)
    if not ids:
        return {}
    return {
        fixture.id: fixture
        for fixture in db.query(Fixture).filter(Fixture.id.in_(ids)).all()
    }


def assert_stock_available(db, needed: dict[int, int]) -> None:
    """HTTP route guard：確認每支治具都借得夠，不足時中止整筆操作。"""
    if not needed:
        return
    loan_map = build_loan_qty_map(db, list(needed))
    fixtures = fetch_fixtures_map(db, needed)
    for fixture_id, quantity in needed.items():
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="治具數量必須大於 0")
        fixture = fixtures.get(fixture_id)
        if fixture is None:
            raise HTTPException(status_code=404, detail=f"治具不存在（#{fixture_id}）")
        available = stock_counts(fixture, loan_map).available
        if available < quantity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"治具庫存不足：{fixture.interface_type} {fixture.form_factor} "
                    f"需要 {quantity} 件，目前可借 {available} 件"
                ),
            )


def require_nonnegative_quantity(quantity: int, label: str = "庫存數量") -> int:
    """HTTP route guard：拒絕負數數量並回傳通過驗證的值。"""
    if quantity < 0:
        raise HTTPException(status_code=400, detail=f"{label}不可為負數")
    return quantity


def set_fixture_quantity(fixture: Fixture, quantity: int) -> int:
    """設定總庫存；所有寫入路徑都必須經過這道非負數守衛。"""
    fixture.total_quantity = require_nonnegative_quantity(quantity)
    return fixture.total_quantity


def adjust_fixture_quantity(fixture: Fixture, delta: int) -> int:
    """以差額調整總庫存，並確保結果不會小於零。"""
    return set_fixture_quantity(fixture, (fixture.total_quantity or 0) + delta)


def record_inventory_count(
    db,
    fixture: Fixture,
    actual_quantity: int,
    user_id,
    counted_by,
    role,
) -> tuple[FixtureInventoryLog, int, int]:
    """套用盤點數量、建立盤點紀錄與 audit；不 commit。"""
    previous = fixture.total_quantity
    set_fixture_quantity(fixture, actual_quantity)
    difference = actual_quantity - previous
    log = FixtureInventoryLog(
        fixture_id=fixture.id,
        previous_quantity=previous,
        counted_quantity=actual_quantity,
        difference=difference,
        counted_by=counted_by,
    )
    db.add(log)
    log_audit(
        db,
        str(user_id or "unknown"),
        role,
        "INVENTORY",
        "fixture",
        fixture.id,
        f"盤點：{previous} → {actual_quantity}（差：{difference:+d}）",
    )
    return log, previous, difference


def update_inventory_log_count(
    fixture: Fixture,
    log: FixtureInventoryLog,
    actual_quantity: int,
) -> None:
    """修改既有盤點紀錄時，同步更新主檔並套用相同守衛。"""
    set_fixture_quantity(fixture, actual_quantity)
    log.counted_quantity = actual_quantity
    log.difference = actual_quantity - log.previous_quantity


def create_manual_loan(
    db,
    fixture: Fixture,
    *,
    borrower_name: str,
    borrower_user_id,
    device_id,
    project_name,
    quantity: int,
    due_date,
    loan_date: datetime.datetime,
) -> FixtureLoan:
    """建立手動借出；借出狀態只由生命週期模組指定。"""
    assert_stock_available(db, {fixture.id: quantity})
    loan = FixtureLoan(
        fixture_id=fixture.id,
        borrower_name=borrower_name,
        borrower_user_id=borrower_user_id,
        device_id=device_id,
        project_name=project_name,
        quantity=quantity,
        due_date=due_date,
        status=LOAN_LOANED,
        loan_date=loan_date,
    )
    db.add(loan)
    fixture.loan_count += 1
    return loan


def create_schedule_reservation(
    db,
    *,
    schedule_id: int,
    fixture_id: int,
    borrower_name: str,
    borrower_user_id,
    device_id,
    project_name: str,
    quantity: int,
    due_date,
) -> FixtureLoan:
    """建立排程預約；呼叫端須先以加總後數量通過庫存檢查。"""
    loan = FixtureLoan(
        schedule_id=schedule_id,
        fixture_id=fixture_id,
        borrower_name=borrower_name,
        borrower_user_id=borrower_user_id,
        device_id=device_id,
        project_name=project_name,
        quantity=quantity,
        due_date=due_date,
        status=LOAN_RESERVED,
    )
    db.add(loan)
    return loan


def sync_schedule_reservations(db, schedule_id: int, device_id, due_date) -> None:
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == schedule_id,
        FixtureLoan.status == LOAN_RESERVED,
    ).update(
        {"device_id": device_id, "due_date": due_date},
        synchronize_session=False,
    )


def activate_schedule_loans(
    db,
    schedule_id: int,
    loan_date: datetime.datetime,
) -> None:
    """將一筆排程的預約原子轉為借出。"""
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == schedule_id,
        FixtureLoan.status == LOAN_RESERVED,
    ).update(
        {"status": LOAN_LOANED, "loan_date": loan_date},
        synchronize_session=False,
    )


def release_schedule_loans(
    db,
    schedule_id: int,
    return_date: datetime.datetime,
    *,
    return_loaned: bool = False,
) -> None:
    """排程終止時刪除預約，必要時一併歸還已借出的治具。"""
    db.query(FixtureLoan).filter(
        FixtureLoan.schedule_id == schedule_id,
        FixtureLoan.status == LOAN_RESERVED,
    ).delete(synchronize_session=False)
    if return_loaned:
        db.query(FixtureLoan).filter(
            FixtureLoan.schedule_id == schedule_id,
            FixtureLoan.status == LOAN_LOANED,
        ).update(
            {"status": LOAN_RETURNED, "return_date": return_date},
            synchronize_session=False,
        )


def finish_manual_loan(
    db,
    loan: FixtureLoan,
    return_condition: ReturnCondition,
    return_date: datetime.datetime,
) -> None:
    """結束手動借出並處理正常、損壞、遺失三種結果。"""
    if loan.status not in ACTIVE_LOAN_STATUSES:
        raise HTTPException(status_code=400, detail="此紀錄已結束")

    loan.return_date = return_date
    loan.return_condition = return_condition

    if return_condition == ReturnCondition.NORMAL:
        loan.status = LOAN_RETURNED
    elif return_condition == ReturnCondition.DAMAGED:
        loan.status = LOAN_DAMAGED
    elif return_condition == ReturnCondition.LOST:
        loan.status = LOAN_LOST
        fixture = db.query(Fixture).filter(Fixture.id == loan.fixture_id).first()
        if fixture is not None:
            set_fixture_quantity(
                fixture,
                max(0, (fixture.total_quantity or 0) - loan.quantity),
            )
