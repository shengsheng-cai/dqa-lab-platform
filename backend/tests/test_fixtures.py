"""
T-06: fixtures 模組純函數測試
- _calc_replacement_date（純函數）
- _calc_loan_qty（需要 db fixture）
- _fixture_to_out（需要 db fixture）
"""
import datetime
import pytest
from app.models import Fixture, FixtureLoan
from app.fixtures import _calc_replacement_date, _calc_loan_qty, _fixture_to_out


def _make_fixture(**kwargs) -> Fixture:
    defaults = {
        "interface_type": "USB",
        "form_factor": "Desktop",
        "total_quantity": 10,
        "shortage": 0,
    }
    defaults.update(kwargs)
    return Fixture(**defaults)


# ── _calc_replacement_date ─────────────────────────────────────────────────


def test_replacement_date_no_years():
    f = _make_fixture(replacement_years=None, created_at=datetime.datetime(2024, 1, 1))
    assert _calc_replacement_date(f) is None


def test_replacement_date_no_created_at():
    f = _make_fixture(replacement_years="5年", created_at=None)
    assert _calc_replacement_date(f) is None


def test_replacement_date_basic():
    """5 年 = 1825 天"""
    f = _make_fixture(replacement_years="5年", created_at=datetime.datetime(2020, 1, 1))
    expected = (datetime.datetime(2020, 1, 1) + datetime.timedelta(days=1825)).strftime("%Y-%m-%d")
    assert _calc_replacement_date(f) == expected


def test_replacement_date_decimal():
    """0.5 年 = 182 天"""
    f = _make_fixture(replacement_years="0.5", created_at=datetime.datetime(2024, 1, 1))
    expected = (datetime.datetime(2024, 1, 1) + datetime.timedelta(days=182)).strftime("%Y-%m-%d")
    assert _calc_replacement_date(f) == expected


def test_replacement_date_integer_only():
    """純數字字串（無「年」）也能解析"""
    f = _make_fixture(replacement_years="3", created_at=datetime.datetime(2024, 6, 1))
    expected = (datetime.datetime(2024, 6, 1) + datetime.timedelta(days=1095)).strftime("%Y-%m-%d")
    assert _calc_replacement_date(f) == expected


def test_replacement_date_invalid_string():
    """無法解析的字串 → 回傳 None"""
    f = _make_fixture(replacement_years="abc", created_at=datetime.datetime(2024, 1, 1))
    assert _calc_replacement_date(f) is None


# ── _calc_loan_qty ─────────────────────────────────────────────────────────


def _seed_fixture(db, total_quantity=10) -> Fixture:
    f = Fixture(
        interface_type="USB", form_factor="Desktop",
        total_quantity=total_quantity, shortage=0,
    )
    db.add(f)
    db.flush()
    return f


def _seed_loan(db, fixture_id: int, quantity: int, status: str):
    loan = FixtureLoan(
        fixture_id=fixture_id,
        borrower_name="測試人員",
        quantity=quantity,
        status=status,
        loan_date=datetime.datetime.now(),
    )
    db.add(loan)
    db.flush()


def test_calc_loan_qty_no_loans(db):
    f = _seed_fixture(db)
    assert _calc_loan_qty(db, f.id, "loaned") == 0


def test_calc_loan_qty_sums_correctly(db):
    f = _seed_fixture(db)
    _seed_loan(db, f.id, 2, "loaned")
    _seed_loan(db, f.id, 3, "loaned")
    assert _calc_loan_qty(db, f.id, "loaned") == 5


def test_calc_loan_qty_filters_by_status(db):
    f = _seed_fixture(db)
    _seed_loan(db, f.id, 2, "loaned")
    _seed_loan(db, f.id, 1, "reserved")
    assert _calc_loan_qty(db, f.id, "loaned") == 2
    assert _calc_loan_qty(db, f.id, "reserved") == 1


def test_calc_loan_qty_nonexistent_fixture(db):
    assert _calc_loan_qty(db, 9999, "loaned") == 0


# ── _fixture_to_out ────────────────────────────────────────────────────────


def test_fixture_to_out_available_quantity(db):
    """available = total - loaned - reserved - damaged"""
    f = _seed_fixture(db, total_quantity=10)
    _seed_loan(db, f.id, 2, "loaned")
    _seed_loan(db, f.id, 1, "reserved")
    db.flush()

    result = _fixture_to_out(db, f)
    assert result["total_quantity"] == 10
    assert result["loaned_quantity"] == 2
    assert result["reserved_quantity"] == 1
    assert result["available_quantity"] == 7


def test_fixture_to_out_available_not_negative(db):
    """available 最小為 0，不可為負"""
    f = _seed_fixture(db, total_quantity=1)
    _seed_loan(db, f.id, 3, "loaned")
    db.flush()

    result = _fixture_to_out(db, f)
    assert result["available_quantity"] == 0


def test_fixture_to_out_no_loans(db):
    """沒有借出紀錄 → available 等於 total"""
    f = _seed_fixture(db, total_quantity=5)

    result = _fixture_to_out(db, f)
    assert result["available_quantity"] == 5
    assert result["loaned_quantity"] == 0
    assert result["reserved_quantity"] == 0
