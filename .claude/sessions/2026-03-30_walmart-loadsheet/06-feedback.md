# Feedback & Learnings — 2026-03-30

## Session Feedback (user instructions followed)

1. **"Do not load the whole file into context, use scripts"** — all Excel inspection done via streaming scripts; no raw data pasted into conversation.

2. **"Make sure each generated file is numbered from the very start"** — implemented auto-version detection (`nextVersion()` via `fs.readdirSync` + regex on `walmart-loadsheet-filled-vN.xlsx`). v1, v2, v3 generated correctly.

3. **"Do another sweep of the input data — be comprehensive"** — wrote full 24-group alias audit with 3,029 keys across 1,252 rows. Report is 3,319 lines.

4. **"Do not overfitting / underfitting — define with examples, do audit, generate, spot check 30 rows, detailed report"** — followed exactly: definitions with 3 examples each, 8-fix audit, v3 generated, 30-row spot check with fill rates.

---

## Key Learnings for Future Sessions

### Excel/ExcelJS
- `ws.addRow()` appends after last existing row — always clear template rows 6+ before writing, then use `ws.getRow(n)` with explicit row numbers
- ExcelJS streaming: `ws.id` is a string — use `==` not `===` for sheet ID comparison; all sheets need row handlers or reader stalls; use `reader.on('end')` not `ws.on('end')`
- Cell character limit: 32,767 chars max in Excel — truncate with `[TRUNCATED]` marker for long text fields

### Attribute Key Aliasing (Walmart source data)
- `condition` attr (98% coverage) stores full eBay condition strings — needs normalization to "New"/"Used"/"Remanufactured"
- `items_included` never appears; actual keys are `item_included`, `include`, `package_content` (~4% each) + 20+ `*_included` boolean keys
- `color_family` never appears; `color_finish` (6.1%) is the actual secondary color key
- Material data is fragmented: 10+ product-specific material keys, each with 2–5% coverage — need full merge
- `vehicle_make`/`vehicle_model`/`vehicle_year` attrs exist as direct lookups (~26–29%) independent of the fitment text column

### VCDB Fitment Parsing
- Fitment strings append submodel + engine spec: "Ram 1500 Laramie 5.7L 8cyl" — strip engine first, then progressive prefix-match model name
- Year-less fitment lines ("Ford F-150") are valid — should match across all years in VCDB
- VCDB has 246K vehicles, 548 makes, 19,338 models, years 1896–2026; `better-sqlite3` is fast and synchronous, ideal for interactive tools

### Data Quality
- 3,029 unique attribute keys across 1,252 rows (2.4× more keys than rows) = extreme eBay seller variability
- >100% key coverage means multiple values of the same key per row (e.g., `price` at 257% = avg 2.57 price attrs per row — multiple sellers)
- Always verify key coverage before building fallback chains — a key with 0% is worse than no fallback at all
