"""
前端收得到的每個校驗狀態，都要有中文名稱。

漏一個不會有任何錯誤訊息，而且兩個畫面會用不同的方式壞掉：設備卡的徽章查不到顏色就
整個不畫（`CalibBadge` 直接 return null），左欄摘要則把不認得的值算進「未校驗」，
等於宣稱那台設備沒有校驗紀錄。兩邊都不會紅，這裡把它變成會紅的測試。

跟 test_sim_phase_labels.py 同一個做法，驗的不是後端邏輯，而是 repo 裡兩份東西必須同步。
比對來源用 models.py 的 CalibrationStatus：那是這四個值的權威，計算的地方
（devices_maintenance.py 的 calibration-status 端點）只能從它挑。
"""
import pathlib
import re

import pytest

from app.models import CalibrationStatus

CALIBRATION_JS = (
    pathlib.Path(__file__).resolve().parents[2] / "client" / "src" / "utils" / "calibration.js"
)

_LABEL_TABLE = re.compile(r"const CALIBRATION_STATUS_LABEL = Object\.freeze\(\{(.*?)\}\);", re.S)
_LABEL_KEY = re.compile(r"^\s*([a-z_0-9]+):", re.M)


def _labelled_statuses() -> set[str]:
    table = _LABEL_TABLE.search(CALIBRATION_JS.read_text())
    assert table, "calibration.js 裡找不到 CALIBRATION_STATUS_LABEL"
    return set(_LABEL_KEY.findall(table.group(1)))


@pytest.mark.parametrize("status", sorted(s.value for s in CalibrationStatus))
def test_every_calibration_status_has_a_chinese_label(status):
    assert status in _labelled_statuses(), (
        f"校驗狀態 API 會回傳 {status!r}，但 client/src/utils/calibration.js 的 "
        "CALIBRATION_STATUS_LABEL 沒有這一項，設備卡的徽章會消失、"
        "左欄摘要會把它算成「未校驗」。"
    )


def test_frontend_table_has_no_status_the_backend_never_sends():
    """反向也要擋：前端多列一個後端不會送的值，代表其中一邊改過而另一邊沒跟上。"""
    extra = _labelled_statuses() - {s.value for s in CalibrationStatus}
    assert not extra, (
        f"client/src/utils/calibration.js 列了後端不會回傳的校驗狀態：{sorted(extra)}"
    )
