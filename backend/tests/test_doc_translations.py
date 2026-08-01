"""
QA 文件的中英對照不得漂掉。

翻譯一旦分成兩個檔案，改了英文忘了改中文不會有任何錯誤訊息，只會安靜地對不上。
這裡把它變成會紅的測試，跟 test_schema_migrations.py 擋「改了 model 忘了寫
migration」是同一個道理——兩者驗的都不是後端邏輯，而是「repo 裡兩份東西必須同步」。

檢查三件事：
1. 每份英文文件都有對應的 .zh-TW.md
2. 兩份的標題結構一致（層級與數量相同）—— 抓「其中一份加了章節、另一份沒跟上」
3. 兩份最上面都有語言切換連結，且當前語言不做成連結
"""
import pathlib
import re

import pytest

QA_DIR = pathlib.Path(__file__).resolve().parents[2] / "docs" / "qa"
ZH_SUFFIX = ".zh-TW.md"
# 切換連結放在開頭幾行；標題與表格之前
SWITCHER_SCAN_LINES = 5

_HEADING = re.compile(r"^(#{1,6}) ")


def _english_docs() -> list[pathlib.Path]:
    return sorted(p for p in QA_DIR.glob("*.md") if not p.name.endswith(ZH_SUFFIX))


def _heading_shape(path: pathlib.Path) -> list[str]:
    """只取標題層級，不取文字——兩份本來就是不同語言。"""
    return [m.group(1) for line in path.read_text().splitlines() if (m := _HEADING.match(line))]


def _head(path: pathlib.Path) -> str:
    return "\n".join(path.read_text().splitlines()[:SWITCHER_SCAN_LINES])


def _ids(paths: list[pathlib.Path]) -> list[str]:
    return [p.name for p in paths]


ENGLISH_DOCS = _english_docs()


def test_qa_dir_has_documents():
    """路徑算錯時，下面的 parametrize 會變成空集合而全部假通過。"""
    assert ENGLISH_DOCS, f"在 {QA_DIR} 找不到任何 QA 文件，路徑可能算錯了"


@pytest.mark.parametrize("en", ENGLISH_DOCS, ids=_ids(ENGLISH_DOCS))
def test_english_doc_has_chinese_translation(en):
    zh = en.with_name(en.stem + ZH_SUFFIX)
    assert zh.exists(), (
        f"{en.name} 沒有對應的中文版。新增英文文件時要一起補 {zh.name}"
    )


@pytest.mark.parametrize("en", ENGLISH_DOCS, ids=_ids(ENGLISH_DOCS))
def test_translation_has_same_heading_structure(en):
    zh = en.with_name(en.stem + ZH_SUFFIX)
    if not zh.exists():
        pytest.skip("缺中文版，由 test_english_doc_has_chinese_translation 回報")

    en_shape, zh_shape = _heading_shape(en), _heading_shape(zh)
    assert en_shape == zh_shape, (
        f"{en.name} 與 {zh.name} 的標題結構不一致"
        f"（英文 {len(en_shape)} 個、中文 {len(zh_shape)} 個）。"
        "多半是其中一份加了章節、另一份沒跟上"
    )


@pytest.mark.parametrize("en", ENGLISH_DOCS, ids=_ids(ENGLISH_DOCS))
def test_both_versions_link_to_each_other(en):
    zh = en.with_name(en.stem + ZH_SUFFIX)
    if not zh.exists():
        pytest.skip("缺中文版，由 test_english_doc_has_chinese_translation 回報")

    assert f"({zh.name})" in _head(en), f"{en.name} 開頭缺少切換到中文版的連結"
    assert f"({en.name})" in _head(zh), f"{zh.name} 開頭缺少切換回英文版的連結"


@pytest.mark.parametrize("en", ENGLISH_DOCS, ids=_ids(ENGLISH_DOCS))
def test_current_language_is_not_a_link(en):
    """當前語言要是純文字，讀者才知道自己在哪一版（Ant Design 等專案的慣例）。"""
    zh = en.with_name(en.stem + ZH_SUFFIX)
    if not zh.exists():
        pytest.skip("缺中文版，由 test_english_doc_has_chinese_translation 回報")

    assert f"({en.name})" not in _head(en), f"{en.name} 不該連向自己"
    assert f"({zh.name})" not in _head(zh), f"{zh.name} 不該連向自己"
