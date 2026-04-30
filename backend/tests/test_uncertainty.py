"""量測不確定度模組單元測試"""
import math
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../"))

from backend.app.uncertainty import calc_temp, calc_humi, TEMP_RESOLUTION, HUMI_RESOLUTION


def test_uB_formula():
    """Type B：矩形分佈 u = (a/2)/sqrt(3)"""
    expected = (TEMP_RESOLUTION / 2) / math.sqrt(3)
    result = calc_temp([85.0] * 10, target=85.0)
    assert abs(result.uB - round(expected, 4)) < 1e-6


def test_stable_segment_filter():
    """穩定段過濾：遠離目標的升溫數據不應影響計算"""
    # 升溫 25~79°C（全部超出 85±2 容差）+ dwell 段
    ramp = [float(t) for t in range(25, 80)]
    dwell = [85.0 + (i % 3) * 0.03 for i in range(30)]
    all_temps = ramp + dwell
    result = calc_temp(all_temps, target=85.0, tolerance=2.0)
    assert result.using_stable_only is True
    assert result.n == len(dwell)
    assert result.n_total == len(all_temps)


def test_fallback_when_stable_too_few():
    """穩定段不足 5 筆時退回全段"""
    temps = [85.0, 84.5, 85.5, 86.0, 20.0, 30.0, 50.0]  # 只有 3 筆在 ±2
    result = calc_temp(temps, target=85.0, tolerance=2.0)
    assert result.using_stable_only is False
    assert result.n == len(temps)
    assert result.note is not None


def test_expanded_uncertainty_k2():
    """擴充不確定度：U = 2 * uc"""
    temps = [85.0 + i * 0.01 for i in range(20)]
    result = calc_temp(temps, target=85.0)
    assert result.k == 2
    # U 和 uc 都已四捨五入到 4 位，允許 rounding error
    assert abs(result.U - 2 * result.uc) < 0.001


def test_humidity():
    """濕度不確定度使用 1%RH 解析度"""
    humis = [65.0 + (i % 3) * 0.1 for i in range(30)]
    result = calc_humi(humis, target=65.0, tolerance=5.0)
    expected_uB = (HUMI_RESOLUTION / 2) / math.sqrt(3)
    assert abs(result.uB - round(expected_uB, 4)) < 1e-6
    assert result.unit == "%RH"


def test_empty_returns_none():
    result = calc_temp([], target=85.0)
    assert result is None
