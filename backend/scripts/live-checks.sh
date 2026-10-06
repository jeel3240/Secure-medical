#!/bin/bash
# Runs live checks, each on its own freshly migrated scratch database, and
# prints one line per check. From backend/, with the local postgres up:
#
#   scripts/live-checks.sh                    # all of them
#   scripts/live-checks.sh calls queue        # just these (names without -live-check)
#
# Never touches the `leads` database. docs/README.md, "How to test".
cd "$(dirname "$0")/.." || exit 1
PG=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
[ -z "$PG" ] && { echo "postgres is not running: docker compose up -d postgres"; exit 1; }

names=("$@")
[ ${#names[@]} -eq 0 ] && names=($(ls scripts/*-live-check.ts | xargs -n1 basename | sed 's/-live-check\.ts$//'))

failed=0
for name in "${names[@]}"; do
  sc="${name%-live-check}-live-check"
  db="lc_$(echo "$sc" | tr '-' '_')"
  docker exec "$PG" psql -U app -d postgres -qc "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null 2>&1
  url="postgres://app:app@localhost:5433/$db"
  DATABASE_URL=$url node scripts/migrate.js >/dev/null 2>&1
  out=$(DATABASE_URL=$url JWT_SECRET=x EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=weightloss EZT_SEND_GROUP=weightloss \
    npx ts-node --transpile-only "scripts/$sc.ts" 2>&1 | grep -v '^{')
  verdict=$(echo "$out" | grep -E 'passed|FAILED|Refusing' | tail -1)
  printf "%-28s %3s ok | %s\n" "$sc" "$(echo "$out" | grep -cE '^ *ok ')" "${verdict:-DID NOT FINISH}"
  echo "$out" | grep -E "FAIL |rror:|error:" | head -8
  echo "$verdict" | grep -q 'all checks passed' || failed=1
  docker exec "$PG" psql -U app -d postgres -qc "DROP DATABASE $db" >/dev/null 2>&1
done
exit $failed
