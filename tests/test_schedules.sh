#!/bin/bash
# 排程流程測試：甘特圖 → 列表 → 預覽 → 建立 → 刪除
# 用法：bash tests/test_schedules.sh
#   或：ADMIN_USER=myuser ADMIN_PASS=mypass bash tests/test_schedules.sh

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

# --- 登入取 token ---
STATUS=$(curl -s -o /tmp/_login.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS_\"}")
if [ "$STATUS" != "200" ]; then
  echo "  FAIL  登入失敗（HTTP $STATUS），中止測試"
  exit 1
fi
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/_login.json'))['token'])")
echo "=== Schedules 測試（user=$USER）==="

# --- 讀取端點 ---
check_status "GET /api/schedules/gantt" \
  "$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/schedules/gantt" -H "X-User-Token: $TOKEN")" \
  200

check_status "GET /api/schedules" \
  "$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/schedules" -H "X-User-Token: $TOKEN")" \
  200

# --- 取第一個有效 condition（從 standards-tree）---
COND=$(curl -s "$BASE/api/schedules/standards-tree" -H "X-User-Token: $TOKEN" \
  | python3 -c "
import json,sys
tree = json.load(sys.stdin)
# 結構：{標準: {versions: {版本: {tests: {key: {sop_id: ...}}}}}}
for std in tree.values():
    for ver in std.get('versions', {}).values():
        for test in ver.get('tests', {}).values():
            sop_id = test.get('sop_id')
            if sop_id:
                print(sop_id)
                sys.exit(0)
" 2>/dev/null)

if [ -n "$COND" ]; then
  check_status "GET /api/schedules/preview?conditions=$COND" \
    "$(curl -s -o /dev/null -w "%{http_code}" \
      "$BASE/api/schedules/preview?conditions=$COND" \
      -H "X-User-Token: $TOKEN")" \
    200
else
  echo "  SKIP  無法取得有效 condition，跳過 preview 測試"
fi

# --- 建立排程（使用 IEC60068-2-1 最常見條件，如無則 fallback 用任意 COND）---
CREATE_COND="${COND:-IEC60068-2-1_test_a}"
STATUS=$(curl -s -o /tmp/_sched.json -w "%{http_code}" \
  -X POST "$BASE/api/schedules" \
  -H "Content-Type: application/json" \
  -H "X-User-Token: $TOKEN" \
  -d "{
    \"project_number\": \"TEST-001\",
    \"sample_name\": \"Shell 測試樣品\",
    \"standard\": \"test\",
    \"conditions\": [\"$CREATE_COND\"],
    \"note\": \"由 test_schedules.sh 自動建立，請忽略\"
  }")

check_status "POST /api/schedules（建立）" "$STATUS" 200 || {
  echo "        回應：$(cat /tmp/_sched.json)"
}

SCHED_ID=$(python3 -c "import json; print(json.load(open('/tmp/_sched.json')).get('id',''))" 2>/dev/null)

# --- 刪除剛建立的排程 ---
if [ -n "$SCHED_ID" ] && [ "$SCHED_ID" != "None" ]; then
  check_status "DELETE /api/schedules/$SCHED_ID（刪除）" \
    "$(curl -s -o /dev/null -w "%{http_code}" \
      -X DELETE "$BASE/api/schedules/$SCHED_ID" \
      -H "X-User-Token: $TOKEN")" \
    200
else
  echo "  SKIP  未取得 schedule_id，跳過刪除測試"
fi

# --- 登出 ---
curl -s -o /dev/null -X POST "$BASE/api/auth/logout" -H "X-User-Token: $TOKEN"

echo ""
echo "結果：${PASS} 通過 / ${FAIL} 失敗"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
