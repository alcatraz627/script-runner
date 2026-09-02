
  # Skill Runtime Notes

  Append-only log of session insights.

## session: cc30 flat-attribute pipeline + DataTable UI enhancements — 2026-03-26

**Purpose:** Built 3-step pipeline for new flat-attribute Excel format (24K rows → 556 products), fixed `io.js` export for complex types, enhanced DataTable with hover popovers for JSON values.

**Insights:**

1. `flattenArrayFields` in `io.js` silently corrupted arrays-of-objects by calling `.join('\n')` which invokes `.toString()` → `[object Object]`. Always type-check before serialization — a 2-row test + readback would catch this instantly.
2. Excel cells have a 32,767 character limit — `original_attributes` JSON strings easily exceed this for products with 50+ attributes. Truncation at 32K with `[TRUNCATED]` marker prevents xlsx write failures.
3. Blacklist approach for attribute filtering is safer than whitelist for unknown data formats — new attribute keys auto-include and can be reviewed later, whereas whitelist silently drops unknown keys.
4. CSS `fixed` positioning for hover popovers inside scrollable tables breaks `group-hover:block` — the popover disconnects from the hover target. Use `absolute` with `right-0` anchor and `w-max` + `max-width: min(80vw, 900px)` instead.
5. Part Type extraction benefited from a 3-level fallback chain (part_type → line → part_category), recovering 47 of 96 missing products — always check for alternative source keys before giving up.
6. Flat-to-grouped reshape on "Input Row" column is the natural grouping key for cc30 format; the column rename step (productbrand→Brand, etc.) should happen during grouping, not as a separate transform.

---

## session: pipeline re-run, filter transform, contaminated data cleanup — 2026-03-24

**Purpose:** Re-ran jegs-ebay-final pipeline safely, discovered 162 items with duplicate eBay URLs (scraper data corruption), built filter-items transform, fixed 4 fully contaminated items.

**Insights:**

1. Pipeline engine gates Excel import with `!fs.existsSync(dataFile('raw'))` — re-running any step is safe when raw.json already exists; transplanted data is never overwritten.
2. 28 eBay Item URLs were mapped to 162 different SKUs by the scraper — frequency audit of `eBay Item URL` field is a useful data quality check for any new pipeline run.
3. Haiku consistently overshoots 600c for physical/tool product descriptions (Truck Bed Lift, Plasma Table) — these categories need manual trim or a stricter prompt with character-by-character counting instruction.
4. `transforms/filter-items.js` pattern: config-driven URL exclusion in a dedicated pipeline step is cleaner than patching raw.json — excluded items remain in source data and can be re-included by updating config.
5. Heredoc (`cat << 'EOF'`) corrupts JS template literals in zsh — backtick strings become unquoted tokens. Always use Write tool for JS files with template literals.
6. When re-running only some steps (not the full pipeline), run them in strict sequence via individual API calls — `fromStep` runs to the end, so use `step` for targeted single-step execution.

---

## session: normalize.json audit + data quality fixes — 2026-03-24

**Purpose:** Audited jegs-ebay-final normalize.json, fixed junk attrs, placeholder images, Part Type field mismatch, and compacted 17 descriptions to 500–600 char constraint.

**Insights:**

1. `sideload-part-types.js` wrote `row['Part Type']` to raw.json but `jegs-export-normalize.js` read `row['Category Hierarchy']` — silent mismatch meant Part Types were only correct in the patched normalize.json, not after any re-run. Fix: transform now uses `row['Part Type'] || row['Category Hierarchy']`.
2. `transplant-selections.js` only writes explicit user picks — never clears pre-existing `Main Image` values. Blocked stock URLs that were set before the blocklist was extended survived into normalize.json undetected until a frequency audit of image URLs.
3. Excel-sourced `Item Specifics (JSON)` attrs (55 items) were never routed through the bulk cleanup pipeline — only LLM-extracted attrs went through the dashboard. Always run `fix-junk-attrs.js` after any data transplant.
4. Haiku treats "Max ~500 chars" as a hard cap. Use "MINIMUM 500 characters" + "STRICTLY between X and Y" in prompts where a floor matters. Even then, expect 1–2 retries to land in a tight window.
5. Never rewrite data without explicit user approval — even when fixing a known quality issue. Report first, act only on confirmation.
6. Re-running the normalize transform from raw.json is safe for descriptions (passed through directly) but will revert any field that the transform re-derives from raw (e.g. Part Type from Category Hierarchy, Images from Main Image). Always verify the transform's source fields after a sideload script.

---

## session: Script Runner UI fixes (5 changes) — 2026-03-24

**Purpose:** Fixed StatusBadge light mode, added archive runs, improved poster download output, made sidebar title clickable, added transform info to step detail view.

**Insights:**

1. CSS custom properties (`bg-[var(--color-text-muted)]`) don't work with Tailwind's `dark:` prefix — the var resolves at runtime, ignoring the dark variant. Use explicit classes like `bg-gray-400 dark:bg-gray-500` instead
2. Nested `<button>` inside `<button>` is invalid HTML — Svelte check catches it. Use `<div role="button">` as outer container with event delegation via `data-no-nav` attribute on inner buttons
3. The `/api/transforms` endpoint already parses JSDoc headers from transform files and serves description, config, inputOutput, hasSystemPrompt — just needed to be loaded in the run detail page
4. For progress callbacks with per-item details, pass the info as a `lastItem` field in the progress object rather than emitting separate events — keeps the event stream clean
5. Archive feature pattern: toggle endpoint (`POST /api/runs/:id/archive`), `archived` boolean on manifest, client-side filter with `showArchived` state, counts derived reactively

---

## session: parallel downloads with adaptive throttling — 2026-03-21

**Purpose:** Extracted shared download engine from duplicated poster download logic, added parallel concurrency with adaptive throttling and retry queue.

**Insights:**

1. Both `pipeline/download-posters.js` and `transforms/download-posters.js` had ~80% identical code — shared engine in `pipeline/poster-downloader.js` now provides `downloadAll()`, `buildPayload()`, `sanitize()`
2. Semaphore pattern (active counter + tryDispatch loop) works well for dynamic concurrency without external deps — `currentConcurrency` changes take effect on next dispatch, not in-flight requests
3. Adaptive throttling: 3 consecutive failures → halve concurrency, 10 consecutive successes at reduced → double (capped). Separate counters reset on opposite events
4. Retry queue drains in passes after main queue completes — items pushed during retries create additional passes automatically via `while (retryQueue.length > 0)` loop
5. Failures file enhanced from `{ failed: [] }` to include `{ failed: [], details: { pn: { error, attempts, lastAttempt } } }` for better diagnostics

---

  ## session: extract & transplant attributes for zero-attr items — 2026-03-21    
                                                                                  
  **Purpose:** Created LLM extraction pipeline and transplant script for 271 items
  missing attributes in jegs-ebay-mar-20-03 run.                                  
                                                                                  
  **Insights:**                                                                   
                                                                                  
  1. 271 of 590 items have zero attributes — the Versable platform generated      
  descriptions/features but didn't extract Item Specifics                         
  2. Followed existing clean-attributes.js batch-20 Claude API pattern (Haiku     
  model, JSON response, markdown fence stripping)                                 
  3. Auto-review validation catches 3 failure modes: novel attr names, long values
  (>40 chars), part-number-looking values                                         
  4. Key format conversion: extracted as [[name, value]] arrays, transplanted as  
  {name: value} JSON string into Item Specifics (JSON) field — normalize transform
  handles conversion back                                                         
  5. .env has placeholder API key — scripts expect ANTHROPIC_API_KEY env var (no  
  dotenv dependency, matching existing pattern)                                   
                                                                                  
  --------                                                                        


  ## session: walmart loadsheet v5 unicode normalization — 2026-03-30

**Purpose:** Added `normalizeText()` to `fill-walmart-loadsheet.js` to strip all typographic unicode before Walmart submission. Generated v5.xlsx.

**Insights:**

1. U+2011 (non-breaking hyphen `‑`) is visually identical to `-` but silently breaks vehicle model string matching — found 223× in fields like `CR‑Z`. Always run non-ASCII scan before submitting to retail ingestion.
2. Apply normalization at the single cell-write boundary, not per-field — future columns get it automatically.
3. Unit regex false positives: short tokens like `"in"` match inside prose words. Need digit lookahead and word-boundary anchors to avoid noise in text audits.
4. LLM-generated text consistently produces smart quotes (277×), en dashes (468×), ellipsis chars — always plan a normalization pass when LLM output feeds structured retail pipelines.

---

## session: walmart loadsheet pipeline + VCDB fitment tool — 2026-03-30         
                                                                                  
  **Purpose:** Built Walmart enhancement Excel → 94-col loadsheet pipeline (v3),  
  alias audit (3,029 keys, 24 groups), VCDB fitment validator,                    
  overfitting/underfitting audit with 10 fixes.                                   
                                                                                  
  **Insights:**                                                                   
                                                                                  
  1. items_included has 0% coverage in this dataset — always verify key coverage  
  before building fallback chains. A dead primary key silently forces all rows to 
  fallback, masking the real issue.                                               
  2. eBay condition strings are verbose ("New: A brand-new, unused...") —         
  normalize with a simple prefix match, not equality. condition.toLowerCase().    
  startsWith('used') catches all variants.                                        
  3. better-sqlite3 is synchronous and dramatically simpler than sqlite3 async for
  REPL/script use — prefer it for interactive tooling.                            
  4. Progressive prefix shortening for model name matching: try "Ram 1500 Laramie"
  → "Ram 1500" → "Ram" against VCDB exact names. Captures submodel as the leftover
  string. Handles eBay's submodel+engine-appended fitment format cleanly.         
  5. ExcelJS ws.addRow() appends after the last existing row in the workbook —    
  always clear template placeholder rows (6–N) first, then use ws.                
  getRow(explicit_row_num) for predictable placement.                             
  6. 3,029 unique keys across 1,252 rows (2.4× ratio) is normal for eBay multi-   
  seller flat attributes — always expect extreme key proliferation; audit-first,  
  then map.                                                                       
                                                                                  
  --------                                                                        

