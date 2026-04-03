#!/usr/bin/env bash
# 測試報告下載端點（CSV + PDF）
BASE=http://localhost:8000

echo '=== 登入 ==='
LOGIN=$(curl -s -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin2024"}')
TOKEN=$(echo "$LOGIN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("token",""))' 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo 'warn: TOKEN empty, trying without auth'
fi

echo '=== 執行紀錄清單 ==='
LIST=$(curl -s $BASE/api/reports/list -H "X-User-Token: $TOKEN")
COUNT=$(echo "$LIST" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
echo "共 $COUNT 筆執行紀錄"

if [ "$COUNT" -gt 0 ]; then
  EXEC_ID=$(echo "$LIST" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])' 2>/dev/null || echo 1)

  echo ''
  echo "=== CSV 報告 (ID=$EXEC_ID) ==="
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "X-User-Token: $TOKEN" $BASE/api/reports/csv/$EXEC_ID)
  [ "$STATUS" = '200' ] && echo "ok CSV HTTP $STATUS" || echo "fail CSV HTTP $STATUS"

  echo ''
  echo "=== PDF 報告 (ID=$EXEC_ID) ==="
  STATUS=$(curl -s -o /tmp/test_report.pdf -w '%{http_code}' \
    -H "X-User-Token: $TOKEN" $BASE/api/reports/pdf/$EXEC_ID)
  if [ "$STATUS" = '200' ]; then
    SIZE=$(wc -c < /tmp/test_report.pdf | tr -d ' ')
    echo "ok PDF HTTP $STATUS size=${SIZE}bytes"
  else
    echo "fail PDF HTTP $STATUS"
    head -c 300 /tmp/test_report.pdf
  fi
else
  echo '(no execution records, skipping download tests)'
fi

echo ''
echo '=== 404 test ==='
S=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-User-Token: $TOKEN" $BASE/api/reports/pdf/99999)
[ "$S" = '404' ] && echo 'ok PDF 404' || echo "fail expected 404 got $S"

echo ''
echo 'done'
