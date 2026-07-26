AMBIENT_TEMP: float = 25.0
AMBIENT_HUMIDITY: float = 55.0
DEVICE_IDS: list[str] = ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"]

# 測試回到常溫後仍需的常溫穩定時間；屬測試流程的一部分，期間設備仍算被占用。
# 設備卡、排程器估算、模擬器三處一律讀這一個常數，不各自寫死。
STABILIZATION_MINUTES: float = 30.0
