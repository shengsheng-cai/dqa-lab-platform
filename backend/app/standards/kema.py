"""
KEMA / CENELEC 電力設備認證
ramp_rate：⚠️ 待確認，付費文件無法取得，暫用 2.0°C/min
"""

from ._base import steps_single_temp, steps_cycle

TREE = {
    "label": "KEMA / CENELEC 電力設備認證",
    "description": "KEMA KEUR 認證，基於 IEC/CENELEC 標準，適用於電力基礎設施設備。KEMA Labs 為 ISO/IEC 17025 認可實驗室。",
    "versions": {
        "KEMA KEUR (IEC/CENELEC)": {
            "label": "KEMA KEUR（現行，基於 IEC/CENELEC）",
            "description": "KEMA 認證測試依 IEC 60068 系列執行，無獨立溫箱測試標準，由 KEMA Labs 依客戶規格客制化測試程序。",
            "tests": {
                "Dry_Heat_+70": {
                    "sop_id": "kema_dry_heat_70",
                    "name": "乾熱測試：+70°C，16h（IEC 60068-2-2 Test Bb）",
                    "test_type": "chamber",
                    "version": "KEMA KEUR",
                    "description": "KEMA 電力設備高溫工作測試，+70°C 持續 16 小時，通電狀態，依 IEC 60068-2-2 Test Bb 執行。",
                    "high_temperature": 70.0,
                    "low_temperature": None,
                    "target_temperature": 70.0,
                    "ramp_rate": 2.0,  # ⚠️ 待確認，付費文件無法取得
                    "dwell_time_hours": 16,
                    "cycles": 1,
                    "humidity_rh_percent": None,
                    "humidity_control": False,
                    "power_on": True,
                    "temp_tolerance": 2.0,
                    "humi_tolerance": 5.0,
                    "reference": "KEMA KEUR + IEC 60068-2-2 Test Bb",
                    "steps": steps_single_temp(70.0, 16, "high"),
                },
                "Cold_-25": {
                    "sop_id": "kema_cold_-25",
                    "name": "冷測試：-25°C，16h（IEC 60068-2-1 Test Ab）",
                    "test_type": "chamber",
                    "version": "KEMA KEUR",
                    "description": "KEMA 電力設備低溫儲存測試，-25°C 持續 16 小時，非通電，依 IEC 60068-2-1 Test Ab 執行。",
                    "high_temperature": None,
                    "low_temperature": -25.0,
                    "target_temperature": -25.0,
                    "ramp_rate": 2.0,  # ⚠️ 待確認，付費文件無法取得
                    "dwell_time_hours": 16,
                    "cycles": 1,
                    "humidity_rh_percent": None,
                    "humidity_control": False,
                    "power_on": False,
                    "temp_tolerance": 2.0,
                    "humi_tolerance": 5.0,
                    "reference": "KEMA KEUR + IEC 60068-2-1 Test Ab",
                    "steps": steps_single_temp(-25.0, 16, "low"),
                },
                "Damp_Heat_+40_93RH": {
                    "sop_id": "kema_damp_40_93rh",
                    "name": "濕熱穩態：+40°C，93%RH，4 天（IEC 60068-2-78）",
                    "test_type": "chamber",
                    "version": "KEMA KEUR",
                    "description": "KEMA 電力設備濕熱穩態測試，+40°C，93%RH，持續 96 小時（4 天）。依 IEC 60068-2-78 Test Cab 執行。",
                    "high_temperature": 40.0,
                    "low_temperature": None,
                    "target_temperature": 40.0,
                    "ramp_rate": 2.0,  # ⚠️ 待確認，付費文件無法取得
                    "dwell_time_hours": 96,
                    "cycles": 1,
                    "humidity_rh_percent": 93.0,
                    "humidity_control": True,
                    "power_on": False,
                    "temp_tolerance": 2.0,
                    "humi_tolerance": 5.0,
                    "reference": "KEMA KEUR + IEC 60068-2-78 Test Cab",
                    "steps": steps_single_temp(40.0, 96, "high"),
                },
                "Temp_Cycle_-25_+70": {
                    "sop_id": "kema_cycle_-25_+70",
                    "name": "溫度循環：-25°C ↔ +70°C，3 循環（IEC 60068-2-14 Test Nb）",
                    "test_type": "chamber",
                    "version": "KEMA KEUR",
                    "description": "KEMA 電力設備溫度循環，-25°C ↔ +70°C，2°C/min，3 循環，依 IEC 60068-2-14 Test Nb 執行。",
                    "high_temperature": 70.0,
                    "low_temperature": -25.0,
                    "target_temperature": 70.0,
                    "ramp_rate": 2.0,  # ⚠️ 待確認，IEC 60068-2-14 Nb 允許 1~15°C/min
                    "dwell_time_hours": 1,
                    "cycles": 3,
                    "humidity_rh_percent": None,
                    "humidity_control": False,
                    "power_on": False,
                    "temp_tolerance": 2.0,
                    "humi_tolerance": 5.0,
                    "reference": "KEMA KEUR + IEC 60068-2-14 Test Nb",
                    "steps": steps_cycle(-25.0, 70.0, 3),
                },
            },
        },
    },
}
