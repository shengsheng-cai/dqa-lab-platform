"""
T-12: curve_total_minutes 單一時長來源測試

以前「甘特預估 / 設備卡 estimated_end / 模擬器實際推進」各抄一份溫度曲線時長，
其中「單溫恆溫要不要乘 cycles」兩份答案還不同。收成 utils.curve_total_minutes 後：

1. 純算術，不必再 patch get_standard（下方分支測試全無 mock）。
2. 直接驅動 simulator 的相位機到 done，證明「預估 == 模擬器實際跑完的時間」——
   特別是以前會分岔的「單溫 + cycles>1」，模擬器只 dwell 一次，預估也必須只算一次。
"""
import datetime

from app.constants import AMBIENT_TEMP
from app.simulator import _SimParams, _advance_sim_phase
from app.utils import curve_total_minutes

UTC = datetime.timezone.utc


# ── 純分支覆蓋（無 mock）──────────────────────────────────────────────────────


def test_high_temp_only():
    """純高溫（無 low）：ramp up + dwell + ramp down，cycles 不影響"""
    # ramp_rate=2, high=85, ambient=25 → ramp=30；dwell=60 → 30+60+30=120
    assert curve_total_minutes(2.0, 60.0, 1, 85.0, None) == 120.0
    # cycles 對單溫無意義，結果不變
    assert curve_total_minutes(2.0, 60.0, 5, 85.0, None) == 120.0


def test_single_cold_dwell_once():
    """單溫冷測（high≈low<ambient）：只 dwell 一次"""
    # ramp_rate=5, low=high=-10, ambient=25 → ramp=7；dwell=120 → 7+120+7=134
    assert curve_total_minutes(5.0, 120.0, 1, -10.0, -10.0) == 134.0


def test_single_cold_cycles_ignored():
    """曾經的 bug：schedule_service 那份對單溫恆溫乘了 cycles，設備卡與模擬器只算一次。
    收斂後 cycles>1 仍只 dwell 一次。"""
    once = curve_total_minutes(5.0, 120.0, 1, -10.0, -10.0)
    thrice = curve_total_minutes(5.0, 120.0, 3, -10.0, -10.0)
    assert once == thrice == 134.0


def test_single_hot_dwell_once():
    """單溫熱測（high≈low≥常溫，用雙欄表達）：升到設定點、dwell 一次、回常溫，cycles 不乘。
    以前這種輸入會掉進雙溫分支被乘 cycles，與模擬器不一致。"""
    # ramp_rate=5, high=low=60, ambient=25 → ramp=7；dwell=30 → 7+30+7=44
    once = curve_total_minutes(5.0, 30.0, 1, 60.0, 60.0)
    thrice = curve_total_minutes(5.0, 30.0, 3, 60.0, 60.0)
    assert once == thrice == 44.0


def test_two_temp_cold_cycle():
    """雙溫循環（low<ambient<high）：每 cycle 兩段 ramp_hl + 兩段 dwell"""
    # ramp_rate=3, low=-10, high=85, ambient=25, dwell=60, cycles=2
    r_lo = abs(25.0 - (-10.0)) / 3.0
    r_hl = abs(85.0 - (-10.0)) / 3.0
    expected = r_lo + (r_hl + 60.0) * 2 * 2 + r_lo
    assert abs(curve_total_minutes(3.0, 60.0, 2, 85.0, -10.0) - expected) < 1e-9


def test_both_above_ambient():
    """高低溫都在常溫以上：起步升到高溫、末段降回常溫"""
    # ramp_rate=2, high=85, low=40, ambient=25, dwell=30, cycles=2
    r_up = abs(85.0 - 25.0) / 2.0
    r_hl = abs(85.0 - 40.0) / 2.0
    r_dn = abs(40.0 - 25.0) / 2.0
    expected = r_up + (30.0 * 2 + r_hl * 2) * (2 - 1) + (30.0 * 2 + r_hl) + r_dn
    assert abs(curve_total_minutes(2.0, 30.0, 2, 85.0, 40.0) - expected) < 1e-9


def test_ramp_rate_zero_guarded():
    """ramp_rate<=0 內部退回 1.0，不會除以零"""
    assert curve_total_minutes(0.0, 60.0, 1, 85.0, None) > 0
    assert curve_total_minutes(-3.0, 60.0, 1, 85.0, None) > 0


# ── 預估 == 模擬器實際推進 ─────────────────────────────────────────────────────


def _run_sim_minutes(
    high: float, low, dwell_min: float, cycles: int, ramp_rate: float, tick: float = 5.0,
) -> float:
    """把 simulator 的相位機從常溫驅動到 done，回傳實際模擬掉的分鐘數。

    每 tick 推進 tick 秒、now 同步前進（dwell 計時靠 wall-clock），直到 sim_phase=done。
    """
    item = {"temperature": AMBIENT_TEMP, "sim_phase": "idle", "sim_cycle": 0}
    dwell_start: dict = {}
    dwell_elapsed: dict = {}
    now = datetime.datetime(2024, 1, 1, tzinfo=UTC)
    p = _SimParams(
        high_temp=high,
        low_temp=low,
        dwell_seconds=dwell_min * 60.0,
        cycles=cycles,
        max_ramp_rate=ramp_rate,
        elapsed_seconds=tick,
    )
    elapsed = 0.0
    for _ in range(1_000_000):  # 安全上限，正常遠遠用不到
        item["temperature"] = _advance_sim_phase(
            "CH-TEST", item, now, dwell_start, dwell_elapsed, p
        )
        elapsed += tick
        now += datetime.timedelta(seconds=tick)
        if item["sim_phase"] == "done":
            break
    return elapsed / 60.0


def test_estimate_matches_simulator_single_cold_cycles():
    """以前會分岔的輸入：單溫 -20°C、cycles=3。模擬器只 dwell 一次，預估必須對得上。"""
    est = curve_total_minutes(5.0, 30.0, 3, -20.0, -20.0)
    actual = _run_sim_minutes(high=-20.0, low=-20.0, dwell_min=30.0, cycles=3, ramp_rate=5.0)
    assert abs(actual - est) < 3.0  # 離散化誤差 < 幾個 tick，遠小於「多 dwell 兩次」的 60 分鐘


def test_estimate_matches_simulator_two_temp_cycle():
    """雙溫循環也對得上模擬器實跑"""
    est = curve_total_minutes(6.0, 20.0, 2, 60.0, -20.0)
    actual = _run_sim_minutes(high=60.0, low=-20.0, dwell_min=20.0, cycles=2, ramp_rate=6.0)
    assert abs(actual - est) < 3.0


def test_estimate_matches_simulator_single_hot_cycles():
    """單溫熱測、cycles=3：模擬器只 dwell 一次，預估必須對得上（熱的那半以前沒守）。"""
    est = curve_total_minutes(5.0, 30.0, 3, 60.0, 60.0)
    actual = _run_sim_minutes(high=60.0, low=60.0, dwell_min=30.0, cycles=3, ramp_rate=5.0)
    assert abs(actual - est) < 3.0
