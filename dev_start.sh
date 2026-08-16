#!/bin/bash
# dev_start.sh

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 四個服務的 log 集中放這，不要散在根目錄。make clean 整個目錄刪掉。
LOG_DIR="$ROOT_DIR/.logs"
mkdir -p "$LOG_DIR"
PYTHON_BIN=""
BACK_PID=""
CLIENT_PID=""
NGROK_PID=""
HF_PREVIEW_PID=""

listening_pids() {
    lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
}

stop_listener() {
    local port="$1"
    local pids
    pids="$(listening_pids "$port")"
    if [ -z "$pids" ]; then
        return 0
    fi

    echo "$pids" | xargs kill -9 2>/dev/null || true
    for _ in {1..20}; do
        [ -z "$(listening_pids "$port")" ] && return 0
        sleep 0.1
    done

    echo "❌ port $port 仍有服務監聽，無法啟動"
    return 1
}

wait_http() {
    local url="$1"
    local pid="$2"
    local timeout_seconds="$3"
    local deadline=$((SECONDS + timeout_seconds))

    while [ "$SECONDS" -lt "$deadline" ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            return 1
        fi
        if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.25
    done
    return 1
}

show_log_tail() {
    local log_file="$1"
    if [ -f "$log_file" ]; then
        echo "--- ${log_file#$ROOT_DIR/} 最後 25 行 ---"
        tail -n 25 "$log_file"
    fi
}

cleanup() {
    local exit_code=$?
    trap - EXIT SIGINT SIGTERM
    echo -e "\n\n👋 正在關閉所有開發服務..."
    exec 2>/dev/null
    for pid in "$BACK_PID" "$CLIENT_PID" "$NGROK_PID" "$HF_PREVIEW_PID"; do
        [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    done
    pkill -P $$ 2>/dev/null || true
    for pid in "$BACK_PID" "$CLIENT_PID" "$NGROK_PID" "$HF_PREVIEW_PID"; do
        [ -n "$pid" ] && wait "$pid" 2>/dev/null || true
    done
    exit "$exit_code"
}

if [ -x "$ROOT_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$ROOT_DIR/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
else
    echo "❌ 找不到 Python，請先安裝 Python 3"
    exit 1
fi
for command_name in lsof curl npm; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "❌ 找不到必要指令：$command_name"
        exit 1
    fi
done

trap cleanup EXIT
trap 'exit 130' SIGINT SIGTERM

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
HF_PREVIEW_READY=0
ALLOWED_ORIGINS_DEFAULT="${ALLOWED_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173,http://localhost:${HF_PREVIEW_PORT},http://127.0.0.1:${HF_PREVIEW_PORT}}"
PREVIEW_ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(read_env_value ADMIN_PASSWORD)}"
PREVIEW_DEMO_PASSWORD="${DEMO_PASSWORD:-$(read_env_value DEMO_PASSWORD)}"
PREVIEW_GEMINI_API_KEY="${GEMINI_API_KEY:-$(read_env_value GEMINI_API_KEY)}"
if [ -z "$PREVIEW_ADMIN_PASSWORD" ]; then
    PREVIEW_ADMIN_PASSWORD="hf_preview_admin"
fi
if [ -z "$PREVIEW_DEMO_PASSWORD" ]; then
    PREVIEW_DEMO_PASSWORD="hf_preview_guest"
fi

# 1. 啟動後端 API (FastAPI)
echo "🚀 啟動後端 API (FastAPI)..."
stop_listener 8000 || exit 1
(cd "$ROOT_DIR/backend" && ALLOWED_ORIGINS="$ALLOWED_ORIGINS_DEFAULT" "$PYTHON_BIN" -m uvicorn app.main:app --reload --port 8000 --no-access-log) > "$LOG_DIR/backend.log" 2>&1 &
BACK_PID=$!

# 2. 啟動前端網頁 (Vite)
echo "🚀 啟動前端網頁 (Vite)..."
stop_listener 5173 || exit 1
(cd "$ROOT_DIR/client" && npm run dev -- --port 5173 --strictPort) > "$LOG_DIR/frontend.log" 2>&1 &
CLIENT_PID=$!

if wait_http "http://localhost:8000/health" "$BACK_PID" 30; then
    echo "✅ 後端 API 已就緒：http://localhost:8000"
else
    echo "❌ 後端 API 啟動失敗"
    show_log_tail "$LOG_DIR/backend.log"
    exit 1
fi

if wait_http "http://localhost:5173" "$CLIENT_PID" 30; then
    echo "✅ 前端網頁已就緒：http://localhost:5173"
else
    echo "❌ 前端網頁啟動失敗"
    show_log_tail "$LOG_DIR/frontend.log"
    exit 1
fi

# 3. 啟動 ngrok（背景執行）
if command -v ngrok >/dev/null 2>&1; then
    echo "🌐 啟動 ngrok..."
    if stop_listener 4040; then
        ngrok http 8000 --log=stdout > "$LOG_DIR/ngrok.log" 2>&1 &
        NGROK_PID=$!
    else
        echo "⚠️  略過 ngrok 與 LINE Webhook 自動更新"
    fi
else
    echo "⚠️  找不到 ngrok，略過 ngrok 與 LINE Webhook 自動更新"
fi

# 3.5 啟動 HF 本地預覽（背景執行，可關閉：HF_PREVIEW_AUTO=0 make dev）
if [ "$HF_PREVIEW_AUTO" = "1" ]; then
    echo "🧪 啟動 HF 本地預覽..."
    if [ -n "$(listening_pids "$HF_PREVIEW_PORT")" ]; then
        echo "ℹ️  發現舊的 HF 預覽程序，先重啟以清除鎖定狀態..."
    fi
    if ! stop_listener "$HF_PREVIEW_PORT"; then
        echo "⚠️  略過 HF 本地預覽"
    else
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
            export GEMINI_API_KEY="$PREVIEW_GEMINI_API_KEY"
            export LINE_CHANNEL_ACCESS_TOKEN=""
            export LINE_USER_ID=""
            export LINE_CHANNEL_SECRET=""
            export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$ALLOWED_ORIGINS_DEFAULT}"
            (cd "$ROOT_DIR/backend" && "$PYTHON_BIN" init_db.py >/dev/null)

            echo "[4/4] Start preview server ..."
            cd "$ROOT_DIR/backend"
            exec "$PYTHON_BIN" -m uvicorn app.main:app --host 127.0.0.1 --port "$HF_PREVIEW_PORT" --no-access-log
        ) > "$LOG_DIR/hf-preview.log" 2>&1 &
        HF_PREVIEW_PID=$!
        if wait_http "http://localhost:${HF_PREVIEW_PORT}/health" "$HF_PREVIEW_PID" 60; then
            HF_PREVIEW_READY=1
            echo "✅ HF 本地預覽已就緒：http://localhost:${HF_PREVIEW_PORT}"
        else
            echo "⚠️  HF 本地預覽啟動失敗，請查看 .logs/hf-preview.log"
            show_log_tail "$LOG_DIR/hf-preview.log"
            pkill -P "$HF_PREVIEW_PID" 2>/dev/null || true
            kill "$HF_PREVIEW_PID" 2>/dev/null || true
            wait "$HF_PREVIEW_PID" 2>/dev/null || true
            HF_PREVIEW_PID=""
        fi
    fi
else
    echo "ℹ️  已略過 HF 本地預覽（HF_PREVIEW_AUTO=0）"
fi

NGROK_URL=""
if [ -n "$NGROK_PID" ]; then
    echo "⏳ 等待 ngrok 就緒..."
    for _ in {1..15}; do
        if ! kill -0 "$NGROK_PID" 2>/dev/null; then
            break
        fi
        sleep 1
        NGROK_URL=$(curl -fsS --max-time 1 http://localhost:4040/api/tunnels 2>/dev/null \
            | "$PYTHON_BIN" -c "
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
        if [ -n "$NGROK_URL" ]; then
            break
        fi
    done
fi

if [ -n "$NGROK_PID" ] && [ -z "$NGROK_URL" ]; then
    echo "⚠️  ngrok 未能在時限內就緒，跳過 LINE Webhook 自動更新"
    echo "   如需使用 LINE Bot，請執行 make ngrok 後手動更新 Webhook URL"
    show_log_tail "$LOG_DIR/ngrok.log"
elif [ -n "$NGROK_URL" ]; then
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
            | "$PYTHON_BIN" -c "import sys,json; d=json.load(sys.stdin); print(d.get('endpoint',''))" 2>/dev/null)

        if [ "$CURRENT" = "$WEBHOOK_URL" ]; then
            echo "✅ LINE Webhook 已確認設定：$WEBHOOK_URL"
        else
            echo "⚠️  LINE Webhook 設定失敗，目前為：$CURRENT"
            echo "   請手動填入：$WEBHOOK_URL"
        fi
    fi
fi

echo "------------------------------------------------"
echo "✅ 核心服務已啟動！"
echo "🌐 前端網址:    http://localhost:5173"
echo "📡 後端網址:    http://localhost:8000"
echo "🔍 API 文件:    http://localhost:8000/docs"
if [ "$HF_PREVIEW_READY" -eq 1 ]; then
    echo "🧪 HF 本地預覽: http://localhost:${HF_PREVIEW_PORT}"
elif [ "$HF_PREVIEW_AUTO" = "0" ]; then
    echo "🧪 HF 本地預覽: 已關閉（可用 HF_PREVIEW_AUTO=1 make dev 開啟）"
else
    echo "🧪 HF 本地預覽: 未就緒（查看上方訊息與 .logs/hf-preview.log）"
fi
if [ -n "$NGROK_URL" ]; then
    echo "🌐 ngrok 公開網址: $NGROK_URL"
    echo "🌐 ngrok 面板:     http://localhost:4040"
else
    echo "🌐 ngrok:          未啟動或未就緒"
fi
echo "💡 按下 Ctrl+C 同時停止所有服務"
echo "------------------------------------------------"

while kill -0 "$BACK_PID" 2>/dev/null && kill -0 "$CLIENT_PID" 2>/dev/null; do
    sleep 1
done
[ -n "$BACK_PID" ] && ! kill -0 "$BACK_PID" 2>/dev/null && echo "❌ 後端 API 已停止"
[ -n "$CLIENT_PID" ] && ! kill -0 "$CLIENT_PID" 2>/dev/null && echo "❌ 前端網頁已停止"
exit 1
