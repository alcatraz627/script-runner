#!/usr/bin/env bash
# Deploy the currently running preview (or a specified data file) to Vercel
#
# Usage:
#   ./deploy-preview.sh                          # auto-detect from running preview server
#   ./deploy-preview.sh path/to/data.json        # explicit data file
#   ./deploy-preview.sh --prod                   # deploy to production
#   ./deploy-preview.sh path/to/data.json --prod

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_FILE=""
EXTRA_FLAGS=""

# Parse args
for arg in "$@"; do
  case "$arg" in
    --prod) EXTRA_FLAGS="$EXTRA_FLAGS --prod" ;;
    --no-deploy) EXTRA_FLAGS="$EXTRA_FLAGS --no-deploy" ;;
    --title) EXTRA_FLAGS="$EXTRA_FLAGS --title" ;;  # next arg picked up naturally
    *) if [ -z "$DATA_FILE" ] && [[ "$arg" != -* ]]; then DATA_FILE="$arg"; fi ;;
  esac
done

# Auto-detect data file from running preview server if not provided
if [ -z "$DATA_FILE" ]; then
  PID=$(lsof -ti :3457 -sTCP:LISTEN 2>/dev/null || lsof -ti :3458 -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$PID" ]; then
    DATA_FILE=$(ps -p "$PID" -o command= | grep -oE '\-\-data [^ ]+' | cut -d' ' -f2)
  fi

  if [ -z "$DATA_FILE" ]; then
    echo "Error: No data file specified and no preview server detected on :3457/:3458"
    echo "Usage: ./deploy-preview.sh [path/to/data.json] [--prod]"
    exit 1
  fi

  echo "  Auto-detected data file from running preview: $DATA_FILE"
fi

node "$SCRIPT_DIR/pipeline/deploy-preview.js" --data "$DATA_FILE" $EXTRA_FLAGS
