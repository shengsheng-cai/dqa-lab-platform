#!/bin/bash
# dev_start.sh

cleanup() {
    echo -e "\n\n👋 正在關閉所有開發服務..."
    kill $BACK_PID $CLIENT_PID $NGROK_PID $HF_PREVIEW_PID 2>/dev/null
    pkill -P $$ 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM EXIT

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="$ROOT_DIR/venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
fi

read_env_value() {
    local key="$1"
    local env_file="$ROOT_DIR/backend/.env"
    if [ ! -f "$env_file" ]; then
        return 0
    fi
    grep "^${key}=" "$env_file" | tail -n1 | cut -d'=' -f2- | tr -d '\r'
}

HF_PREVIEW_AUTO="${HF_PREVIEW_AUTO:-1}"
HF_PREVIEW_PORT="${HF_PREVIEW_PORT:-7861}"
HF_PREVIEW_DB_PATH="${HF_PREVIEW_DB_PATH:-/tmp/dqa-hf-preview.db}"
HF_PREVIEW_PID=""
ALLOWED_ORIGINS_DEFAULT="${ALLOWED_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173,http://localhost:7861,http://127.0.0.1:7861}"
PREVIEW_ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(read_env_value ADMIN_PASSWORD)}"
PREVIEW_DEMO_PASSWORD="${DEMO_PASSWORD:-$(read_env_value DEMO_PASSWORD)}"
if [ -z "$PREVIEW_ADMIN_PASSWORD" ]; then
    PREVIEW_ADMIN_PASSWORD="hf_preview_admin"
fi
if [ -z "$PREVIEW_DEMO_PASSWORD" ]; then
    PREVIEW_DEMO_PASSWORD="hf_preview_guest"
fi

# 1. 啟動後端 API (FastAPI)
echo "🚀 啟動後端 API (FastAPI)..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
(cd backend && ALLOWED_ORIGINS="$ALLOWED_ORIGINS_DEFAULT" ../venv/bin/uvicorn app.main:app --reload --port 8000 --no-access-log) > "$ROOT_DIR/.backend.log" 2>&1 &
BACK_PID=$!

# 2. 啟動前端網頁 (Vite)
echo "🚀 啟動前端網頁 (Vite)..."
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
(cd client && npm run dev) > "$ROOT_DIR/.frontend.log" 2>&1 &
CLIENT_PID=$!

# 3. 啟動 ngrok（背景執行）
echo "🌐 啟動 ngrok..."
lsof -ti:4040 | xargs kill -9 2>/dev/null || true
ngrok http 8000 --log=stdout > .ngrok.log 2>&1 &
NGROK_PID=$!

# 3.5 啟動 HF 本地預覽（背景執行，可關閉：HF_PREVIEW_AUTO=0 make dev）
if [ "$HF_PREVIEW_AUTO" = "1" ]; then
    echo "🧪 啟動 HF 本地預覽..."
    if lsof -ti:"$HF_PREVIEW_PORT" >/dev/null 2>&1; then
        echo "ℹ️  發現舊的 HF 預覽程序，先重啟以清除鎖定狀態..."
        lsof -ti:"$HF_PREVIEW_PORT" | xargs kill -9 2>/dev/null || true
    fi

    (
        set -e
        echo "[1/4] Build frontend (client/dist) ..."
        (cd "$ROOT_DIR/client" && VITE_API_URL="http://localhost:${HF_PREVIEW_PORT}" VITE_WS_BASE_URL="ws://localhost:${HF_PREVIEW_PORT}" npm run build >/dev/null)

        HF_STATIC_DIR="/tmp/dqa-hf-static"
        echo "[2/4] Sync static assets to ${HF_STATIC_DIR} ..."
        rm -rf "$HF_STATIC_DIR"
        cp -R "$ROOT_DIR/client/dist" "$HF_STATIC_DIR"

        echo "[3/4] Seed preview DB ..."
        rm -f "$HF_PREVIEW_DB_PATH"
        export DATABASE_URL="sqlite:////${HF_PREVIEW_DB_PATH#/}"
        export ENVIRONMENT="production"
        export STATIC_DIR="$HF_STATIC_DIR"
        export ADMIN_PASSWORD="$PREVIEW_ADMIN_PASSWORD"
        export DEMO_PASSWORD="$PREVIEW_DEMO_PASSWORD"
        export GEMINI_API_KEY="${GEMINI_API_KEY:-hf_preview_dummy_key}"
        export LINE_CHANNEL_ACCESS_TOKEN=""
        export LINE_USER_ID=""
        export LINE_CHANNEL_SECRET=""
        export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$ALLOWED_ORIGINS_DEFAULT}"
        (cd "$ROOT_DIR/backend" && "$PYTHON_BIN" init_db.py >/dev/null)

        echo "[4/4] Start preview server ..."
        cd "$ROOT_DIR/backend"
        exec "$PYTHON_BIN" -m uvicorn app.main:app --host 127.0.0.1 --port "$HF_PREVIEW_PORT" --no-access-log
    ) > "$ROOT_DIR/.hf-preview.log" 2>&1 &
    HF_PREVIEW_PID=$!
    sleep 3
    if kill -0 "$HF_PREVIEW_PID" 2>/dev/null; then
        echo "✅ HF 本地預覽啟動中：http://localhost:${HF_PREVIEW_PORT}"
    else
        echo "⚠️  HF 本地預覽啟動失敗，請查看 .hf-preview.log"
    fi
else
    echo "ℹ️  已略過 HF 本地預覽（HF_PREVIEW_AUTO=0）"
fi

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
    LINE_TOKEN=$(read_env_value LINE_CHANNEL_ACCESS_TOKEN)

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
if [ "$HF_PREVIEW_AUTO" = "1" ]; then
    echo "🧪 HF 本地預覽: http://localhost:${HF_PREVIEW_PORT}"
else
    echo "🧪 HF 本地預覽: 已關閉（可用 HF_PREVIEW_AUTO=1 make dev 開啟）"
fi
echo "🌐 ngrok 面板:  http://localhost:4040"
echo "💡 按下 Ctrl+C 同時停止所有服務"
echo "------------------------------------------------"

wait $BACK_PID $CLIENT_PID
