#!/bin/bash
# dev_start.sh

LOG_FILE=".socat_info.log"

cleanup() {
    echo -e "\n\n👋 正在關閉所有開發服務 (含前端)..."
    kill $BACK_PID $SIM_PID $SOCAT_PID $CLIENT_PID 2>/dev/null
    pkill -P $$ 2>/dev/null
    # 保留日誌供 make logs 事後查閱，不自動刪除
    exit
}
trap cleanup SIGINT SIGTERM EXIT

# 1. 建立串口
echo "🔗 正在建立虛擬串口..."
socat -d -d pty,raw,echo=0 pty,raw,echo=0 2> "$LOG_FILE" &
SOCAT_PID=$!

# 等待 socat 寫入日誌（最多 5 秒，避免系統較慢時抓不到路徑）
for i in {1..5}; do
    PTYS=$(grep -o "/dev/ttys[0-9]*" "$LOG_FILE" 2>/dev/null | tail -n 2)
    PTY_A=$(echo $PTYS | awk '{print $1}')
    PTY_B=$(echo $PTYS | awk '{print $2}')
    if [[ -n "$PTY_A" && -n "$PTY_B" ]]; then break; fi
    sleep 1
done

# 2. 確認串口路徑
if [[ -z "$PTY_A" || -z "$PTY_B" ]]; then
    echo "❌ 串口建立失敗，請確認 socat 已安裝 (brew install socat)"
    exit 1
fi

echo "✅ 模擬器連接埠: $PTY_A | 後端 API 連接埠: $PTY_B"

# 3. 啟動程序
echo "🚀 啟動模擬器 (Simulator)..."
(cd simulator && SIM_PORT="$PTY_A" python3 main.py) &
SIM_PID=$!

echo "🚀 啟動後端 API (FastAPI)..."
# 強制釋放 port 8000（避免 make clean 後殘留程序）
lsof -ti:8000 | xargs kill -9 2>/dev/null || true

(cd backend && SERIAL_PORTS="$PTY_B" uvicorn app.main:app --reload --port 8000 --no-access-log) &
BACK_PID=$!

echo "🚀 啟動前端網頁 (Vite)..."
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
(cd client && npm run dev) &
CLIENT_PID=$!

echo "------------------------------------------------"
echo "✅ 系統已全面啟動！"
echo "🌐 前端網址: http://localhost:5173"
echo "📡 後端網址: http://127.0.0.1:8000/api/latest"
echo "💡 提示: 已隱藏 API 輪詢日誌，僅顯示關鍵邏輯。"
echo "💡 按下 Ctrl+C 同時停止所有服務"
echo "------------------------------------------------"

# 等待主要服務，任一個結束即觸發 cleanup
wait $BACK_PID $SIM_PID $CLIENT_PID