#!/usr/bin/env bash
set -e
BASE="http://localhost:8787"
EMAIL="loki.bein.blodsson@gmail.com"
PW="Hjarta-Mi2023"
LOGIN=$(curl -s -X POST $BASE/api/v1/auth/login -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
TOK=$(echo "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
AUTH="authorization: Bearer $TOK"

echo "== firing 40 rapid admin-panel-style requests (mix of endpoints) =="
CODES=""
for i in $(seq 1 40); do
  case $((i % 6)) in
    0) EP="/api/v1/board/columns";;
    1) EP="/api/v1/board/categories";;
    2) EP="/api/v1/board/cards";;
    3) EP="/api/v1/admin/users";;
    4) EP="/api/v1/admin/audit?limit=20";;
    *) EP="/api/v1/docs";;
  esac
  C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$EP" -H "$AUTH")
  CODES="$CODES $C"
done
echo "status codes:$CODES"
echo "429 count: $(echo $CODES | grep -o 429 | wc -l)"

echo "== also test a burst of 15 unauthenticated /api/health (shared api:unknown bucket) =="
HC=""
for i in $(seq 1 15); do
  C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health")
  HC="$HC $C"
done
echo "health codes:$HC"
echo "health 429 count: $(echo $HC | grep -o 429 | wc -l)"
