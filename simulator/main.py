import os
import random
import serial
import threading
import time


# KSON AICM 工業級通訊協議模擬器類別
class KsonChamberSimulator(threading.Thread):
    """模擬 KSON AICM 協議，模擬數據發送至工業控制設備

    Attributes:
        name (str): 設備識別名稱（預設：KSON_CH01）
        port (str): 串口端口名稱（預設：/dev/ttys000）
        temp (float): 模擬溫度值（預設：25.0°C）
        humi (float): 模擬濕度值（預設：55%）
    """

    def __init__(self, name="KSON_CH01", port="/dev/ttys000"):
        super().__init__()
        self.daemon = True
        self.name = name  # 設備識別名稱
        self.port = port  # 串口端口名稱
        self.temp = 25.0  # 模擬溫度值（預設：25°C）
        self.humi = 55.0  # 模擬濕度值（預設：55%）

    def run(self):
        """
        執行緒程式，持續發送模擬數據至指定端口
        """
        print(f"🚀 [AICM Sim] 開始發送模擬數據至: {self.port}")
        while True:
            try:
                # 啟動串口連接
                with serial.Serial(self.port, 9600, timeout=1) as ser:
                    while True:
                        # 模擬物理數值細微跳動
                        self.temp += random.uniform(-0.12, 0.12)
                        self.humi += random.uniform(-0.25, 0.25)

                        # 格式必須嚴格對齊：ID，TEMP，HUMI，STATUS
                        data = f"ID:{self.name},TEMP:{self.temp:.2f},HUMI:{self.humi:.1f},STATUS:RUNNING\n"
                        ser.write(data.encode())

                        print(f"📡 [Sim Out]: {data.strip()}")
                        time.sleep(1)  # 每秒更新一次
            except Exception as e:
                print(f"⚠️ [Sim Error]: {e}, 2秒後嘗試重連...")
                time.sleep(2)
