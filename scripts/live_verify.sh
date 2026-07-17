#!/usr/bin/env bash
set -e
BASE="http://localhost:8787"
EMAIL="loki.bein.blodsson@gmail.com"
PW="Hjarta-Mi2023"

echo "== login =="
LOGIN=$(curl -s -X POST $BASE/api/v1/auth/login -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
echo "login ok? $(echo "$LOGIN" | grep -o '"ok":true' | head -1)  force_reset=$(echo "$LOGIN" | grep -o '"force_reset":[a-z]*' | head -1)"
TOK=$(echo "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
AUTH="authorization: Bearer $TOK"

echo "== /auth/me =="
ME=$(curl -s $BASE/api/v1/auth/me -H "$AUTH")
echo "me role=$(echo "$ME" | grep -o '"role":"[^"]*"' | head -1)"

echo "== seed (first run) =="
SEED=$(curl -s -X POST $BASE/api/v1/data/seed -H "$AUTH")
echo "seed seeded=$(echo "$SEED" | grep -o '"seeded":[0-9]*' | head -1) skipped=$(echo "$SEED" | grep -o '"skipped":[a-z]*' | head -1)"

echo "== card list count =="
CARDS=$(curl -s "$BASE/api/v1/board/cards" -H "$AUTH")
echo "card count=$(echo "$CARDS" | grep -o '"id":"card_[a-z0-9]*"' | wc -l)"

echo "== pick first card id + patch extended fields =="
CID=$(echo "$CARDS" | sed -n 's/.*"id":"\(card_[a-z0-9]*\)".*/\1/p' | head -1)
echo "first card: $CID"
PATCH=$(curl -s -X PATCH $BASE/api/v1/board/cards/$CID -H 'content-type: application/json' -H "$AUTH" -d '{"draft":"working draft","platform_ready":true,"platforms":["Instagram","Newsletter"],"content_pillar":"EFT / EFCT"}')
echo "patch platform_ready=$(echo "$PATCH" | grep -o '"platform_ready":[a-z]*' | head -1) pillar=$(echo "$PATCH" | grep -o '"content_pillar":"[^"]*"' | head -1)"

echo "== docs live =="
DOC=$(curl -s $BASE/api/v1/docs -H "$AUTH")
echo "docs columns=$(echo "$DOC" | grep -o '"name":"[A-Za-z ]*"' | head -5 | tr '\n' ' ')"

echo "== backup =="
BK=$(curl -s $BASE/api/v1/data/backup -H "$AUTH")
echo "backup has checksum=$(echo "$BK" | grep -o '"checksum":"[0-9a-f]*"' | head -1 | cut -c1-20) card_count=$(echo "$BK" | grep -o '"card_count":[0-9]*' | head -1)"

echo "== ALL CHECKS DONE =="
