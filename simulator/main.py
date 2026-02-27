import os
import random
import serial
import threading
import time

class KsonChamberSimulator(threading.Thread):
    """模擬 KSON AICM 工業級通訊協議"""
    def __init__(self, name="KSON_CH01", port="/dev/ttys000"):
        super().__init__()
        self.daemon = True
        self.name = name
        self.port = port
        self.temp = 25.0
        self.humi = 55.0

    def run(self):
        print(f"🚀 [AICM Sim] 開始發送模擬數據至: {self.port}")
        while True:
            try:
                with serial.Serial(self.port, 9600, timeout=1) as ser:
                    while True:
                        # 模擬物理數值細微跳動
                        self.temp += random.uniform(-0.12, 0.12)
                        self.humi += random.uniform(-0.25, 0.25)
                        
                        # 格式必須嚴格對齊: ID, TEMP, HUMI, STATUS
                        data = f"ID:{self.name},TEMP:{self.temp:.2f},HUMI:{self.humi:.1f},STATUS:RUNNING\n"
                        ser.write(data.encode())
                        
                        print(f"📡 [Sim Out]: {data.strip()}")
                        time.sleep(1) # 每秒更新一次
            except Exception as e:
                print(f"⚠️ [Sim Error]: {e}, 2秒後嘗試重連...")
                time.sleep(2)