#!/usr/bin/env bash
set -euo pipefail

# Offline by default: generates a repeatable drill plan from committed migrations.
# To execute against an explicitly disposable local Postgres database, set
# MAZZI_RESTORE_DRILL_EXECUTE=1 and DATABASE_URL. No remote endpoint is contacted.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/db/migrations"
BACKUP_DIR="${MAZZI_BACKUP_DIR:-$ROOT/.drill-backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$BACKUP_DIR/mazzi-schema-$STAMP.tar.gz"
MANIFEST="$BACKUP_DIR/mazzi-schema-$STAMP.sha256"

if [[ "${MAZZI_RESTORE_DRILL_EXECUTE:-0}" != "1" ]]; then
  printf 'offline restore drill plan\n'
  printf 'migration files: '
  find "$MIGRATIONS" -maxdepth 1 -type f -name '*.sql' ! -name '*.down.sql' -printf '%f\n' | sort
  printf 'restore sequence: extract backup, apply forward migrations with apps/server migrate, compare schema and migration ledger\n'
  printf 'to execute: MAZZI_RESTORE_DRILL_EXECUTE=1 DATABASE_URL=postgres://... %s\n' "$0"
  exit 0
fi

: "${DATABASE_URL:?DATABASE_URL must point to a disposable local Postgres database}"
case "$DATABASE_URL" in
  postgres://localhost/*|postgres://127.0.0.1/*|postgres://[::1]/*|postgresql://localhost/*|postgresql://127.0.0.1/*|postgresql://[::1]/*) ;;
  *) echo 'refusing non-local database URL' >&2; exit 2 ;;
esac
command -v pg_dump >/dev/null || { echo 'pg_dump is required' >&2; exit 2; }
command -v pg_restore >/dev/null || { echo 'pg_restore is required' >&2; exit 2; }
command -v createdb >/dev/null || { echo 'createdb is required' >&2; exit 2; }
command -v dropdb >/dev/null || { echo 'dropdb is required' >&2; exit 2; }

pg_dump --format=custom --schema-only --no-owner --no-privileges "$DATABASE_URL" --file "$ARCHIVE"
sha256sum "$ARCHIVE" > "$MANIFEST"
RESTORE_DB="mazzi_restore_drill_${STAMP//[^0-9]/}"
BASE_URL="${DATABASE_URL%/*}"
RESTORE_URL="$BASE_URL/$RESTORE_DB"
createdb "$RESTORE_URL"
cleanup() { dropdb --if-exists "$RESTORE_URL" >/dev/null 2>&1 || true; }
trap cleanup EXIT
pg_restore --schema-only --no-owner --no-privileges --dbname "$RESTORE_URL" "$ARCHIVE"
pg_dump --schema-only --no-owner --no-privileges "$RESTORE_URL" --file "$BACKUP_DIR/restored-$STAMP.sql"
sha256sum -c "$MANIFEST"
printf 'schema backup and isolated restore completed: %s\n' "$ARCHIVE"
