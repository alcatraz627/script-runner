# Versable Pipeline Manager — Changelog

## [Unreleased]

### Session 2026-03-20

**Quick Wins**
- Fixed fork symlink chaining — `readlinkSync` → `realpathSync` in server.js fork copy, preventing broken symlink chains when forking runs with linked files
- Removed step numbering below Pipeline Flow nodes (cleaner visual)
- Download script item index prefix already present (`[n/total]` format) — no change needed

**UI Polish**
- Fixed transforms helper expansion overflow — added `overflow-hidden min-w-0` to card container
- Fixed files preview table horizontal scroll — constrained `<td>` width with `max-w-0` wrapper
- Enhanced StatusBadge — dot indicators, dark mode support, emerald/blue/amber/red color palette
- Improved Fork dialog — icon header, radio-button step selector instead of dropdown, slide-up animation, loading spinner
- Improved Delete dialog — backdrop blur, slide-up animation
- Global cursor CSS — all buttons, links, selects, labels now have `cursor-pointer`; disabled buttons get `cursor-not-allowed`
- Added CSS animations: `shimmer`, `fade-in`, `slide-up`, `progress-pulse`
- Animated progress bars — gradient shimmer on running steps (PipelineFlow + runs list)
- Pipeline step nodes show animated shimmer bar while running
- Runs list progress bars use gradient fills (emerald for complete, shimmer for running)

**Run Page UI Improvements**
- Execution log: increased height to `max-h-64`, auto-scrolls to bottom when new events arrive
- Step cards: replaced spinner with gradient shimmer progress bar for running steps
- Input section: 5-column grid with imported date, bold row count, truncated file path with tooltip
- Report dialog: slide-up + fade-in animations
- All dialogs (fork, delete, report) now have consistent animation treatment

**Config Builder & Docs UX**
- Rebuilt RunConfig step builder — cleaner card layout, step number badges, LLM badges visible inline, transform description shown when collapsed, brand-colored expand/focus states, fade-in animations
- Improved input file section — icon buttons, file path shown as code chip, browse dialog with dividers
- Docs page: added "Open" link (external tab icon) next to each expanded doc — opens raw markdown in a new browser tab
- Server: `GET /api/docs/files/:id/raw` — serves markdown as `text/plain` for direct browser viewing
- Updated `.gitignore` for GitHub push — covers data, logs, manifests, build artifacts, editor files
- Added `.env.example` with documented variables

**New Features**
- Sidebar running jobs indicator — pulsing blue chip with ping animation, polls every 3s, links to /runs
- Enhanced dashboard — 6-stat grid (total, completed, running, errors, transforms, files), build tag display, 2/3+1/3 layout with recent runs + quick actions, progress bars on recent runs, docs quick action
- Service worker — caches app shell for offline UI access, skips /api calls, cache-first strategy for static assets
- Run starring — yellow star toggle on detail page (persisted to manifest), star icons on runs list
- Server: `POST /api/runs/:id/star` toggle endpoint, `starred` field in RunSummary
- Poster folder rotation — `posters → posters_last` rename before download (skipped during --retry)
- Centralized logger module (`pipeline/logger.js`) — timestamped output with colored severity levels (INF/WRN/ERR/DBG), child loggers, summary helper
- Added logging to engine.js and job-queue.js with timestamps and step-level detail

**Documentation**
- Created `ui/src/lib/markdown.ts` — lightweight regex-based Markdown→HTML renderer (headings, bold, italic, code blocks, lists, blockquotes, links, horizontal rules)
- Added `.md-content` CSS styles with proper typography for rendered markdown (code blocks use theme `--color-code-bg`)
- Applied markdown rendering to /docs page — replaces raw `<pre>` with rendered HTML
- Created `TECH-STACK.md` — complete technical specs: runtime versions, backend/frontend dependencies, architecture notes, directory structure
- Expanded docs route from 4 to 8 documents: added System Design, Tech Stack, Deployment, SSE Race Condition
- Server `docFiles` and `docMap` updated with all new entries

**Foundation & Testing**
- Created `transforms/dummy.js` — idempotent test transform with configurable `sleep`, `should_fail`, `fail_message`, and `log_rows` options for testing pipeline infrastructure
- Fixed Stop button — SSE handler now properly closes stream on `interrupted` events (was only closing on `done`/`step-error`)
- Step output streaming — engine now emits `info` events with row count during step execution, even for transforms that don't emit their own progress
- Execution log: added color-coded rendering for `interrupted` (yellow) and `info` (cyan) event types

---

### Session 2025-03-19 (current)

**Infrastructure & Theming**
- Created `src/lib/constants/app.ts` — centralized app config (title, subtitle, port, pageSize, nav items)
- Created `src/lib/constants/theme.ts` — theme helpers (getStoredTheme, setTheme, localStorage persistence)
- Rewrote `app.css` with CSS custom properties for full light/dark theming (~30 variables)
- Added Tailwind v4 `@theme` block mapping CSS vars to utility-friendly tokens
- Created `Button.svelte` — reusable button component (variants: primary/secondary/danger/ghost, sizes: sm/md/lg)
- Created `Card.svelte` — reusable card component (title, subtitle, actions snippet, footer snippet, padding options)
- Created `ThemeToggle.svelte` — light/dark toggle with sun/moon icons, localStorage persistence
- Added light/dark theme toggle to sidebar footer
- Sidebar: renamed title to "Script Runner", subtitle to "Versable | Jegs | Ebay"
- Sidebar: added "API Docs" nav item linking to Scalar browser (external link with icon)
- Sidebar: migrated all hardcoded colors to CSS variable references
- Dashboard: migrated to theme variables, uses Card component for recent runs
- Scalar API browser installed (`@scalar/express-api-reference`) with OpenAPI 3.1 spec at `/api/openapi.json`

**Server Endpoints (batch 2)**
- `GET /api/files/preview` — file preview for JSON, Excel, CSV (paginated rows + columns)
- `GET /api/transforms/:name/helpers` — extract helper function details (name, params, JSDoc, source)
- `GET /api/transforms/:name/defaults` — parse transform config defaults from JSDoc

**Feature Additions**
- Files page: inline file preview panel (parallel to download)
- Transforms: helper function inspection (expandable source, params, description)
- RunConfig: auto-populate step config with defaults when selecting a transform
- RunConfig: `onTransformChange` handler with fallback chain (API → local info → raw string)

**Dark Mode (full app migration)**
- Migrated ALL 6 route pages from hardcoded Tailwind gray/white → CSS custom property theme variables
- Migrated ALL 5 reusable components (DataTable, PipelineFlow, RunConfig, Breadcrumb, StatusBadge)
- Zero `text-gray-*`, `bg-gray-*`, `border-gray-*`, `bg-white` remaining in any `.svelte` file
- Code/terminal backgrounds use `var(--color-code-bg)` for theme-aware dark panels
- Status colors (green/blue/amber/red) intentionally preserved as semantic Tailwind classes

**Documentation & Navigation**
- Created `/docs` route — lists project markdown files with expandable inline preview
- Server: `GET /api/docs/files` — lists available .md files with size/modified metadata
- Server: `GET /api/docs/files/:id` — reads and returns markdown file content
- Added "Docs" nav item to sidebar with book icon
- Added SVG favicon (`static/favicon.svg` — gradient blue/indigo grid icon)
- Dynamic `<title>` tags on all routes (e.g., "Runs | Script Runner", "Dashboard | Script Runner")
- Run detail page title shows run name dynamically

**Report Generation**
- Server: `POST /api/runs/:id/report` — generates markdown pipeline summary (steps, I/O, errors, durations)
- Accepts optional `instructions` parameter for custom report focus
- Writes report to `runs/:id/report.md`
- Added "Report" button to run detail action bar
- Report dialog with instructions textarea, preview, and file path display

**Production Features**
- Created `ToastContainer.svelte` + `toast.svelte.ts` store — global toast notification system (success/error/info)
- Created `Spinner.svelte` — reusable loading spinner (3 sizes, optional label)
- Created `EmptyState.svelte` — consistent empty states (3 icon variants, actions snippet)
- Created `Kbd.svelte` — keyboard shortcut key renderer
- Global keyboard shortcuts: `?` opens shortcuts modal, `g+key` vim-style navigation (gr=runs, gn=new, gf=files, gt=transforms, gc=compare, gd=docs, gh=home)
- Shortcuts modal in layout footer with full key reference

**UX Improvements (batch 2)**
- Runs list: added search/filter bar with status filter tabs (all/completed/running/error/draft)
- Runs list: added `{#each}` keys for efficient DOM diffing
- Run detail: added copy-to-clipboard button for run ID (with checkmark feedback)
- Run detail: added `{#each}` keys to steps, events, fork dialog, run-from menu
- Transforms: added search/filter bar with result count
- Transforms: added Ctrl+S / Cmd+S keyboard shortcut for saving edits
- Compare: added delta columns showing numerical difference for rows and duration
- Compare: added `{#each}` keys to all loops
- New Run: enlarged description field (3 rows, resizable)
- New Run: added real-time run ID validation (format check, red border on error)
- Files page: added `{#each}` keys, switched to SvelteMap for reactivity
- Files page: removed unused `extIcon` function
- DataTable: added `{#each}` keys to columns and rows
- PipelineFlow: added `{#each}` key to steps
- RunConfig: added `{#each}` keys to all loops

---

### Session 2025-03-19 (earlier)

**Code Preview Fix**
- Fixed invisible text in transform code preview (One Dark theme color for `text` token)
- Added `text-gray-300` CSS fallback on `<pre>` element

**Files Manager (M9)**
- Created `/files` route with full file browser
- Table view with sortable columns (filename, run, size, modified)
- Search/filter, group-by-run toggle
- File type badges (green=xlsx, blue=csv, amber=json)
- Symlink/linked status indicators
- Stats bar (total files, unique count, total size)
- Server: `GET /api/files` — scans all `runs/*/raw/` directories
- Server: `POST /api/runs/:id/link-file` — creates symlinks for file reuse

**Dashboard**
- Replaced bare redirect with proper dashboard at `/`
- Stats cards (Total Runs, Completed, Running/Errors, Transforms)
- Recent runs list with status badges and relative timestamps
- Quick action cards (New Run, Transforms, Compare)

**Sidebar Redesign**
- Branded logo icon (gradient blue/indigo)
- "New Run" quick action button
- Added Files nav item with icon
- Item descriptions, green status dot

**RunConfig Enhancements**
- Expandable per-step config panel (gear icon toggle)
- Transform config JSON textarea with "Load defaults" button
- Column map JSON textarea
- Output filename text input
- Config edit buffers for safe JSON editing
- Blue dot indicator when step has config
- "Browse Existing" button for file reuse

**Run Detail UX**
- Escape key handler for modals (Delete > Fork > Config priority)
- Step params display as badges (limit, slice, columnMap, outputFilename)

---

### Prior Sessions (M1–M8)

**M1 — Runs List** `/runs`
- Pipeline run cards with status badges, progress bars
- Live polling (5s), empty states, relative timestamps

**M2 — Run Detail** `/runs/[id]`
- Full metadata, inline editable title/description
- Execute controls (Run All, Run From, Run Single Step)
- Fork with selective data copy, delete confirmation
- Live SSE execution log with colored events

**M3 — Data Viewing**
- Paginated DataTable (50 rows/page, smart pagination)
- Column sorting, in-page search, row numbering
- Download: JSON, CSV, XLSX

**M4 — Config Editing**
- RunConfig component: file upload, sheet selection, step management
- Add/remove/reorder steps, transform selection

**M5 — New Run** `/runs/new`
- Form with auto-slug generation from name
- Validation, error handling

**M6 — DAG Visualization**
- PipelineFlow: horizontal flow diagram (Input → Steps → Output)
- Status colors, click-to-expand, stale indicators

**M7 — Transform Editor** `/transforms`
- Transform list with metadata (LLM badge, helpers, description, I/O types)
- Full source viewer/editor with syntax highlighting
- Tab support in editor, save functionality

**M8 — Run Comparison** `/runs/compare`
- Dual run selector, side-by-side summary cards
- Unified step comparison table with color-coded diffs
- URL parameter support for sharing
