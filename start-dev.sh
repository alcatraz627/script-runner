#!/usr/bin/env bash
# start-dev.sh — Start both Express API and Vite SvelteKit dev servers
# Usage: ./start-dev.sh
# Express API: http://localhost:5033
# Vite UI:     http://localhost:3033

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo -e "\n\033[33mShutting down servers...\033[0m"
  kill $API_PID $UI_PID 2>/dev/null
  wait $API_PID $UI_PID 2>/dev/null
  echo "Done."
  exit 0
}

trap cleanup SIGINT SIGTERM

# Start Express API server
node "$SCRIPT_DIR/server.js" 2>&1 | sed "s/^/\x1b[36m[API]\x1b[0m /" &
API_PID=$!

# Start Vite dev server
cd "$SCRIPT_DIR/ui" && npm run dev 2>&1 | sed "s/^/\x1b[35m[UI]\x1b[0m /" &
UI_PID=$!

echo -e "\033[32m✓ Express API starting on :5033\033[0m"
echo -e "\033[32m✓ Vite UI starting on :3033\033[0m"
echo -e "\033[33mPress Ctrl+C to stop both servers\033[0m"

wait
