# Scripts Project Instructions

## Build Tag

After making any UI change, update `APP.buildTag` in `ui/src/lib/constants/app.ts` to a new random phrase (format: `word-word-number`, e.g. `maple-fox-7`). Print the new tag in your response so the user can verify the browser matches. Do not change the tag if no UI files were modified.

## Pending Fix: SSE Event Race Condition

There is a documented race condition where early pipeline execution events are lost because SSE connects after the job has already started emitting. See `sse-event-race-condition.md` in the project root for the full writeup and implementation plan. The fix involves three changes:

1. **`server.js`** (SSE endpoint) — replay `job.events[]` buffer when SSE connects
2. **`ui/src/routes/runs/[id]/+page.svelte`** `executeRun()` — call `connectSSE()` immediately after POST, don't await `fetchManifest()` first
3. **`ui/src/routes/runs/[id]/+page.svelte`** `reconnectToActiveJob()` — remove manual event replay, let SSE handle it
