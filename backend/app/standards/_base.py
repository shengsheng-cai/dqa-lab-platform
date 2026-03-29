"""
共用 SOP 步驟工廠函數
各標準模組 import 此模組，不直接複製函數。
"""

from typing import Optional


def steps_single_temp(temp: float, duration_h: int, mode: str = "high") -> list:
    """單一溫度（乾熱/冷測）執行中步驟"""
    direction = "高溫" if mode == "high" else "低溫"
    return [
        {
            "step_id": 1,
            "name": f"確認{'升' if mode == 'high' else '降'}溫曲線正常",
            "description": f"系統偵測到溫箱開始{'升' if mode == 'high' else '降'}溫，目標 {temp}°C，速率符合標準要求。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
            "auto_trigger": "first_ramp",
        },
        {
            "step_id": 2,
            "name": f"確認達到目標溫度 {temp}°C",
            "description": f"系統偵測到溫度已穩定在 {temp}°C ± 容差範圍內，開始計時 {duration_h} 小時停留。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
            "auto_trigger": "first_dwell",
        },
        {
            "step_id": 3,
            "name": f"{direction}停留中期確認",
            "description": "系統偵測停留時間已過半，溫度仍穩定，設備無異常。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": True,
            "auto_trigger": "dwell_half",
        },
        {
            "step_id": 4,
            "name": f"{duration_h}h 停留完成，補充照片",
            "description": f"已完成 {duration_h} 小時{direction}停留。請拍照記錄設備狀態，可於執行紀錄頁面補充上傳。",
            "requires_photo": True,
            "requires_parameters": False,
            "optional": True,
            "auto_trigger": "complete",
        },
        {
            "step_id": 5,
            "name": "儲存測試紀錄",
            "description": "測試完成，系統自動寫入執行紀錄並產出 CSV 報告。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
            "auto_trigger": "complete",
        },
    ]


def steps_cycle(
    low: float, high: float, cycles: int, humidity: Optional[float] = None
) -> list:
    """循環測試（溫度循環/濕熱循環）執行中步驟"""
    humi_note = f"，濕度 {humidity}%RH" if humidity else ""
    return [
        {
            "step_id": 1,
            "name": "確認第一循環升降溫曲線正常",
            "description": f"系統偵測第一個循環開始升降溫，速率符合標準要求{humi_note}，無異常。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
            "auto_trigger": "first_ramp",
        },
        {
            "step_id": 2,
            "name": f"確認高溫 {high}°C 停留正常",
            "description": f"系統偵測溫度穩定在 {high}°C ± 容差，已開始計時高溫停留。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
            "auto_trigger": "first_dwell",
        },
        {
            "step_id": 3,
            "name": f"確認低溫 {low}°C 停留正常",
            "description": f"系統偵測溫度穩定在 {low}°C ± 容差，已開始計時低溫停留。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
            "auto_trigger": "second_dwell",
        },
        {
            "step_id": 4,
            "name": "中期循環檢查",
            "description": "系統偵測循環過半，確認高低溫停留時間正確，有異常立即停止。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": True,
            "auto_trigger": "cycle_half",
        },
        {
            "step_id": 5,
            "name": f"全部 {cycles} 循環完成，補充照片",
            "description": f"已完成 {cycles} 個循環。請拍照記錄最終狀態，可於執行紀錄頁面補充上傳。",
            "requires_photo": True,
            "requires_parameters": False,
            "optional": True,
            "auto_trigger": "complete",
        },
        {
            "step_id": 6,
            "name": "儲存測試紀錄",
            "description": "測試完成，系統自動寫入執行紀錄並產出 CSV 報告。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
            "auto_trigger": "complete",
        },
    ]
