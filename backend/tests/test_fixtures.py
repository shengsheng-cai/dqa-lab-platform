"""
T-06: fixtures 模組純函數測試
- _calc_replacement_date（純函數）
- _build_loan_qty_map（需要 db fixture）
- _fixture_to_out（純函數，數量來自 _build_loan_qty_map）
"""
import datetime
from app.models import Fixture, FixtureLoan
from app.fixtures import _calc_replacement_date, _build_loan_qty_map, _fixture_to_out


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


# ── _build_loan_qty_map ────────────────────────────────────────────────────


def _seed_fixture(db, total_quantity=10) -> Fixture:
    f = _make_fixture(total_quantity=total_quantity)
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


def test_loan_qty_map_no_loans(db):
    f = _seed_fixture(db)
    assert _build_loan_qty_map(db, [f.id]) == {}


def test_loan_qty_map_sums_correctly(db):
    f = _seed_fixture(db)
    _seed_loan(db, f.id, 2, "loaned")
    _seed_loan(db, f.id, 3, "loaned")
    assert _build_loan_qty_map(db, [f.id])[(f.id, "loaned")] == 5


def test_loan_qty_map_separates_status(db):
    f = _seed_fixture(db)
    _seed_loan(db, f.id, 2, "loaned")
    _seed_loan(db, f.id, 1, "reserved")
    qty_map = _build_loan_qty_map(db, [f.id])
    assert qty_map[(f.id, "loaned")] == 2
    assert qty_map[(f.id, "reserved")] == 1


def test_loan_qty_map_separates_fixtures(db):
    """一次查多個治具，數量不會互相混到"""
    f1 = _seed_fixture(db)
    f2 = _seed_fixture(db)
    _seed_loan(db, f1.id, 2, "loaned")
    _seed_loan(db, f2.id, 7, "loaned")
    qty_map = _build_loan_qty_map(db, [f1.id, f2.id])
    assert qty_map[(f1.id, "loaned")] == 2
    assert qty_map[(f2.id, "loaned")] == 7


def test_loan_qty_map_empty_ids(db):
    """空 id 清單直接回 {}，不打 DB"""
    assert _build_loan_qty_map(db, []) == {}


# ── _fixture_to_out ────────────────────────────────────────────────────────


def test_fixture_to_out_available_quantity(db):
    """available = total - loaned - reserved - damaged"""
    f = _seed_fixture(db, total_quantity=10)
    _seed_loan(db, f.id, 2, "loaned")
    _seed_loan(db, f.id, 1, "reserved")
    db.flush()

    result = _fixture_to_out(f, _build_loan_qty_map(db, [f.id]))
    assert result["total_quantity"] == 10
    assert result["loaned_quantity"] == 2
    assert result["reserved_quantity"] == 1
    assert result["available_quantity"] == 7


def test_fixture_to_out_available_not_negative(db):
    """available 最小為 0，不可為負"""
    f = _seed_fixture(db, total_quantity=1)
    _seed_loan(db, f.id, 3, "loaned")
    db.flush()

    result = _fixture_to_out(f, _build_loan_qty_map(db, [f.id]))
    assert result["available_quantity"] == 0


def test_fixture_to_out_no_loans(db):
    """沒有借出紀錄 → available 等於 total"""
    f = _seed_fixture(db, total_quantity=5)

    result = _fixture_to_out(f, _build_loan_qty_map(db, [f.id]))
    assert result["available_quantity"] == 5
    assert result["loaned_quantity"] == 0
    assert result["reserved_quantity"] == 0
