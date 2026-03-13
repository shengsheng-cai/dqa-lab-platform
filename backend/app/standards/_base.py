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
            "description": f"監控溫度曲線，確認正在{'升' if mode == 'high' else '降'}溫至 {temp}°C，速率符合標準要求，無異常跳動。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
        },
        {
            "step_id": 2,
            "name": f"確認達到目標溫度 {temp}°C",
            "description": f"確認溫度已穩定在 {temp}°C ± 容差範圍內，開始計時 {duration_h} 小時停留。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
        },
        {
            "step_id": 3,
            "name": f"{direction}停留中期確認",
            "description": "停留時間過半時確認溫度仍穩定，設備與樣品無異常。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": True,
        },
        {
            "step_id": 4,
            "name": f"{duration_h}h 停留完成，拍照記錄",
            "description": f"確認已完成 {duration_h} 小時{direction}停留，拍照記錄設備狀態與樣品外觀。",
            "requires_photo": True,
            "requires_parameters": False,
            "optional": False,
        },
        {
            "step_id": 5,
            "name": "儲存測試紀錄",
            "description": "點擊儲存按鈕，確認執行紀錄已寫入資料庫，下載 CSV 測試報告。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
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
            "description": f"監控第一個循環的升降溫速率，確認曲線符合標準要求{humi_note}，無異常。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
        },
        {
            "step_id": 2,
            "name": f"確認高溫 {high}°C 停留正常",
            "description": f"確認溫度穩定在 {high}°C ± 容差，開始計時高溫停留。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
        },
        {
            "step_id": 3,
            "name": f"確認低溫 {low}°C 停留正常",
            "description": f"確認溫度穩定在 {low}°C ± 容差，開始計時低溫停留。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
        },
        {
            "step_id": 4,
            "name": "中期循環檢查",
            "description": "循環過半時確認每個循環的高低溫停留時間正確，有異常立即停止。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": True,
        },
        {
            "step_id": 5,
            "name": f"全部 {cycles} 循環完成，拍照記錄",
            "description": f"確認 {cycles} 個循環全部完成，設備無異常，拍照記錄最終狀態。",
            "requires_photo": True,
            "requires_parameters": False,
            "optional": False,
        },
        {
            "step_id": 6,
            "name": "儲存測試紀錄",
            "description": "點擊儲存按鈕，確認執行紀錄已寫入資料庫，下載 CSV 測試報告。",
            "requires_photo": False,
            "requires_parameters": False,
            "optional": False,
        },
    ]
