import requests
import json

url = "http://127.0.0.1:8000/api/sop/"

test_methods = [
    {
        "sop_id": "low_temp_test_v1",
        "name": "低溫測試 (IEC 60068-2-1)",
        "test_type": "chamber",
        "version": "1.0",
        "steps": [
            {"step_id": 1, "name": "設備開機與檢查", "description": "確認電源、保險絲、水箱水位正常。", "requires_photo": True, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 2, "name": "設定測試參數", "description": "設定低溫測試條件", "requires_photo": False, "requires_parameters": True, "optional": False, "parameters_schema": {
                "type": "object",
                "properties": {
                    "temperature": {"type": "number", "title": "測試溫度 (°C)", "default": -40},
                    "duration": {"type": "integer", "title": "持續時間 (小時)", "default": 48},
                    "power_on_time": {"type": "integer", "title": "開機時間 (分鐘)", "default": 5},
                    "power_off_time": {"type": "integer", "title": "關機時間 (分鐘)", "default": 2},
                    "cycles": {"type": "integer", "title": "循環次數", "default": 300}
                },
                "required": ["temperature", "duration", "cycles"]
            }},
            {"step_id": 3, "name": "啟動測試", "description": "按下 RUN 鍵，確認測試啟動。", "requires_photo": False, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 4, "name": "監控測試過程", "description": "定時檢查溫度曲線是否正常。", "requires_photo": False, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 5, "name": "儲存測試紀錄", "description": "測試完成後，儲存 CSV 檔案。", "requires_photo": True, "requires_parameters": False, "optional": False, "parameters_schema": None}
        ]
    },
    {
        "sop_id": "high_temp_test_v1",
        "name": "高溫測試 (IEC 60068-2-2)",
        "test_type": "chamber",
        "version": "1.0",
        "steps": [
            {"step_id": 1, "name": "設備開機與檢查", "description": "確認電源、保險絲、水箱水位正常。", "requires_photo": True, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 2, "name": "設定測試參數", "description": "設定高溫測試條件", "requires_photo": False, "requires_parameters": True, "optional": False, "parameters_schema": {
                "type": "object",
                "properties": {
                    "temperature": {"type": "number", "title": "測試溫度 (°C)", "default": 85},
                    "humidity": {"type": "number", "title": "濕度 (%)", "default": 40},
                    "duration": {"type": "integer", "title": "持續時間 (小時)", "default": 16}
                },
                "required": ["temperature", "duration"]
            }},
            {"step_id": 3, "name": "啟動測試", "description": "按下 RUN 鍵，確認測試啟動。", "requires_photo": False, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 4, "name": "監控測試過程", "description": "定時檢查溫度曲線是否正常。", "requires_photo": False, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 5, "name": "儲存測試紀錄", "description": "測試完成後，儲存 CSV 檔案。", "requires_photo": True, "requires_parameters": False, "optional": False, "parameters_schema": None}
        ]
    },
    {
        "sop_id": "temp_cycle_test_v1",
        "name": "溫度循環測試 (IEC 60068-2-14)",
        "test_type": "chamber",
        "version": "1.0",
        "steps": [
            {"step_id": 1, "name": "設備開機與檢查", "description": "確認電源、保險絲、水箱水位正常。", "requires_photo": True, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 2, "name": "設定循環參數", "description": "設定溫度循環條件", "requires_photo": False, "requires_parameters": True, "optional": False, "parameters_schema": {
                "type": "object",
                "properties": {
                    "low_temp": {"type": "number", "title": "低溫 (°C)", "default": -40},
                    "high_temp": {"type": "number", "title": "高溫 (°C)", "default": 85},
                    "cycles": {"type": "integer", "title": "循環次數", "default": 5},
                    "dwell_time": {"type": "integer", "title": "停留時間 (小時)", "default": 3},
                    "ramp_rate": {"type": "number", "title": "升降速率 (°C/min)", "default": 1}
                },
                "required": ["low_temp", "high_temp", "cycles"]
            }},
            {"step_id": 3, "name": "啟動測試", "description": "按下 RUN 鍵，確認測試啟動。", "requires_photo": False, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 4, "name": "監控測試過程", "description": "定時檢查溫度曲線是否正常。", "requires_photo": False, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 5, "name": "儲存測試紀錄", "description": "測試完成後，儲存 CSV 檔案。", "requires_photo": True, "requires_parameters": False, "optional": False, "parameters_schema": None}
        ]
    },
    {
        "sop_id": "damp_heat_cyclic_test_v1",
        "name": "濕熱循環測試 (IEC 60068-2-30)",
        "test_type": "chamber",
        "version": "1.0",
        "steps": [
            {"step_id": 1, "name": "設備開機與檢查", "description": "確認電源、保險絲、水箱水位正常。", "requires_photo": True, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 2, "name": "設定濕熱循環參數", "description": "設定濕熱循環條件", "requires_photo": False, "requires_parameters": True, "optional": False, "parameters_schema": {
                "type": "object",
                "properties": {
                    "low_temp": {"type": "number", "title": "低溫 (°C)", "default": 25},
                    "high_temp": {"type": "number", "title": "高溫 (°C)", "default": 55},
                    "humidity": {"type": "number", "title": "濕度 (%)", "default": 93},
                    "cycles": {"type": "integer", "title": "循環次數", "default": 6},
                    "cycle_duration": {"type": "integer", "title": "每循環時間 (小時)", "default": 24}
                },
                "required": ["low_temp", "high_temp", "humidity", "cycles"]
            }},
            {"step_id": 3, "name": "啟動測試", "description": "按下 RUN 鍵，確認測試啟動。", "requires_photo": False, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 4, "name": "監控測試過程", "description": "定時檢查溫度曲線是否正常。", "requires_photo": False, "requires_parameters": False, "optional": False, "parameters_schema": None},
            {"step_id": 5, "name": "儲存測試紀錄", "description": "測試完成後，儲存 CSV 檔案。", "requires_photo": True, "requires_parameters": False, "optional": False, "parameters_schema": None}
        ]
    }
]

for sop in test_methods:
    response = requests.post(url, json=sop)
    if response.status_code == 200:
        print(f"✅ 成功新增: {sop['name']}")
    else:
        print(f"❌ 失敗 {sop['name']}: {response.status_code} - {response.text}")