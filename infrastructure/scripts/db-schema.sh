#!/usr/bin/env sh
# Usage:
#   ./infrastructure/scripts/db-schema.sh dev   → activates SQLite schema
#   ./infrastructure/scripts/db-schema.sh prod  → activates PostgreSQL schema

set -e

PRISMA_DIR="packages/shared/prisma"

case "$1" in
  dev)
    cp "$PRISMA_DIR/schema.dev.prisma" "$PRISMA_DIR/schema.prisma"
    echo "✅ Active Prisma schema → SQLite (development)"
    ;;
  prod)
    cp "$PRISMA_DIR/schema.prod.prisma" "$PRISMA_DIR/schema.prisma"
    echo "✅ Active Prisma schema → PostgreSQL (production)"
    ;;
  *)
    echo "Usage: $0 [dev|prod]"
    exit 1
    ;;
esac
