#!/bin/bash
# 治具模組整合測試：列表 → 摘要 → 借出紀錄 → 建立 → 借出 → 歸還 → 刪除
# 用法：bash tests/test_fixtures.sh
#   或：ADMIN_USER=myuser ADMIN_PASS=mypass bash tests/test_fixtures.sh

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

# === 登入 ===
echo "=== 登入 ==="
STATUS=$(curl -s -o /tmp/_fix_login.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS_\"}")
check_status "POST /api/auth/login" "$STATUS" 200 || { echo "  後端未啟動或帳密錯誤，中止"; exit 1; }
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/_fix_login.json'))['token'])" 2>/dev/null)
echo "        token=${TOKEN:0:12}..."

# === 讀取端點（admin 可讀）===
echo ""
echo "=== 讀取端點 ==="

STATUS=$(curl -s -o /tmp/_fix_list.json -w "%{http_code}" \
  "$BASE/api/fixtures/" \
  -H "X-User-Token: $TOKEN")
check_status "GET /api/fixtures/" "$STATUS" 200

STATUS=$(curl -s -o /tmp/_fix_summary.json -w "%{http_code}" \
  "$BASE/api/fixtures/summary" \
  -H "X-User-Token: $TOKEN")
check_status "GET /api/fixtures/summary" "$STATUS" 200

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/api/fixtures/loans/active" \
  -H "X-User-Token: $TOKEN")
check_status "GET /api/fixtures/loans/active" "$STATUS" 200

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/api/fixtures/loans/overdue" \
  -H "X-User-Token: $TOKEN")
check_status "GET /api/fixtures/loans/overdue" "$STATUS" 200

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/api/fixtures/inventory-logs" \
  -H "X-User-Token: $TOKEN")
check_status "GET /api/fixtures/inventory-logs" "$STATUS" 200

# === 寫入：建立治具 ===
echo ""
echo "=== 寫入端點（admin）==="

STATUS=$(curl -s -o /tmp/_fix_create.json -w "%{http_code}" \
  -X POST "$BASE/api/fixtures/" \
  -H "Content-Type: application/json" \
  -H "X-User-Token: $TOKEN" \
  -d '{"name":"TEST-FIXTURE-SHELL","type":"cable","interface_type":"USB","quantity":1,"status":"available"}')
check_status "POST /api/fixtures/（建立）" "$STATUS" 200

FIXTURE_ID=$(python3 -c "import json; print(json.load(open('/tmp/_fix_create.json')).get('id',''))" 2>/dev/null)
echo "        fixture_id=$FIXTURE_ID"

# === 取單筆 ===
if [ -n "$FIXTURE_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$BASE/api/fixtures/$FIXTURE_ID" \
    -H "X-User-Token: $TOKEN")
  check_status "GET /api/fixtures/{id}" "$STATUS" 200

  # === 建立借出紀錄 ===
  TODAY=$(date +%Y-%m-%d)
  TOMORROW=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "+1 day" +%Y-%m-%d)
  STATUS=$(curl -s -o /tmp/_fix_loan.json -w "%{http_code}" \
    -X POST "$BASE/api/fixtures/loans" \
    -H "Content-Type: application/json" \
    -H "X-User-Token: $TOKEN" \
    -d "{\"fixture_id\":$FIXTURE_ID,\"borrower\":\"test-user\",\"loan_date\":\"$TODAY\",\"expected_return_date\":\"$TOMORROW\",\"purpose\":\"shell test\"}")
  check_status "POST /api/fixtures/loans（借出）" "$STATUS" 200

  LOAN_ID=$(python3 -c "import json; print(json.load(open('/tmp/_fix_loan.json')).get('id',''))" 2>/dev/null)
  echo "        loan_id=$LOAN_ID"

  # === 歸還 ===
  if [ -n "$LOAN_ID" ]; then
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "$BASE/api/fixtures/loans/$LOAN_ID/return" \
      -H "Content-Type: application/json" \
      -H "X-User-Token: $TOKEN" \
      -d '{"return_date":null,"condition":"good"}')
    check_status "POST /api/fixtures/loans/{id}/return（歸還）" "$STATUS" 200
  fi

  # === 清理：刪除測試治具 ===
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE "$BASE/api/fixtures/$FIXTURE_ID" \
    -H "X-User-Token: $TOKEN")
  check_status "DELETE /api/fixtures/{id}（清理）" "$STATUS" 200
fi

# === Guest 無法寫入 ===
echo ""
echo "=== 存取控制（無 token 不可寫）==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/fixtures/" \
  -H "Content-Type: application/json" \
  -d '{"name":"SHOULD-FAIL","type":"cable","interface_type":"USB","quantity":1,"status":"available"}')
if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  echo "  PASS  POST /api/fixtures/（無 token 應被拒絕）  (HTTP $STATUS)"
  PASS=$((PASS+1))
else
  echo "  FAIL  POST /api/fixtures/（無 token 應被拒絕但回 HTTP $STATUS）"
  FAIL=$((FAIL+1))
fi

echo ""
echo "結果：${PASS} 通過 / ${FAIL} 失敗"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
