#!/usr/bin/env bash
# Dumps the local SQLite DB and pushes it to your Turso database.
#
# Prerequisites:
#   1. Install Turso CLI:  curl -sSfL https://get.tur.so/install.sh | bash
#   2. Login:              turso auth login
#   3. Create a DB:        turso db create desi-deals-24
#   4. Copy the URL+token into .env.local (or Vercel env vars)
#
# Usage:
#   chmod +x scripts/dump-to-turso.sh
#   ./scripts/dump-to-turso.sh desi-deals-24
#
# The script will dump your local SQLite to /tmp/desiDeals24_dump.sql
# then pipe it into your Turso DB.

set -e

DB_NAME="${1:-desi-deals-24}"
DB_FILE="./data/desiDeals24.db"
DUMP_FILE="/tmp/desiDeals24_dump.sql"

if [ ! -f "$DB_FILE" ]; then
  echo "Error: $DB_FILE not found."
  exit 1
fi

echo "→ Dumping $DB_FILE to $DUMP_FILE ..."
sqlite3 "$DB_FILE" .dump > "$DUMP_FILE"

echo "→ Pushing dump to Turso DB: $DB_NAME ..."
turso db shell "$DB_NAME" < "$DUMP_FILE"

echo "✓ Done! Your Turso DB '$DB_NAME' is now populated."
echo ""
echo "Next: get your connection details:"
echo "  turso db show $DB_NAME --url"
echo "  turso db tokens create $DB_NAME"
echo ""
echo "Add them to .env.local:"
echo "  TURSO_DATABASE_URL=libsql://..."
echo "  TURSO_AUTH_TOKEN=..."
echo ""
echo "And add the same vars to your Vercel project environment settings."
