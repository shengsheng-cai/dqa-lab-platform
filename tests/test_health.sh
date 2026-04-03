#!/bin/bash
# 快速 sanity check：公開端點 + 需認證端點
# 用法：bash tests/test_health.sh
#   或：ADMIN_USER=myuser ADMIN_PASS=mypass bash tests/test_health.sh

BASE="${BASE_URL:-http://localhost:8000}"
USER="${ADMIN_USER:-admin}"
PASS_="${ADMIN_PASS:-admin2024}"
PASS=0; FAIL=0

check() {
  local desc="$1" url="$2" expect="$3" token="$4"
  local body status
  if [ -n "$token" ]; then
    status=$(curl -s -o /tmp/_body.json -w "%{http_code}" -H "X-User-Token: $token" "$url")
  else
    status=$(curl -s -o /tmp/_body.json -w "%{http_code}" "$url")
  fi
  body=$(cat /tmp/_body.json)
  if [ "$status" = "$expect" ]; then
    echo "  PASS  $desc  (HTTP $status)"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $desc  (HTTP $status，期望 $expect)"
    echo "        回應：$body"
    FAIL=$((FAIL+1))
  fi
}

echo "=== 公開端點 ==="
check "GET /health"     "$BASE/health"     200
check "GET /api/latest" "$BASE/api/latest" 200

echo ""
echo "=== 需認證端點 ==="
LOGIN_STATUS=$(curl -s -o /tmp/_login.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS_\"}")
if [ "$LOGIN_STATUS" != "200" ]; then
  echo "  FAIL  登入失敗（HTTP $LOGIN_STATUS），跳過需認證端點"
  FAIL=$((FAIL+1))
else
  TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/_login.json'))['token'])")
  check "GET /api/devices"              "$BASE/api/devices"              200 "$TOKEN"
  check "GET /api/devices/CH-01/history" "$BASE/api/devices/CH-01/history" 200 "$TOKEN"
  curl -s -o /dev/null -X POST "$BASE/api/auth/logout" -H "X-User-Token: $TOKEN"
fi

echo ""
echo "結果：${PASS} 通過 / ${FAIL} 失敗"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
