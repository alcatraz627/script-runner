# SSE Event Race Condition — Missed Download Progress Events

## Issue

When running the `download-posters` step (or any long-running step) via the UI, the
Execution Log displays item progress starting from an arbitrary index instead of `[1/N]`.
Events emitted during the first few seconds of execution are silently dropped.

## Root Cause

There is a **late-subscriber race condition** between job start and SSE connection.

### Event flow (current)

```
Client                              Server
  │                                   │
  ├─ POST /api/runs/:id/execute ────► │ queue.enqueue() → _tryStart() → _run()
  │                                   │   ↳ job begins, events start emitting
  │ ◄─── { jobId } ──────────────────┤
  │                                   │   ... events [1/606], [2/606], ... firing
  ├─ GET  /api/runs/:id (manifest) ──►│
  │ ◄─── manifest ────────────────────┤
  │                                   │   ... events [8/606], [9/606], ... still firing
  ├─ GET  /api/runs/:id/events (SSE)─►│ queue.on('event', handler)
  │                                   │   ↳ handler registered NOW
  │ ◄─── [10/606] ───────────────────┤   events 1–9 were never sent to this client
  │ ◄─── [11/606] ───────────────────┤
```

### Why events are lost

1. **`executeRun()` in `+page.svelte:202-221`** awaits two network round-trips
   (`api.runs.execute` + `fetchManifest`) before calling `connectSSE()`.

2. **The job starts immediately** inside `queue.enqueue()` → `_tryStart()` → `_run()`
   (`job-queue.js:100-110`). The engine begins processing rows and emitting events
   right away.

3. **The SSE endpoint (`server.js:311-340`)** only registers a listener on the job
   queue's EventEmitter at connection time. It has no replay mechanism — events emitted
   before the listener exists are gone.

4. **The same gap exists in `reconnectToActiveJob()` (`+page.svelte:175-200`)**.
   Past events are fetched via an API call, then SSE connects separately. Events
   emitted between those two calls are missed.

### Affected files

| File | Role |
|------|------|
| `ui/src/routes/runs/[id]/+page.svelte` | Client — `executeRun()`, `reconnectToActiveJob()`, `connectSSE()` |
| `server.js` (lines 311-340) | Server — SSE endpoint `/api/runs/:id/events` |
| `pipeline/job-queue.js` | Job queue — `_run()` emits events, `job.events[]` buffers them |

## Fix

The events are already buffered server-side in `job.events[]` (`job-queue.js:59,119`).
The fix is to **replay that buffer when SSE connects**, then stream live events.

### 1. Server: replay buffered events on SSE connect (`server.js`)

```js
// GET /api/runs/:id/events — SSE stream
app.get('/api/runs/:id/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  const runId = req.params.id;

  // ── NEW: replay past events from the job buffer ──
  const activeJob = queue.listJobs().find(j =>
    path.basename(j.runDir) === runId &&
    (j.status === 'running' || j.status === 'queued')
  );
  if (activeJob) {
    for (const event of activeJob.events) {
      res.write(`data: ${JSON.stringify({ jobId: activeJob.jobId, ...event })}\n\n`);
    }
  }
  // ── END NEW ──

  const handler = ({ jobId, runDir, event }) => {
    if (path.basename(runDir) === runId) {
      res.write(`data: ${JSON.stringify({ jobId, ...event })}\n\n`);

      if (event.type === 'done' || event.type === 'step-error') {
        setTimeout(() => {
          res.write('data: {"type":"stream-end"}\n\n');
          res.end();
        }, 500);
      }
    }
  };

  queue.on('event', handler);

  req.on('close', () => {
    queue.removeListener('event', handler);
  });
});
```

Node.js is single-threaded, so no events can fire during the synchronous replay loop.
This guarantees no gaps or duplicates between the replay and the live listener.

### 2. Client: connect SSE immediately after POST (`+page.svelte`)

In `executeRun()`, remove the blocking `await fetchManifest()` before `connectSSE()`:

```js
async function executeRun(opts) {
  if (executing) return;
  executing = true;
  executeError = null;
  events = [];

  try {
    const result = await api.runs.execute(runId, opts);
    jobId = result.jobId;

    connectSSE();        // connect immediately — SSE replays missed events
    fetchManifest();     // fire-and-forget refresh (no await)
  } catch (e) {
    executeError = e instanceof Error ? e.message : 'Failed to start execution';
    executing = false;
  }
}
```

### 3. Client: simplify `reconnectToActiveJob()` (`+page.svelte`)

Since SSE now replays buffered events, the manual replay via `api.runs.activeJob` is
redundant:

```js
async function reconnectToActiveJob() {
  try {
    const result = await api.runs.activeJob(runId);
    if (!result.active) {
      await fetchManifest();
      return;
    }

    jobId = result.jobId ?? null;
    executing = true;
    connectSSE();    // SSE replays all past events — no manual replay needed
  } catch {
    await fetchManifest();
  }
}
```

## Verification

1. Start a `download-posters` run from the UI
2. Execution Log should show events starting from `[1/N]`
3. Refresh the page mid-run — events should replay from `[1/N]` and continue live
4. No duplicate events should appear in the log
