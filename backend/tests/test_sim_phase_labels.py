"""
前端收得到的每個 sim_phase，都要有中文名稱。

設備卡的相位那一行是「查得到才顯示」（client/src/components/control/DeviceCard.jsx），
所以對照表少一項不會報錯，只會讓那行在畫面上安靜地空白——常溫穩定的 30 分鐘就是這樣
整段不見的：卡片還寫執行中、溫度與倒數都在，只有相位消失。這裡把它變成會紅的測試，
跟 test_doc_translations.py 一樣，驗的不是後端邏輯，而是 repo 裡兩份東西必須同步。

比對的來源用 devices.py 的 SimPhase，不是 simulator.py 的賦值語句：SimPhase 是
DeviceOut.sim_phase 的型別，也就是前端唯一收得到的那個集合。模擬器多寫了一個相位卻沒補進
SimPhase 的話，API 回應驗證會當場失敗，那一段已經有人擋著；沒人擋、只會安靜空白的，
就是 SimPhase 到 constants.js 這一段。
"""
import pathlib
import re
from typing import get_args

import pytest

from app.devices import SimPhase

CONSTANTS = pathlib.Path(__file__).resolve().parents[2] / "client" / "src" / "constants.js"

# idle 不給名字：設備停在這個相位時不算執行中，設備卡本來就不畫相位那一行。
UNLABELLED_PHASES = {"idle"}

_LABEL_TABLE = re.compile(r"export const SIM_PHASE_LABEL = \{(.*?)\};", re.S)
_LABEL_KEY = re.compile(r"^\s*([a-z_0-9]+):", re.M)


def _labelled_phases() -> set[str]:
    table = _LABEL_TABLE.search(CONSTANTS.read_text())
    assert table, "constants.js 裡找不到 SIM_PHASE_LABEL"
    return set(_LABEL_KEY.findall(table.group(1)))


@pytest.mark.parametrize("phase", sorted(set(get_args(SimPhase)) - UNLABELLED_PHASES))
def test_every_phase_the_frontend_can_receive_has_a_chinese_label(phase):
    assert phase in _labelled_phases(), (
        f"設備 API 會回傳 sim_phase={phase!r}，但 client/src/constants.js 的 "
        "SIM_PHASE_LABEL 沒有這一項，設備卡的相位那行會變成空白。"
    )
