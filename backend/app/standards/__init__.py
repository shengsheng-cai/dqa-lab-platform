"""
環境測試標準定義 + SOP 步驟整合
架構：五個法規子模組 → __init__.py 組裝 STANDARD_TREE → 向後相容 STANDARDS_AND_SOPS 平坦結構

資料來源（公開法規）：
- IEC 60068-2-1:2007  (Test A: Cold)
- IEC 60068-2-2:2007  (Test B: Dry Heat)
- IEC 60068-2-14:2023 (Test N: Temperature Change, Na/Nb)
- IEC 60068-2-30:2005 (Test Db: Damp Heat Cyclic)
- EN 50155:2017       (OT1~OT6, ST0/ST1/ST2, Rapid Temp Variation)
- IEC 61850-3 Ed.1:2002 / Ed.2:2013 (Class C1/C2/C3)
- IEC 60945:2002      (Maritime navigation equipment, Portable/Protected/Exposed)
- DNVGL-CG-0339:2015  (Location Class A/B/C/D)
- DNV Std.Cert.2.4    (舊版 Class A/B/C/D)
ramp_rate 說明：
  ✅ 法規明文規定：
    - EN 50155:2017 乾熱/冷測：1°C/min（法規曲線圖明文）
    - EN 50155:2017 RTV：≥20°C/min（法規明文）
    - DNVGL-CG-0339:2015 乾熱/冷測：1°C/min（Sec.3 [7][9] 明文）
    - IEC 60068-2-14 Test Nb：1~15°C/min（法規允許範圍）
    - IEC 60068-2-14 Test Na：轉換 <30 秒（非速率概念，設 30.0）
    - IEC 60068-2-1 標溫（-25°C 等級）：1°C/min
    - IEC 60068-2-1 寬溫（-40°C 及以下）：3°C/min
    - IEC 61850-3 冷測：1°C/min
    - IEC 60068-2-2 (Ba/Bb)：3.0°C/min（法規無明確規定，暫用寬溫值）
    - IEC 60068-2-30 (Db)：2.0°C/min（IEC 60068-2-30 程序控制，非獨立速率）
    - IEC 60945:2002：1°C/min（法規未明確規定）

模組結構：
  standards/
  ├── __init__.py     ← 本檔，組裝 STANDARD_TREE + 工具函數
  ├── _base.py        ← steps_single_temp / steps_cycle 工廠函數
  ├── iec60068.py     ← IEC 60068-2-1/2/14/30/78（17 條）
  ├── en50155.py      ← EN 50155:2017 + 2007（21 條）
  ├── iec61850.py     ← IEC 61850-3 Ed.2/Ed.1（19 條）
  ├── iec60945.py     ← IEC 60945:2002（7 條）
  └── dnv.py          ← DNV CG-0339 + Std.Cert.2.4（14 條）

注意：KEMA / NMEA 因無原始法規文件可供對照，暫不納入。
"""

import logging
from typing import Dict, Any, Optional

from . import iec60068, en50155, iec61850, iec60945, dnv

logger = logging.getLogger("standards")


# ══════════════════════════════════════════════════════════════
# 三層巢狀標準樹：法規 → 版本 → 測試條件
# ══════════════════════════════════════════════════════════════

STANDARD_TREE: Dict[str, Any] = {
    "IEC 60068": iec60068.TREE,
    "EN 50155": en50155.TREE,
    "IEC 61850-3": iec61850.TREE,
    "IEC 60945": iec60945.TREE,
    "DNV": dnv.TREE,
}


# ══════════════════════════════════════════════════════════════
# 向後相容：從 STANDARD_TREE 自動展開 STANDARDS_AND_SOPS
# 供 sop.py / main.py / reports.py 使用（import 路徑不變）
# ══════════════════════════════════════════════════════════════


def _build_flat_standards() -> Dict[str, Any]:
    """將 STANDARD_TREE 展開為向後相容的平坦結構"""
    flat: Dict[str, Any] = {}
    for std_key, std_data in STANDARD_TREE.items():
        for ver_key, ver_data in std_data["versions"].items():
            for test_key, test_data in ver_data["tests"].items():
                sop_id = test_data["sop_id"]
                if sop_id in flat:
                    logger.warning(f"duplicate sop_id '{sop_id}' in STANDARD_TREE")
                flat[sop_id] = {
                    **test_data,
                    "standard_id": sop_id,
                    "standard_family": std_key,
                    "standard_version": ver_key,
                    "number_of_cycles": test_data.get("cycles", 1),
                    "ramp_rate_max": test_data.get("ramp_rate", 1.0),
                    "dwell_time_hours": test_data.get("dwell_time_hours", 1),
                }
    return flat


STANDARDS_AND_SOPS: Dict[str, Any] = _build_flat_standards()


# ══════════════════════════════════════════════════════════════
# 工具函數（向後相容，main.py / sop.py 直接 import）
# ══════════════════════════════════════════════════════════════


def get_standard(sop_id: str) -> Dict[str, Any]:
    return STANDARDS_AND_SOPS.get(sop_id, {})


def get_ramp_rate(sop_id: str) -> float:
    std = get_standard(sop_id)
    return std.get("ramp_rate", 1.0)


def get_all_standards() -> list:
    return list(STANDARDS_AND_SOPS.keys())


def get_sop_by_standard(sop_id: str) -> Optional[Dict[str, Any]]:
    std = get_standard(sop_id)
    if not std:
        return None
    return {
        "sop_id": std["sop_id"],
        "name": std["name"],
        "test_type": std["test_type"],
        "version": std["version"],
        "description": std.get("description", ""),
        "steps": std.get("steps", []),
    }


def get_standard_tree() -> Dict[str, Any]:
    return STANDARD_TREE
