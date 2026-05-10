#!/bin/bash
# dev_start.sh

cleanup() {
    echo -e "\n\n👋 正在關閉所有開發服務..."
    kill $BACK_PID $CLIENT_PID $NGROK_PID 2>/dev/null
    pkill -P $$ 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM EXIT

# 1. 啟動後端 API (FastAPI)
echo "🚀 啟動後端 API (FastAPI)..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
(cd backend && ../venv/bin/uvicorn app.main:app --reload --port 8000 --no-access-log) &
BACK_PID=$!

# 2. 啟動前端網頁 (Vite)
echo "🚀 啟動前端網頁 (Vite)..."
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
(cd client && npm run dev) &
CLIENT_PID=$!

# 3. 啟動 ngrok（背景執行）
echo "🌐 啟動 ngrok..."
lsof -ti:4040 | xargs kill -9 2>/dev/null || true
ngrok http 8000 --log=stdout > .ngrok.log 2>&1 &
NGROK_PID=$!

# 4. 等 ngrok 就緒後自動更新 LINE Webhook
echo "⏳ 等待 ngrok 就緒..."
NGROK_URL=""
for i in {1..15}; do
    sleep 1
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels \
        | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for t in data.get('tunnels', []):
        if t.get('proto') == 'https':
            print(t['public_url'])
            break
except:
    pass
" 2>/dev/null)
    if [ -n "$NGROK_URL" ]; then break; fi
done

if [ -z "$NGROK_URL" ]; then
    echo "⚠️  ngrok 未能在時限內就緒，跳過 LINE Webhook 自動更新"
    echo "   如需使用 LINE Bot，請執行 make ngrok 後手動更新 Webhook URL"
else
    # 讀取 LINE Token（用 cut -d= -f2- 正確處理含 = 號的 base64 值，不污染 shell 環境）
    ENV_FILE="backend/.env"
    LINE_TOKEN=""
    if [ -f "$ENV_FILE" ]; then
        LINE_TOKEN=$(grep "^LINE_CHANNEL_ACCESS_TOKEN=" "$ENV_FILE" | cut -d'=' -f2-)
    fi

    WEBHOOK_URL="${NGROK_URL}/api/line/webhook"

    if [ -z "$LINE_TOKEN" ]; then
        echo "⚠️  未設定 LINE_CHANNEL_ACCESS_TOKEN，跳過 Webhook 自動更新"
        echo "   ngrok URL：$NGROK_URL"
    else
        curl -s -o /dev/null -X PUT https://api.line.me/v2/bot/channel/webhook/endpoint \
            -H "Authorization: Bearer $LINE_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"webhookEndpointUrl\": \"$WEBHOOK_URL\"}"

        # 驗證：直接 GET 確認現在的 Webhook URL 是否正確
        CURRENT=$(curl -s \
            -H "Authorization: Bearer $LINE_TOKEN" \
            https://api.line.me/v2/bot/channel/webhook/endpoint \
            | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('endpoint',''))" 2>/dev/null)

        if [ "$CURRENT" = "$WEBHOOK_URL" ]; then
            echo "✅ LINE Webhook 已確認設定：$WEBHOOK_URL"
        else
            echo "⚠️  LINE Webhook 設定失敗，目前為：$CURRENT"
            echo "   請手動填入：$WEBHOOK_URL"
        fi
    fi
fi

echo "------------------------------------------------"
echo "✅ 系統已全面啟動！"
echo "🌐 前端網址:    http://localhost:5173"
echo "📡 後端網址:    http://localhost:8000"
echo "🔍 API 文件:    http://localhost:8000/docs"
echo "🌐 ngrok 面板:  http://localhost:4040"
echo "💡 按下 Ctrl+C 同時停止所有服務"
echo "------------------------------------------------"

wait $BACK_PID $CLIENT_PID