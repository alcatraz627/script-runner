# System Design: Versable Scripts — Pipeline Management Platform

## Overview

A local-first data pipeline platform for processing JEGS eBay product listings. Ingests raw Excel/CSV exports, runs them through configurable transform chains (normalization, LLM-powered cleaning, image generation), and produces final output files. Includes a SvelteKit dashboard for managing runs, viewing data, and monitoring execution in real time.

**Stack:** Node.js (CommonJS) + Express 5 backend, SvelteKit 5 frontend (Svelte 5 runes), file-system-based persistence (no database).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        SvelteKit UI                          │
│              (Svelte 5 + Tailwind, port 5173)                │
│                                                              │
│  /runs          Run list + status overview                   │
│  /runs/[id]     Run detail: execute, monitor SSE, view data  │
│  /runs/new      Create new run                               │
│  /runs/compare  Side-by-side run diffs                       │
│  /files         File browser across all runs                 │
│  /transforms    Transform catalog + source viewer            │
│  /docs          Embedded markdown documentation              │
│                                                              │
│  lib/api.ts     Typed fetch wrapper for all endpoints        │
│  lib/types.ts   Shared TypeScript interfaces                 │
└──────────────────┬───────────────────────────────────────────┘
                   │ HTTP (JSON) + SSE
                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    Express API Server                         │
│                     (port 3460)                               │
│                                                              │
│  /api/runs/*          CRUD + execute + SSE events            │
│  /api/transforms/*    List, read source, get defaults        │
│  /api/files/*         Upload, preview, symlink               │
│  /api/jobs/*          Job queue status + cancel              │
│  /api/docs/*          Serve markdown docs                    │
│  /api/schema          Endpoint metadata                      │
│  /api/openapi.json    Generated OpenAPI 3.1 spec             │
│  /api/docs            Scalar interactive API browser         │
│                                                              │
│  Also serves production UI build as SPA fallback             │
└──────────────────┬───────────────────────────────────────────┘
                   │
          ┌────────┴─────────┐
          ▼                  ▼
┌──────────────────┐  ┌──────────────────────────────────────┐
│   Job Queue      │  │         File System (runs/)           │
│ (in-process,     │  │                                      │
│  EventEmitter)   │  │  runs/<run-id>/                      │
│                  │  │    run.config.js    ← pipeline def    │
│  Max concurrency │  │    run.manifest.json ← execution state│
│  = 2             │  │    raw/             ← input files     │
│                  │  │    data/            ← step outputs    │
│  Buffers events  │  │      raw.json      (imported input)   │
│  in job.events[] │  │      <step-id>.json (each step)       │
│                  │  │      final.json    (last step alias)   │
│  Supports abort  │  │    logs/           ← JSONL event logs │
│  via AbortSignal │  │    output/         ← final xlsx/csv   │
└──────────────────┘  │    posters/        ← generated images │
                      └──────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│                   Pipeline Engine                             │
│               (pipeline/engine.js)                            │
│                                                              │
│  1. Import raw input file → data/raw.json                    │
│  2. For each step in config.steps[]:                         │
│     a. Load previous step output (or raw.json)               │
│     b. Apply optional columnMap                              │
│     c. Load & execute transforms/<fn>.js                     │
│     d. Save output → data/<step-id>.json                     │
│     e. Update manifest, persist JSONL log                    │
│  3. Copy last step → data/final.json                         │
│  4. Write output xlsx if configured                          │
│                                                              │
│  Events: import, step-start, step-progress,                  │
│          step-complete, step-error, interrupted, done         │
└──────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│                     Transforms                                │
│                (transforms/*.js)                              │
│                                                              │
│  jegs-normalize.js          Raw → standard schema            │
│  jegs-export-normalize.js   Newer export format → standard   │
│  split-description-features.js  Split desc+features column   │
│  clean-attributes.js        LLM-powered spec cleaning        │
│  data-corrections.js        Manual per-SKU patches           │
│  download-posters.js        Generate poster PNGs via API     │
│                                                              │
│  Contract: async (rows, config, context) => rows             │
│  May export SYSTEM_PROMPT for agent mode                     │
│  May export helper functions for reuse                       │
└──────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Run Configuration (`run.config.js`)

```js
module.exports = {
  name: 'Jegs ebay Mar 20 | 01',
  description: '',
  input: {
    file: './raw/JEGS_eBay_Mar19_export.xlsx',
    sheet: 'JEGS eBay Mar 15',
  },
  steps: [
    { id: 'normalize', fn: 'jegs-normalize', config: { brand: 'JEGS' } },
    { id: 'clean-attrs', fn: 'clean-attributes', config: { mode: 'sdk', batchSize: 20 } },
    { id: 'posters', fn: 'download-posters', config: { apiUrl: 'http://localhost:3006/...' } },
  ],
  output: './output/final.xlsx',
};
```

### Run Manifest (`run.manifest.json`)

Sidecar file tracking execution state. Bootstrapped from config on first access, updated in-place during execution.

**Statuses:**
- Run: `draft | running | completed | partial | error | interrupted`
- Step: `pending | running | completed | error | skipped | interrupted`

Steps are marked `stale: true` when upstream config or input changes (cascade propagation).

### Standard Row Schema (between transforms)

```json
{
  "Part Number": "555-11140",
  "Part Type": "Headlight Switch",
  "Description": "...",
  "Title": "JEGS ...",
  "Attributes Small": [["Color", "Black"], ...],
  "Attributes Full": [["Color", "Black"], ["Material", "Steel"], ...],
  "Features & Benefits": ["Feature 1", "Feature 2"],
  "Images": "https://i.ebayimg.com/...",
  "Brand": "JEGS"
}
```

---

## Key Subsystems

### 1. Job Queue (`pipeline/job-queue.js`)

- In-process singleton extending `EventEmitter`
- Max 2 concurrent jobs
- Each job gets an `AbortController` for cancellation
- All events buffered in `job.events[]` for replay (used by SSE and active-job API)
- Jobs are never persisted to disk; they exist only while the server process is alive

### 2. SSE Real-Time Events (`server.js` lines 311-340)

- `GET /api/runs/:id/events` opens an SSE connection
- Server registers an EventEmitter listener scoped to the run ID
- Events forwarded as `data: {json}\n\n`
- Connection closed after `done` or `step-error` events
- **Known issue:** Race condition where early events are lost before SSE connects. Fix documented in `sse-event-race-condition.md`.

### 3. Manifest Manager (`pipeline/manifest.js`)

- `getOrCreate(runDir)`: Reads existing manifest or bootstraps from config + data file timestamps
- `updateStep(manifest, stepId, fields)`: Partial-update a step's metadata
- `markStepStale(manifest, stepId)`: Marks step and all downstream steps stale
- `save(manifest, runDir)`: Writes manifest JSON to disk

### 4. IO Layer (`pipeline/io.js`)

- Universal read/write for JSON, XLSX, XLS, CSV
- Uses `xlsx` library for spreadsheet support
- Supports `--limit`, `--slice`, `--sheet` options
- Handles NaN values in JSON gracefully
- Also usable as CLI: `node pipeline/io.js --from <file> --to <file>`

### 5. Agent-Slice Mode

For LLM transforms too large for a single API call:
1. `run.js --step <id> --agent-slices N` splits input into N files in `/tmp/`
2. Exports the transform's `SYSTEM_PROMPT` to a text file
3. N Claude sub-agents process slices in parallel
4. `merge-slices.js` recombines results by matching on Part Number

### 6. Preview Dashboard (`preview-dashboard/`)

Static HTML dashboard for reviewing pipeline output data. Auto-maps any JSON row schema to a standard display format. Used in two contexts:
- `pipeline/preview.js`: local HTTP server for on-the-fly preview
- `pipeline/deploy-preview.js`: bakes data into static files and deploys to Vercel

---

## Frontend Architecture

### Framework

SvelteKit 5 with Svelte 5 runes (`$state`, `$derived`, `$effect`). Single-page app with client-side routing. During development, Vite serves on port 5173 with proxy to the Express API on port 3460.

### Key Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard home |
| `/runs` | List all runs with status badges |
| `/runs/new` | Create a new run |
| `/runs/[id]` | Run detail: config editing, execute, SSE log, step data tables |
| `/runs/compare` | Side-by-side run comparison |
| `/files` | Browse uploaded files across all runs |
| `/transforms` | List transforms with descriptions, view/edit source |
| `/docs` | Embedded markdown documentation viewer |

### Component Library

- `StatusBadge.svelte` — Status chip with color coding
- `DataTable.svelte` — Paginated data viewer with column headers
- `PipelineFlow.svelte` — Visual step flow diagram
- `RunConfig.svelte` — Config editor panel
- `Breadcrumb.svelte` — Navigation breadcrumbs
- `ThemeToggle.svelte` — Dark/light mode switch
- `ToastContainer.svelte` — Toast notification system

### State Management

- Local component state via Svelte 5 runes (`$state`, `$derived`)
- Global toast notifications via `stores/toast.svelte.ts`
- Theme preference via CSS custom properties + localStorage
- No global stores for run data; each page fetches its own data

### Build & Deploy

- `npm run build` in `ui/` produces static SPA in `ui/build/`
- Express serves the built UI via `express.static` with SPA fallback
- `start-dev.sh` runs both Express API and Vite dev server concurrently

---

## API Design

RESTful JSON API with ~30 endpoints organized into 6 groups:

| Group | Endpoints | Purpose |
|-------|-----------|---------|
| **Runs** | CRUD + fork | Manage pipeline run instances |
| **Config** | GET/PATCH | Read and update `run.config.js` |
| **Execution** | POST execute, GET events, GET active-job | Start pipelines, SSE monitoring |
| **Data** | GET paginated, GET download, POST open | Access step output data |
| **Files** | POST upload, GET list, POST link, GET preview | Manage input files |
| **Transforms** | GET list/source/helpers/defaults, PUT source | Browse and edit transforms |

Full interactive docs available at `GET /api/docs` (Scalar) and machine-readable spec at `GET /api/openapi.json`.

---

## Persistence Model

All state lives on the file system. No database.

```
scripts/
├── runs/                          # One directory per run
│   └── <run-id>/
│       ├── run.config.js          # Pipeline definition (source of truth)
│       ├── run.manifest.json      # Execution state (derived, can be rebuilt)
│       ├── raw/                   # Input files (uploaded or symlinked)
│       ├── data/                  # JSON outputs (raw.json, <step-id>.json, final.json)
│       ├── logs/                  # JSONL event logs per step
│       ├── output/                # Final xlsx/csv exports
│       └── posters/               # Generated poster images
├── transforms/                    # Reusable transform functions
└── server.js                      # API server entry point
```

**Startup recovery:** On boot, the server scans all runs for `status: 'running'` and resets them to `interrupted`, preventing stale running-state from previous crashes.

---

## Security & Operational Notes

- **Local-only:** No authentication. Designed to run on a developer's machine.
- **File system trust:** `run.config.js` is loaded via `require()` — it can execute arbitrary code. This is intentional for developer flexibility.
- **No persistence of secrets:** `ANTHROPIC_API_KEY` read from `.env` at runtime, never stored in config or manifests.
- **Symlink support:** Files can be shared across runs via symlinks, avoiding data duplication.
- **macOS integration:** `POST /api/runs/:id/data/:fileId/open` calls `open` to launch files in the default macOS application.

---

## Known Issues

1. **SSE Event Race Condition** — Early pipeline events lost before SSE connects. Fix documented in `sse-event-race-condition.md`.
2. **eBay Poster Download Hanging** — `download-posters.js` timeouts when sending real product payloads to the Next.js `ImageResponse` endpoint. Server completes generation but response never reaches client. See session memory for investigation details.
3. **Job memory growth** — Completed jobs remain in the in-memory job map indefinitely. Long-running servers will accumulate job entries.
