#!/bin/bash
# 認證流程測試：登入 → me → 登出
# 用法：bash tests/test_auth.sh
#   或：ADMIN_USER=myuser ADMIN_PASS=mypass bash tests/test_auth.sh

BASE="${BASE_URL:-http://localhost:8000}"
USER="${ADMIN_USER:-admin}"
PASS_="${ADMIN_PASS:-admin2024}"
PASS=0; FAIL=0

check_status() {
  local desc="$1" actual="$2" expect="$3"
  if [ "$actual" = "$expect" ]; then
    echo "  PASS  $desc  (HTTP $actual)"
    PASS=$((PASS+1))
    return 0
  else
    echo "  FAIL  $desc  (HTTP $actual，期望 $expect)"
    FAIL=$((FAIL+1))
    return 1
  fi
}

echo "=== Auth 流程 ==="

# 1. 登入
STATUS=$(curl -s -o /tmp/_login.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS_\"}")

check_status "POST /api/auth/login" "$STATUS" 200 || { echo "  帳號密碼錯誤或後端未啟動，中止測試"; exit 1; }

TOKEN=$(python3 -c "import json,sys; print(json.load(open('/tmp/_login.json'))['token'])" 2>/dev/null)
ROLE=$(python3 -c "import json,sys; print(json.load(open('/tmp/_login.json'))['role'])" 2>/dev/null)
echo "        token=${TOKEN:0:12}...  role=$ROLE"

# 2. /me
STATUS=$(curl -s -o /tmp/_me.json -w "%{http_code}" \
  "$BASE/api/auth/me" \
  -H "X-User-Token: $TOKEN")
check_status "GET /api/auth/me" "$STATUS" 200

# 3. 無 token 應拒絕 /me（guest 沒有 /me 或回 401/403）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/auth/me")
if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  echo "  PASS  GET /api/auth/me（無 token）應被拒絕  (HTTP $STATUS)"
  PASS=$((PASS+1))
else
  echo "  FAIL  GET /api/auth/me（無 token）應被拒絕但回 HTTP $STATUS"
  FAIL=$((FAIL+1))
fi

# 4. 登出
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/auth/logout" \
  -H "X-User-Token: $TOKEN")
check_status "POST /api/auth/logout" "$STATUS" 200

# 5. 登出後 token 應失效
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/api/auth/me" \
  -H "X-User-Token: $TOKEN")
if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  echo "  PASS  登出後 token 失效  (HTTP $STATUS)"
  PASS=$((PASS+1))
else
  echo "  FAIL  登出後 token 應失效但回 HTTP $STATUS"
  FAIL=$((FAIL+1))
fi

echo ""
echo "結果：${PASS} 通過 / ${FAIL} 失敗"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
