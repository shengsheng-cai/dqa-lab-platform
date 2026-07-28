"""治具庫存與借還生命週期的唯一業務邊界。

Routes 與排程服務可以查資料，但不得自行拼湊可借量公式或直接改借還狀態。
所有庫存數量守衛、reserved → loaned → returned 轉換都集中在這裡。
"""

import datetime
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import func

from .audit_log import log_audit
from .models import Fixture, FixtureInventoryLog, FixtureLoan, ReturnCondition

LOAN_RESERVED = "reserved"
LOAN_LOANED = "loaned"
LOAN_RETURNED = "returned"
LOAN_DAMAGED = "damaged"
LOAN_LOST = "lost"

ACTIVE_LOAN_STATUSES = (LOAN_LOANED, LOAN_RESERVED)
UNAVAILABLE_LOAN_STATUSES = (LOAN_LOANED, LOAN_RESERVED, LOAN_DAMAGED)
CLOSED_LOAN_STATUSES = (LOAN_RETURNED, LOAN_DAMAGED, LOAN_LOST)


@dataclass(frozen=True)
class StockCounts:
    """一支治具的數量拆解：借出中 / 預約中 / 損壞 / 還能借。"""

    loaned: int
    reserved: int
    damaged: int
    available: int


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
    """確認每支治具都借得夠，不足時中止整筆操作。"""
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
