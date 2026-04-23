# =============================================================
# Phase 3 預留：真實 RS-485 串口通訊
# 目前系統使用內建 data_simulator() asyncio 模擬引擎，此檔案尚未啟用。
# 對接真實溫箱設備時，於 main.py startup 中初始化此 SerialReader，
# 並在 main.py 中將 data_simulator() 替換為 SerialReader.read_loop()。
# =============================================================
import asyncio
import logging
import serial_asyncio
import datetime
from .models import SessionLocal, DeviceData

logger = logging.getLogger("serial_reader")


class AsyncSerialReader:
    """
    AICM 異步串口解析引擎
    """

    def __init__(self, port, baudrate=9600, device_id="CH-01", cache_callback=None):
        self.port = port
        self.baudrate = baudrate
        self.device_id = device_id
        self.cache_callback = cache_callback

    async def run(self):
        while True:
            try:
                # 建立異步串口連線
                reader, writer = await serial_asyncio.open_serial_connection(
                    url=self.port, baudrate=self.baudrate
                )
                logger.info(f"成功連線至虛擬串口: {self.port}")

                while True:
                    line = await reader.readline()
                    if not line:
                        break

                    raw_str = line.decode().strip()
                    # 解析數據
                    parsed_data = self.parse_aicm_protocol(raw_str)

                    if parsed_data:
                        # 更新 main.py 中的 AICM_CACHE
                        if self.cache_callback:
                            self.cache_callback(self.device_id, parsed_data)

                        # 非同步寫入資料庫
                        await self.save_to_db(parsed_data, raw_str)

                writer.close()
            except Exception as e:
                logger.error(f"串口連線錯誤 {self.port}: {e}")
                await asyncio.sleep(2)

    def parse_aicm_protocol(self, line):
        """解析 ID:...,TEMP:...,HUMI:... 格式"""
        try:
            # 去除空白並根據逗號分割
            kv_pairs = {}
            for item in line.split(","):
                if ":" in item:
                    k, v = item.split(":", 1)
                    kv_pairs[k.strip().upper()] = v.strip()

            # 必須回傳前端預期的 Key 名稱
            return {
                "device_id": kv_pairs.get("ID", self.device_id),
                "temperature": float(kv_pairs.get("TEMP", 0)),
                "humidity": float(kv_pairs.get("HUMI", 0)),
                "status": kv_pairs.get("STATUS", "UNKNOWN"),
                "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
            }
        except Exception as e:
            logger.warning(f"解析失敗 原始字串: {line} | 錯誤: {e}")
            return None

    async def save_to_db(self, data, raw):
        def _job():
            db = SessionLocal()
            try:
                db.add(
                    DeviceData(
                        device_id=self.device_id,
                        temperature=data["temperature"],
                        humidity=data["humidity"],
                        raw_data=raw,
                    )
                )
                db.commit()
            finally:
                db.close()

        await asyncio.get_event_loop().run_in_executor(None, _job)
