"""
量測不確定度計算模組
依照 ISO/IEC Guide 98-3 (GUM) 計算環境測試報告所需不確定度。

設計決策：
- Type A：從「穩定段」（溫度落在目標值 ± 容差內）推算，以均值標準誤差表示
- Type B：感測器解析度，矩形分佈，u = (解析度/2) / √3
- 若穩定段不足 5 筆，退回全段數據（並標記 note）
- 擴充係數 k=2，常態分佈假設，信賴水準 ≈ 95%
"""

import math
import statistics as _stats
from dataclasses import dataclass
from typing import Optional

TEMP_RESOLUTION = 0.1   # °C，感測器解析度
HUMI_RESOLUTION = 1.0   # %RH


@dataclass
class UncertaintyResult:
    n: int                    # 計算所用樣本數
    n_total: int              # 全段樣本數
    using_stable_only: bool   # 是否成功限縮穩定段
    mean: float               # 樣本均值
    std_dev: float            # 樣本標準差
    uA: float                 # Type A 標準不確定度
    uB: float                 # Type B 標準不確定度（解析度）
    uc: float                 # 組合標準不確定度
    k: int                    # 擴充係數
    U: float                  # 擴充不確定度
    unit: str                 # 單位
    note: Optional[str] = None


def _uB(resolution: float) -> float:
    """矩形分佈：半寬 = resolution/2，u = a/√3"""
    return (resolution / 2.0) / math.sqrt(3.0)


def calc(
    values: list[float],
    target: float,
    tolerance: float,
    resolution: float,
    unit: str,
) -> Optional[UncertaintyResult]:
    """計算單一量（溫度或濕度）的量測不確定度。"""
    if not values:
        return None

    n_total = len(values)

    # 嘗試限縮穩定段（target ± tolerance）
    stable = [v for v in values if abs(v - target) <= tolerance]
    if len(stable) >= 5:
        data = stable
        using_stable = True
        note = None
    else:
        data = values
        using_stable = False
        note = f"穩定段樣本不足（{len(stable)} 筆），改用全段 {n_total} 筆計算"

    n = len(data)
    mean = _stats.mean(data)
    std_dev = _stats.stdev(data) if n >= 2 else 0.0

    uA = std_dev / math.sqrt(n) if n >= 2 else 0.0
    uB = _uB(resolution)
    uc = math.sqrt(uA ** 2 + uB ** 2)
    k = 2
    U = k * uc

    return UncertaintyResult(
        n=n,
        n_total=n_total,
        using_stable_only=using_stable,
        mean=round(mean, 3),
        std_dev=round(std_dev, 4),
        uA=round(uA, 4),
        uB=round(uB, 4),
        uc=round(uc, 4),
        k=k,
        U=round(U, 4),
        unit=unit,
        note=note,
    )


def calc_temp(
    temps: list[float],
    target: float,
    tolerance: float = 2.0,
) -> Optional[UncertaintyResult]:
    return calc(temps, target, tolerance, TEMP_RESOLUTION, "°C")


def calc_humi(
    humis: list[float],
    target: float,
    tolerance: float = 5.0,
) -> Optional[UncertaintyResult]:
    return calc(humis, target, tolerance, HUMI_RESOLUTION, "%RH")
