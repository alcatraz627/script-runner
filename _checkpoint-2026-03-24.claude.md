# Core Dump — 2026-03-24

Full plan and execution record for this session. Covers: pipeline re-run, data quality fixes, UI improvements, manual-step/dashboard plugin system, and Puppeteer scraper foundation.

---

## Initial Goal

Resume from a context-compacted prior session. Complete the jegs-ebay-final pipeline re-run (filter + normalize + download-posters) with the updated dedupeUrls logic producing 456 items. Then address outstanding data quality issues and implement two major features: a pipeline halt/manual-approval system with a dashboard plugin architecture, and a Puppeteer scraper foundation for jegs.com.

---

## Agent Actions

### Part 1 — Pipeline Re-Run

1. **Resumed from compaction** — server had been restarted to clear module cache for updated `filter-items.js`. Filter and normalize steps needed re-running.
2. **Discovered manifest was missing the filter step** — `run.manifest.json` only had 4 steps (split-desc, corrections, normalize, download-posters) because `manifest.getOrCreate()` returns existing manifest without syncing config changes. Manually inserted the filter step into `run.manifest.json` using `node -e` with `splice()`.
3. **Ran filter step** via `POST /api/runs/jegs-ebay-final/execute {step:"filter"}` → 456 rows: 118 excluded (7 large-group URLs), 28 deduped, 16 originals kept.
4. **Ran normalize step** → 456 rows in 14ms.
5. **Kicked off download-posters** — user reported server had stopped; restarted server and re-triggered.

### Part 2 — Data Quality: Attribute Blocklist

6. **Found Part Type in attributes** — user reported items had `Part Type` as an attribute key. Root cause in `transforms/jegs-export-normalize.js`: `parseItemSpecifics()` returns all keys from `Item Specifics (JSON)` including metadata fields.
7. **Added `BLOCKED_ATTR_KEYS` Set** to normalize transform, filtering out: `Part Type`, `Part Number`, `Brand`, `Part Category`, `Part Fitment`, `Product Line`, `Package Depth/Height/Width`, `Shipping Weight`, `California Prop 65 Warning`, `Compliance`. Verified 0 items with blocked attrs after re-run.
8. **Restarted server** (module cache), re-ran normalize, re-kicked download-posters with clean data.

### Part 3 — Small UI Fixes

9. **Wrote `_discard-list.md`** — full URL→SKU map (7 exclude groups + 21 dedupe groups) with `[[[kept]]]` notation. Written to project root.
10. **Fixed StatusBadge (root cause found)** — `@import 'tailwindcss'` confirms Tailwind v4. In v4, `dark:` utilities default to `prefers-color-scheme` media query, not the `.dark` CSS class the app uses. This caused `dark:` styles to fight with CSS variables regardless of shade values. Rewrote `StatusBadge.svelte` to use scoped `<style>` with explicit `:global(.dark)` selectors — completely bypassed Tailwind for badge colors. Added `stale` and `awaiting` statuses.
11. **Added "Open in Finder" button** for download-posters step:
    - `server.js`: `POST /api/runs/:id/open-posters` → `exec('open "<postersDir>"')`
    - `ui/src/lib/api.ts`: `openPosters(id)` method
    - `ui/src/routes/runs/[id]/+page.svelte`: button in step header, only when `step.fn === 'download-posters' && step.status === 'completed'`

### Part 4 — Manual Step / Dashboard Plugin System

**Plan:**
- Engine: `type: "manual"` steps suspend execution via injected `waitForApproval(stepId)` Promise
- Job queue: new `awaiting` job status, `approve(jobId, stepId)` method
- Server: `POST /api/runs/:id/approve`, dashboard static serving, selections API
- Dashboard shell: `DashboardBridge` JS library + `_template/` for agent customization
- UI: `/dashboards` collection page, awaiting state on step cards with approve/open-dashboard buttons

**Execution:**

12. **Modified `pipeline/engine.js`**:
    - Added `waitForApproval` to function signature
    - Inserted `type: 'manual'` handling block before normal step flow: passes input data through unchanged, updates manifest to `awaiting`, emits `step-awaiting` event, awaits `waitForApproval(stepId)` Promise, then marks completed and continues

13. **Modified `pipeline/job-queue.js`**:
    - Added `awaitingStepId` field to job object
    - Added `approve(jobId, stepId)` public method: resolves stored `_approvalResolver` Promise, resets job status to `running`
    - In `_run()`: created `waitForApproval` closure that sets `job.status = 'awaiting'`, stores `_approvalResolver`, passes it to `execute()`

14. **Added server endpoints to `server.js`**:
    - `POST /api/runs/:id/approve` — finds awaiting job, calls `jobQueue.approve()`
    - `GET /api/dashboards` — scans `dashboards/` for non-`_` dirs with `manifest.json`
    - `GET /api/dashboards/:id` — single dashboard manifest
    - `GET/POST /api/runs/:runId/dashboard-selections/:dashboardId` — per-run selection files stored at `data/_selections-{dashboardId}.json`
    - `app.use('/dashboards', express.static(DASHBOARDS_DIR))` — serve dashboard HTML

15. **Created `dashboards/dashboard-bridge.js`**:
    - `DashboardBridge` class: reads `runId`, `stepId`, `dataStep`, `dashboardId` from URL params
    - `init()`: loads items + prior selections in parallel
    - `select(key, value)`: records selection, debounced auto-save (800ms)
    - `saveNow()`: flush saves immediately
    - `signalDone()`: save + `POST /api/runs/:runId/approve`
    - `onStatus(callback)`: pub/sub for `idle/saving/saved/error/done` states
    - `isStandalone`: true when opened without `runId` (no-op approve)
    - UMD export (works as `<script>` tag or `require()`)

16. **Created `dashboards/_template/`**:
    - `manifest.json`: metadata schema (`name`, `description`, `version`, `keyField`, `pipeline`, `ui`)
    - `index.html`: full working dashboard with two-panel layout, search, auto-save status bar, Done button; three clearly marked `TODO(customize)` functions (`getItemSummary`, `renderDetail`, and optional `onSearch`)
    - Complete CSS system with CSS variables for theming

17. **Created `dashboards/README.md`**: full system documentation covering architecture, creation workflow, URL params, bridge API, selections storage, and notes on existing pre-plugin dashboards.

18. **Updated `ui/src/lib/api.ts`**: added `api.runs.approve()`, `api.dashboards.list()`, `api.dashboards.get()`

19. **Updated `ui/src/lib/components/StatusBadge.svelte`**: added `awaiting` status (purple, light+dark)

20. **Updated `ui/src/lib/constants/app.ts`**: added Dashboards nav item with `dashboard` icon

21. **Created `ui/src/routes/dashboards/+page.svelte`**: collection page listing all registered plugins with name, id, version, description, and Open button (opens in popup window)

22. **Updated `ui/src/routes/runs/[id]/+page.svelte`**:
    - Added `approveStep(stepId)` and `openDashboard(step)` functions
    - Added `stepStatusColor` case for `awaiting` → `border-l-purple-400`
    - Added awaiting action buttons in step header: "Open Dashboard" (only if `dashboardId` set) + "✓ Approve" (always for awaiting steps); Run button hidden while step is awaiting

23. **Added `dashboard` icon to `ui/src/routes/+layout.svelte`** nav

### Part 5 — Puppeteer Scraper Foundation

**Plan:** Agent-driven: provide browser lifecycle, navigation, extraction helpers, and two clearly stubbed methods (`buildUrl`, `extractData`) for an agent to implement.

24. **Ran `npm install puppeteer`** in project root.

25. **Created `transforms/jegs-scraper.js`**:
    - `SCRAPER_CONFIG`: base URL, delay, timeout, retries, launch options, user agent
    - `JegsScraper` class:
      - `launch()`: Puppeteer browser + page, sets UA, viewport, blocks image/font/media requests
      - `navigate(url, opts)`: goto with retry loop (up to `maxRetries`)
      - `scrapePage(url, row)`: navigate + extractData — for one-off use
      - `scrapeAll(items, onProgress)`: batch with rate limiting + progress callback
      - `close()`: browser teardown
      - Extraction helpers: `getText`, `getAttr`, `getTextList`, `getAttrList`, `getTable`, `waitAndGetText`, `evaluate`
      - `buildUrl(row)` — **TODO(agent)**: derive JEGS URL from row
      - `extractData(page, row)` — **TODO(agent)**: pull fields from loaded page
    - Pipeline transform entry point: wraps `scrapeAll`, merges scraped data onto rows, failed rows pass through unchanged
    - Exports: `module.exports` (transform fn), `.JegsScraper` (class), `.SCRAPER_CONFIG`

### Build Tags

| Change set | Build tag |
|---|---|
| Open-posters button + StatusBadge light mode fix | `cedar-hawk-9` |
| StatusBadge root-cause fix (Tailwind v4 dark mode) | `amber-wolf-3` |
| Dashboard system + Puppeteer + nav + awaiting UI | `river-fox-12` |

---

## Current Expectation

User ran `/core-dump` to snapshot the session. Will resume with the major features now built — likely testing the dashboard plugin flow end-to-end, or addressing any issues with the awaiting step UI.

---

## Pending Items

**Functional verification:**
- [ ] Test `type: "manual"` step end-to-end: add to a run config, execute, verify engine suspends, click Approve in UI, verify pipeline resumes
- [ ] Verify download-posters completed successfully for 456 items (was running when session was captured)
- [ ] Verify `river-fox-12` build tag visible in UI after Vite hot-reload

**Dashboard work:**
- [ ] Create first real dashboard plugin (e.g. image review for jegs-ebay-final) by copying `_template/` and implementing the three functions
- [ ] Consider integrating existing `image-selector/` and `preview-dashboard/` as registered plugins (optional — noted in README as future work)

**Puppeteer:**
- [ ] Agent needs to implement `buildUrl(row)` and `extractData(page, row)` in `transforms/jegs-scraper.js` for the specific scraping task
- [ ] Test scraper against a JEGS product page to verify selectors

**Data / pipeline:**
- [ ] 24 items with empty images still need manual backfill via `image-selector/upsert-images.js`, then re-run download-posters for those 24 only
- [ ] 162 excluded items still need re-scrape of correct eBay listings
- [ ] SSE race condition fix (3-file change, documented in `sse-event-race-condition.md`)
- [ ] 555-10377 thin description (low priority)

**run.config.js not committed** — `runs/` is gitignored; config changes are local only.

---

## Key Files Modified This Session

| File | Change |
|---|---|
| `pipeline/engine.js` | Added `type: 'manual'` step handling + `waitForApproval` param |
| `pipeline/job-queue.js` | Added `awaiting` status, `approve()` method, `waitForApproval` closure |
| `server.js` | Added `/approve`, `/dashboards/*`, `/dashboard-selections/*` endpoints |
| `transforms/jegs-export-normalize.js` | Added `BLOCKED_ATTR_KEYS` filter |
| `transforms/jegs-scraper.js` | New — Puppeteer foundation |
| `dashboards/dashboard-bridge.js` | New — shared JS client library |
| `dashboards/_template/index.html` | New — agent-customizable dashboard template |
| `dashboards/_template/manifest.json` | New — plugin metadata schema |
| `dashboards/README.md` | New — full system documentation |
| `ui/src/lib/components/StatusBadge.svelte` | Root-cause fix (Tailwind v4 dark: issue); added awaiting/stale |
| `ui/src/lib/api.ts` | Added `approve`, `dashboards.list`, `dashboards.get` |
| `ui/src/lib/constants/app.ts` | Added Dashboards nav item; build tag `river-fox-12` |
| `ui/src/routes/dashboards/+page.svelte` | New — dashboard collection page |
| `ui/src/routes/runs/[id]/+page.svelte` | Awaiting state: approve/open-dashboard buttons, stepStatusColor |
| `ui/src/routes/+layout.svelte` | Added `dashboard` SVG icon for nav |
| `_discard-list.md` | New — jegs-ebay-final URL→SKU discard map |

---

## Supplementary Files

- [`_discard-list.md`](./_discard-list.md) — jegs-ebay-final excluded SKU map
- [`_pipeline-context.mar-24.claude.md`](./_pipeline-context.mar-24.claude.md) — full pipeline narrative (slightly stale, predates this session's attr fix)

---

_Generated by /core-dump. Resume with /catchup._
