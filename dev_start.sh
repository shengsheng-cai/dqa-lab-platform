#!/bin/bash
# dev_start.sh

LOG_FILE=".socat_info.log"

cleanup() {
    echo -e "\n\n👋 正在關閉所有開發服務 (含前端)..."
    # 確保所有背景程序都被確實關閉
    kill $BACK_PID $SIM_PID $SOCAT_PID $CLIENT_PID 2>/dev/null
    pkill -P $$ 2>/dev/null
    rm -f "$LOG_FILE"
    exit
}
trap cleanup SIGINT SIGTERM EXIT

# 1. 建立串口
echo "🔗 正在建立虛擬串口..."
socat -d -d pty,raw,echo=0 pty,raw,echo=0 2> "$LOG_FILE" &
SOCAT_PID=$!
sleep 1 

# 2. 解析路徑
# 從日誌中提取 socat 分配的虛擬串口路徑
PTYS=$(grep -o "/dev/ttys[0-9]*" "$LOG_FILE" | tail -n 2)
PTY_A=$(echo $PTYS | awk '{print $1}')
PTY_B=$(echo $PTYS | awk '{print $2}')

if [[ -z "$PTY_A" || -z "$PTY_B" ]]; then echo "❌ 串口建立失敗"; exit 1; fi

echo "✅ 模擬器連接埠: $PTY_A | 後端 API 連接埠: $PTY_B"

# 3. 啟動程序
echo "🚀 啟動模擬器 (Simulator)..."
# 模擬器的輸出會保留在終端機，方便查看設備邏輯
(cd simulator && SIM_PORT="$PTY_A" python3 main.py) &
SIM_PID=$!

echo "🚀 啟動後端 API (FastAPI)..."
# 加入 --no-access-log 減少每秒輪詢的日誌刷屏
(cd backend && SERIAL_PORTS="$PTY_B" uvicorn app.main:app --reload --port 8000 --no-access-log) &
BACK_PID=$!

# 4. 啟動前端
echo "🚀 啟動前端網頁 (Vite)..."
# 前端通常訊息較少，直接輸出
(cd client && npm run dev) &
CLIENT_PID=$!

echo "------------------------------------------------"
echo "✅ 系統已全面啟動！"
echo "🌐 前端網址: http://localhost:5173"
echo "📡 後端網址: http://127.0.0.1:8000/api/latest"
echo "💡 提示: 已隱藏 API 輪詢日誌，僅顯示關鍵邏輯。"
echo "💡 按下 Ctrl+C 同時停止所有服務"
echo "------------------------------------------------"

# 等待所有背景程序
wait