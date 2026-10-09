#!/usr/bin/env bash
# Database tests: load supabase/schema.sql (production schema as of its dump)
# into an empty Postgres, apply the migrations written after that dump, then
# run every supabase/tests/*.test.sql. Each test raises an exception on
# failure, which stops psql with a non-zero exit.
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
#
# The target database is dropped and recreated -- point it at a throwaway one.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to a throwaway Postgres (superuser)}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
db="naad_test"
# Last migration already contained in schema.sql; later ones are applied on top.
dumped_through="20261008_lock_ward_billing_ledger.sql"

psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists $db" -c "create database $db"
# Swap the database name in the URL (keeps user, password, host and port).
test_url="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.href)' "$DATABASE_URL" "$db")"
run() { psql "$test_url" -q -v ON_ERROR_STOP=1 -X "$@"; }

run -f "$here/bootstrap.sql"
run -f "$root/supabase/schema.sql"
for m in "$root"/supabase/migrations/*.sql; do
  if [[ "$(basename "$m")" > "$dumped_through" ]]; then
    echo "migration: $(basename "$m")"
    run -f "$m"
  fi
done

status=0
for t in "$here"/*.test.sql; do
  if run -f "$t"; then echo "ok   $(basename "$t")"; else echo "FAIL $(basename "$t")"; status=1; fi
done
exit $status
