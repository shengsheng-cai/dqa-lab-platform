#!/usr/bin/env bash
#
# E2E 測試執行器
#
# 負責：準備前端、設好測試環境變數、叫 Playwright 跑測試。
# 後端不在這裡開——每個測試檔會自己重灌資料庫、重開後端（見 helpers/backend.js），
# 這樣測試之間不會互相污染。資料庫路徑也由那支檔案決定，這裡不碰。
#
# 跟開發環境完全隔離：
#   - 自己的 port（預設 8100），不碰 make dev 的 8000 / 5173 / 7861
#   - 自己的資料庫（/tmp/dqa-e2e.db，見 helpers/backend.js）
#   - 固定假帳密，不讀 backend/.env 裡的真密碼
#   - LINE 關掉、Gemini 給假 key，不燒額度也不發通知
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="$ROOT_DIR/tests/e2e"
LOG_FILE="$E2E_DIR/.backend.log"

PORT="${E2E_PORT:-8100}"

# build 輸出到 dist-e2e，不用 client/dist。
# 因為 make dev 會把 client/dist 重 build 成 HF 預覽版（API 指向 7861），
# 共用的話 E2E 會沿用到別人蓋掉的版本，然後安靜地連到錯的後端。
DIST_DIR="$ROOT_DIR/client/dist-e2e"

# ── 測試環境變數 ────────────────────────────────────────────────
# 後端 main.py 讀 backend/.env 時不會覆蓋已存在的環境變數，
# 所以這裡設的值一定贏過 .env 裡的真密碼。
export ADMIN_PASSWORD="e2e-admin-pw"
export DEMO_PASSWORD="e2e-guest-pw"
export STATIC_DIR="$DIST_DIR"
export ENVIRONMENT="e2e"
# 給假 key 讓前端 AI 介面照常顯示；AI 測試會在瀏覽器端攔截請求，
# 萬一沒攔到，這把假 key 也只會被 Google 擋掉，不計額度。
export GEMINI_API_KEY="e2e_dummy_key"
export LINE_CHANNEL_SECRET=""
export LINE_CHANNEL_ACCESS_TOKEN=""
export LINE_USER_ID=""
export ALLOWED_ORIGINS="http://127.0.0.1:${PORT}"
export E2E_PORT="$PORT"

# ── 收尾保險：Playwright 正常結束會自己關後端，這裡防它中途被砍 ──
cleanup() {
    # -sTCP:LISTEN：只殺監聽的那個，不要連客戶端連線一起殺
    pids=$(lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── 1. 前端 ─────────────────────────────────────────────────────
# 三種情況要重 build：沒 build 過、原始碼比產物新、產物裡的 API 位址不是這次的 port。
# 比對時字串結尾要帶引號（產物裡長這樣："http://127.0.0.1:8100"），
# 不然 port=810 會被 8100 的產物騙過去，當成不用重建。
need_build=0
if [ ! -f "$DIST_DIR/index.html" ]; then
    need_build=1
elif [ -n "$(find "$ROOT_DIR/client/src" "$ROOT_DIR/client/package.json" \
              -newer "$DIST_DIR/index.html" -print -quit 2>/dev/null)" ]; then
    need_build=1
elif ! grep -rq "127\.0\.0\.1:${PORT}\"" "$DIST_DIR/assets" 2>/dev/null; then
    need_build=1
fi

if [ "$need_build" = "1" ]; then
    echo "[1/2] 建置前端（輸出到 dist-e2e）..."
    (cd "$ROOT_DIR/client" && \
        VITE_API_URL="http://127.0.0.1:${PORT}" \
        VITE_WS_BASE_URL="ws://127.0.0.1:${PORT}" \
        npm run build -- --outDir dist-e2e >/dev/null)
else
    echo "[1/2] 前端沒改，沿用上次的 build"
fi

# 保險：確認 build 出來的東西真的指向這次要用的 port，
# 不對就直接停，不要讓測試連到別的後端還以為自己在測。
if ! grep -rq "127\.0\.0\.1:${PORT}\"" "$DIST_DIR/assets" 2>/dev/null; then
    echo "❌ 前端 build 產物裡找不到 127.0.0.1:${PORT}，build 可能失敗了。"
    echo "   刪掉 $DIST_DIR 重跑一次。"
    exit 1
fi

# ── 2. 跑測試（後端由各測試檔自己開關）──────────────────────────
# log 每次清空，失敗時看到的才是這一輪的東西
: > "$LOG_FILE"

echo "[2/2] 開始跑測試（每個測試檔會自己重開後端）"
echo ""
set +e
E2E_BASE_URL="http://127.0.0.1:${PORT}" \
E2E_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
E2E_DEMO_PASSWORD="$DEMO_PASSWORD" \
"$E2E_DIR/node_modules/.bin/playwright" test --config "$E2E_DIR/playwright.config.js" "$@"
TEST_EXIT=$?
set -e

echo ""
if [ "$TEST_EXIT" = "0" ]; then
    echo "✅ 測試全過"
else
    echo "❌ 測試有失敗。後端 log：$LOG_FILE"
    echo "   看詳細報告：npx --prefix tests/e2e playwright show-report tests/e2e/playwright-report"
fi

exit "$TEST_EXIT"
