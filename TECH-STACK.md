# Tech Stack — Versable Pipeline Manager

## Runtime

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js   | 23.x    | CommonJS backend, ESM frontend |
| npm       | 11.x    | Package manager |

## Backend (Express API Server)

| Package | Version | Purpose |
|---------|---------|---------|
| Express | 5.x     | HTTP API server (port 3460) |
| Multer  | 2.x     | Multipart file upload handling |
| xlsx    | 0.18.x  | Excel/CSV/XLS read/write (SheetJS) |
| @anthropic-ai/sdk | 0.79.x | Claude API for LLM-powered transforms |
| @scalar/express-api-reference | 0.9.x | Interactive OpenAPI 3.1 API browser |

### Server Architecture

- **Entry point:** `server.js` (~1400 lines, single file)
- **Module system:** CommonJS (`require`/`module.exports`)
- **API style:** RESTful JSON + SSE for real-time events
- **Persistence:** File system only — no database
- **Concurrency:** In-memory job queue, max 2 concurrent pipeline executions
- **Event system:** Node.js `EventEmitter` for job events → SSE forwarding

## Frontend (SvelteKit Dashboard)

| Package | Version | Purpose |
|---------|---------|---------|
| SvelteKit | 2.x   | App framework with file-based routing |
| Svelte | 5.x      | UI framework (runes: `$state`, `$derived`, `$effect`) |
| Vite | 7.x        | Dev server and bundler |
| Tailwind CSS | 4.x | Utility-first styling with CSS custom properties |
| TypeScript | 5.x   | Type safety |

### Frontend Architecture

- **Port:** 5173 (Vite dev server), proxies API calls to :3460
- **Routing:** SvelteKit App Router — 9 pages across 5 route groups
- **State:** Svelte 5 runes (`$state`, `$derived`) — no external state library
- **Theming:** CSS custom properties (~30 vars) for light/dark mode
- **Components:** 12 reusable components (Button, Card, DataTable, PipelineFlow, etc.)
- **API client:** Typed fetch wrapper (`$lib/api.ts`)

## Pipeline Engine

- **Transforms:** JavaScript modules in `transforms/` directory
- **Data flow:** `raw.json → step1.json → step2.json → final.json`
- **Logging:** JSONL per-step log files in `runs/<id>/logs/`
- **Abort:** Cooperative cancellation via `AbortController` (checks between steps)
- **I/O:** Universal file handler supporting JSON, XLSX, XLS, CSV

## Development

```bash
# Start both servers (Express + Vite)
./start-dev.sh

# Frontend only
cd ui && npm run dev

# Type checking
cd ui && npm run check
```

## Key Directories

```
scripts/
├── server.js           # Express API (port 3460)
├── pipeline/           # Engine, job queue, manifest, I/O
├── transforms/         # Data processing functions
├── runs/               # Pipeline run data (file-system persistence)
├── ui/                 # SvelteKit frontend (port 5173)
│   └── src/
│       ├── lib/        # Components, API client, types, constants
│       └── routes/     # Pages: runs, files, transforms, docs, compare
├── parse-excel/        # Standalone Excel parsing utilities
└── _deploy/            # Deployment artifacts
```
