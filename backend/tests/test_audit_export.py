"""稽核 CSV 匯出的 formula injection 防護。"""
from app.audit import _csv_safe


def test_csv_safe_prefixes_formula_leading_chars():
    """開頭是公式字元或 tab/CR 的值要被前置單引號中和。"""
    for lead in ("=", "+", "-", "@", "\t", "\r"):
        out = _csv_safe(lead + "cmd|'/c calc'!A1")
        assert out.startswith("'"), f"{lead!r} 開頭未被中和：{out!r}"


def test_csv_safe_passes_normal_values():
    """一般字串、空值、None、數字不受影響。"""
    assert _csv_safe("CH-01 校驗") == "CH-01 校驗"
    assert _csv_safe("") == ""
    assert _csv_safe(None) == ""
    assert _csv_safe(123) == "123"
