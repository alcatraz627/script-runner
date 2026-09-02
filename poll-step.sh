#!/usr/bin/env bash
# =============================================================================
# poll-step.sh — Poll a pipeline step until it reaches a terminal state
#
# Usage:
#   bash poll-step.sh <run-id> <step-id> [interval-seconds]
#
# Arguments:
#   run-id           The pipeline run ID (e.g. jegs-ebay-final-mar25)
#   step-id          The step ID to watch (e.g. download-posters)
#   interval-seconds How often to poll in seconds. Default: 10
#
# Examples:
#   bash poll-step.sh jegs-ebay-final-mar25 download-posters
#   bash poll-step.sh jegs-ebay-final-mar25 enhance-content 30
#
# Terminal states that stop the loop: completed, error, interrupted
#
# Output: timestamped lines showing step status + latest log message.
#         Exits 0 on completed, 1 on error/interrupted.
# =============================================================================

set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────

RUN_ID="${1:-}"
STEP_ID="${2:-}"
INTERVAL="${3:-10}"   # default poll interval in seconds

if [[ -z "$RUN_ID" || -z "$STEP_ID" ]]; then
  echo "Usage: bash poll-step.sh <run-id> <step-id> [interval-seconds]"
  echo "  e.g. bash poll-step.sh jegs-ebay-final-mar25 download-posters 30"
  exit 1
fi

# ── Config ────────────────────────────────────────────────────────────────────

# Server base URL — override with PIPELINE_SERVER env var if needed
SERVER="${PIPELINE_SERVER:-http://localhost:3460}"

# Path to the run's logs directory (relative to this script's location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/runs/$RUN_ID/logs/$STEP_ID.jsonl"

# ── Helper: get current step status from manifest API ────────────────────────
get_status() {
  # Call the run manifest API and extract the status for our step.
  # Uses python3 for JSON parsing (no jq dependency required).
  curl -sf "$SERVER/api/runs/$RUN_ID" 2>/dev/null \
    | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    steps = data.get('steps', [])
    match = next((s for s in steps if s['id'] == '$STEP_ID'), None)
    print(match['status'] if match else 'unknown')
except Exception as e:
    print('unknown')
" 2>/dev/null || echo "unknown"
}

# ── Helper: get the last meaningful log message for the step ──────────────────
get_last_message() {
  # Read the last 3 lines of the JSONL log and extract the most recent message.
  # Falls back to empty string if the log doesn't exist yet.
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "(log not yet available)"
    return
  fi
  tail -3 "$LOG_FILE" 2>/dev/null \
    | python3 -c "
import sys, json
msg = ''
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
        if obj.get('message'):
            msg = obj['message']
    except:
        pass
print(msg)
" 2>/dev/null || echo ""
}

# ── Main polling loop ─────────────────────────────────────────────────────────

echo "Polling $RUN_ID / $STEP_ID every ${INTERVAL}s  (server: $SERVER)"
echo "Log: $LOG_FILE"
echo "──────────────────────────────────────────────────────────────"

FINAL_STATUS=""

while true; do
  STATUS=$(get_status)
  MSG=$(get_last_message)
  TIMESTAMP=$(date +%H:%M:%S)

  # Print a timestamped status line
  echo "$TIMESTAMP | status=$STATUS | $MSG"

  # Check for terminal states
  case "$STATUS" in
    completed)
      echo "──────────────────────────────────────────────────────────────"
      echo "✓ Step '$STEP_ID' completed successfully."
      FINAL_STATUS="completed"
      break
      ;;
    error)
      echo "──────────────────────────────────────────────────────────────"
      echo "✗ Step '$STEP_ID' failed with error."
      FINAL_STATUS="error"
      break
      ;;
    interrupted)
      echo "──────────────────────────────────────────────────────────────"
      echo "⚠ Step '$STEP_ID' was interrupted."
      FINAL_STATUS="interrupted"
      break
      ;;
  esac

  # Wait before next poll
  sleep "$INTERVAL"
done

# ── Exit code ─────────────────────────────────────────────────────────────────
# Exit 0 only on clean completion; non-zero for error/interrupted
if [[ "$FINAL_STATUS" == "completed" ]]; then
  exit 0
else
  exit 1
fi
