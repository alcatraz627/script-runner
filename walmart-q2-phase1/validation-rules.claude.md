# Validation Rules — Walmart Q2 Phase 1

**Status:** LOCKED 2026-05-11 (run-scoped)
**Datestamped run:** `walmart-q2-phase1/` — rules below apply ONLY to this run. A new datestamped run gets its own validation-rules file; do not edit this one across runs.
**Owner:** Both human + agent. Agent runs the checklist; human is final approver.

This doc is the single source of truth for "is this output trustworthy?" Every rule has three parts:
- **Rule** — the principle
- **Enforcement** — how the rule is built into code/process
- **Validation** — how we PROVE it was enforced AFTER generation

Two checklists at the end:
- **BEFORE** — read & agree before generating any file
- **AFTER** — verify before claiming the file is ready

---

## Scope by artifact class

Rules apply differently depending on what you're generating. Three classes:

| Class | Description | Examples | Rules that apply |
|---|---|---|---|
| **A — Ship** | Files that go to Walmart or that humans review as deliverables | `output/walmart-loadsheet-*.xlsx`, `output/walmart-loadsheet-combined-*.xlsx` | **ALL** (R0.*, R1.*, R2.*, applicable R3.*) |
| **B — Intermediate** | JSON shards, indices, parsed lookups, manifests — reused by downstream stages | `data/02-{brand}-filled.json`, `data/_raw-content-parsed.json`, `data/_combined-manifest.json` | R0.1 (no fabrication), R0.2 (required-col gates), R0.4 (state ephemerality), R1.1 (limit-3 first), R1.4 (provenance), R1.5 (whitelist), R2.* (Phase 1 specific) |
| **C — Audit/report/doc** | Coverage stats, validator outputs, design docs, this file | `data/_raw-content-coverage.json`, `data/_audit-*.json`, `docs/*.md`, `validation-rules.claude.md` | R0.4 (state ephemerality), R1.1 if generating from data (test on slice first) — that's it |

When a rule's text below conflicts with the scope table, the scope table wins. A rule has no force on a class it doesn't apply to.

---

## Tier 0 — Trust rules (non-negotiable)

### R0.1 — No fabrication, ever
- **Rule:** Every cell value MUST trace to a real source field. No value derived from "general knowledge" or LLM guess. The 2026-05-01 vf incident: agent suggested `12V` for VVT solenoid as a "manual override wizard option" without any source attribution. User caught it as a trust-killer.
- **Enforcement:** Intermediate JSON shape is `{ value, source }` per cell. The `source` field is a structured label (e.g., `"taxonomy.partTerminologyID"`, `"vcdb.col.Make Name"`, `"vcdb.rawContent.formatC.liter"`, `"brandMapping.Brand Code"`) — never a free-form string like "derived from domain knowledge" or "best guess".
- **Validation:**
  - Whitelist of allowed `source` prefixes; any cell whose source doesn't match the whitelist fails the audit.
  - Spot-check sample: pick 20 random cells, manually trace each back to the cited source file + row + column.
  - If a `wizard` or `manual override` source is ever introduced, every value under that label must point to a user-input file (`_user-overrides.json`) that exists on disk and is keyed by `${brand}:${mpn}:${col}`.

### R0.2 — Required columns are gates, not warnings
- **Rule:** Rows missing any required column are DROPPED from the output. No yellow-highlight, no flag-and-ship, no "we'll fix later". Vf rule that survived: "Drop rows where required cols are missing (no yellow-flagging hack)".
- **Enforcement:** Pipeline filter stage rejects rows where `cells[required_col].value` is empty/null/undefined. Dropped rows go to `_dropped-manifest.json` with `reason: "missing required: <col>"`.
- **Validation:**
  - `_dropped-manifest.json` row count + final xlsx row count == total candidate rows.
  - For Phase 1, required cols = `[MPN, BrandAAIAD, Year, Make, Model, Part Terminology Id]`. Re-scan output xlsx: 0 rows have any of these empty.

### R0.3 — Display value matches data value
- **Rule:** What the user sees in Excel must equal what's in the underlying JSON. Trailing zeros, capitalization, whitespace — verbatim. Vf incident: user worried trailing zeros were trimmed; turned out the JSON was fine, only my chat label trimmed them.
- **Enforcement:** Numeric values stored as strings in intermediate JSON when precision matters (e.g., `"2.0"`, `"0.7000"`). xlsx assembler uses `cell.value = stringValue` not `cell.value = Number(stringValue)`.
- **Validation:** Readback step (`40-verify.js` style): open the written xlsx, read each cell, compare `String(cellValue)` against `String(jsonValue)`. Mismatch count must be 0.

### R0.4 — State is ephemeral; re-read before side effects
- **Rule:** File contents, git status, process state can change between tool calls. Before any push, write, or destructive op, re-read the relevant state.
- **Enforcement:**
  - Before writing the combined xlsx: `git status` to confirm no concurrent edits to per-brand files.
  - Before each pipeline stage: re-read the manifest, don't cache from prior runs.
  - Before user-visible diffs: re-read the output file fresh.
- **Validation:** Manifests carry a `producedFromHashes` field — sha256 of input JSON files. Combined validator confirms current input hashes match the manifest's recorded hashes (drift detection).

---

## Tier 1 — Process discipline

### R1.1 — Test on 2-3 rows before any full run
- **Rule:** Every transform / pipeline stage gets a smoke test with `--limit 3` (or equivalent slice) before processing the full dataset. From CLAUDE.md, project rule #1.
- **Enforcement:** Every script supports `--limit N`. First invocation of a new transform is always `--limit 3 --brand acdelco` (smallest brand subset).
- **Validation:** Logs show the limited-run invocation before any unlimited run for that script-version. Diff of full-run output vs limited-run output (for the 3 overlapping rows) shows identical values.

### R1.2 — Cell-level cross-reference validator on combined output
- **Rule:** The combined xlsx must be byte-equivalent to the per-brand xlsx files row-for-row. No silent transformation during consolidation. Vf shipped `100-validate-combined.js` — 3666 cells × 0 mismatches. Same trust check applies here.
- **Enforcement:** `99-consolidate.js` produces `_combined-manifest.json` recording `{ srcBrand, srcRow, dstRow }` for every kept row + `{ srcBrand, srcRow, reason }` for every dropped row. `100-validate-combined.js` re-opens both files and walks the manifest, comparing every cell.
- **Validation:** Validator output JSON must show `{ cellsCompared: N, mismatches: 0, droppedRowSanityViolations: 0 }`. Any non-zero is a HARD failure — fix before ship.

### R1.3 — Excel readback verification
- **Rule:** Don't trust that `wb.xlsx.writeFile()` succeeded just because it didn't throw. Re-open and read what was actually written.
- **Enforcement:** Every assembler script has a paired verifier (`40-verify-<brand>.js`) that opens the output, reads every cell, compares to intermediate JSON, and exits non-zero on any mismatch.
- **Validation:** CI/manual step: pipeline run is only "complete" once verifier returns clean for all 4 brands + combined.

### R1.4 — Provenance per cell in intermediate JSON
- **Rule:** Every `cells.<colName>` in `02-{brand}-filled.json` is shape `{ value: string, source: string }`. Source is a structured label, not prose.
- **Enforcement:** Fill stage refuses to write a cell without a `source` field. Lint pass (`90-context-sanity.js` style) scans for `{ value: X }` without source.
- **Validation:** `jq` query against filled JSON returns 0 rows where `.cells | to_entries[].value | .source == null or .source == ""`.

### R1.5 — Source label whitelist
- **Rule:** Only these `source` prefixes are allowed:
  - `source.<colName>` — direct from source enhancement export
  - `taxonomy.<field>` — from `taxonomy-by-mpn.json`
  - `brandMapping.<field>` — from `brand-mapping-by-mpn.json`
  - `enhancedContent.<field>` — from `enhanced-content-by-mpn.json`
  - `fullscrape.<field>` — from `fullscrape-by-mpn-<brand>.json`
  - `vcdb.col.<columnName>` — from a VCdb structured column (e.g., `vcdb.col.Make Name`, `vcdb.col.Year ID`)
  - `vcdb.rawContent.<format>.<field>` — from the materialized parsed Raw Content lookup (R2.5). `<format>` is the detected dialect: `formatA` / `formatB` / `formatC`. E.g., `vcdb.rawContent.formatC.liter`.
  - `derived.<expr>` — composition of above (e.g., `derived(brandMapping.Brand Code→col3)`); only allowed when transformation is mechanical (uppercase, trim, lookup, group-consecutive-years) AND the derivation expression is itself executable code, not LLM logic
  - `userOverride.<file>:<key>` — values from `_user-overrides.json`
  - `constant` — only for true constants (e.g., Action='A')
- **Source priority rule (Phase 1):** When the same field exists in both `vcdb.col.<X>` and `vcdb.rawContent.formatC.<X>`, the priority is:
  - **Year, Make, Model**: `vcdb.col.*` wins (structured, normalized vocabulary).
  - **Liter, CC, Cylinders, BlockType, SubModel, Aspiration**: `vcdb.rawContent.*` wins (the VCdb column versions are FK-encoded codes, not decoded values — see Liter coverage report).
  - **BodyType, BodyNumDoors, FuelType, Position**: `vcdb.rawContent.*` is the only source.
- **Enforcement:** Whitelist regex in `90-context-sanity.js`. Hard-fail on any source not matching. Priority enforced in `lib/source-priority.js` — a single module imported wherever a cell-fill decision is made.
- **Validation:** Run audit script after every fill stage. 0 rows with non-whitelisted source.

---

## Tier 2 — Phase 1 specific rules

### R2.1 — Fitment row explosion: FULL EXPLOSION, NO COLLAPSE (Q2 Phase 1 specific, 2026-05-11 run)
- **Rule:** **One xlsx row per VCdb input row, period.** No dedup, no collapse, no tuple-uniqueness assertion. This is the OPPOSITE of the vf-may-1 run (which dropped rows missing shipping_weight and collapsed by product); Q2 Phase 1 demands full fitment granularity. The combined xlsx is the simple concatenation of per-brand xlsx files (filtered only by required-col gates per R0.2).
- **Enforcement:** Fill stage emits one row per VCdb row. No dedup pass. Combined consolidator does straight concat in brand order. Any future "should we merge X and Y" question is answered NO unless this rule is re-opened with the user.
- **Validation:** Row count check: `sum(per-brand xlsx row counts) - rows-dropped-for-missing-required = combined xlsx row count`. No "duplicate tuple" assertions. Spot-check 3 random MPNs and confirm output row count == VCdb match count (minus drops).

### R2.2 — Year representation: contiguous→range, single→single (LOCKED 2026-05-11)
- **Rule:** Parse VCdb `Year ID` field (which may be a single year, e.g. `"1966"`, or a comma-list, e.g. `"1983, 1985, 1986"`). Group into runs of consecutive integers. For each run, emit a row:
  - Run of length 1 → single year, e.g. `"1966"` (NOT `"1966-1966"`)
  - Run of length ≥ 2 → range `"min-max"`, e.g. `"1985-1986"`
- **Examples:**
  - `"1966"` → 1 row, Year=`1966`
  - `"1983, 1985, 1986"` → 2 rows: Year=`1983`, Year=`1985-1986`
  - `"1977, 1978, 1979, 1980, 1981"` → 1 row, Year=`1977-1981`
  - `"1977, 1979, 1981, 1982"` → 3 rows: Year=`1977`, Year=`1979`, Year=`1981-1982`
- **Enforcement:** Single module `lib/year-encode.js` exports `encodeYearField(rawYearIdString) → string[]`. Every fitment-emitting stage imports from it. NEVER hand-roll the grouping logic inline.
- **Validation:** Unit test fixture covers the 4 examples above. Pipeline audit: scan output Year col for any value matching `/^(\d{4})-\1$/` (same-year range) — should be 0 rows.

### R2.3 — Engine/body cols: source-or-blank
- **Rule:** Optional cols 9-20 (SubModel, BlockType, Cylinders, Liter, CC, FuelType, Aspiration, DriveType, Bed Length, BodyType, BodyNumDoors) are populated ONLY when a structured source (per R1.5 priority rule) has the value for that exact VCdb row. No interpolation, no "this MPN is a V8 so cylinders=8 for every vehicle" — must be per-row precise.
- **Enforcement:** Fill stage looks up each optional col per-row using `lib/source-priority.js`. If both VCdb col AND parsed Raw Content miss, cell is blank (not interpolated, not "best guess").
- **Validation:** Cell-source audit: every populated optional-col cell has a non-blank `source` field that matches the whitelist. Blank cells must have a recorded reason in the row metadata (`reason: "no source available"`).

### R2.4 — No on-the-fly string parsing — materialize as a pre-step
- **Rule:** Any data that requires text parsing (e.g., VCdb `Raw Content` column with `Key: Value |` format) MUST be extracted by an explicit upstream step that writes a verifiable artifact to `data/`. Downstream stages reference the materialized JSON, not the raw text. **No regex parsing inside fill/assemble/verify stages.** This was vf's compatibleCars-string-op trap and we are avoiding it by structure, not by discipline.
- **Enforcement:** Pre-step `04-extract-raw-content.js` (or equivalent) reads the source file, parses every Raw Content row, and writes `data/_raw-content-parsed.json` shape `{ [vcdbRowId]: { format, year, make, model, submodel, liter, ... } }`. Downstream fill stage reads ONLY the parsed JSON.
- **General principle:** Any string-op transformation = pre-step with named output → downstream consumes the output, never recomputes. Pre-step outputs are Class B intermediate artifacts (R0.4 hash drift detection applies — if Raw Content extraction needs to refresh, it's an explicit user-approved step, not silent re-derivation).
- **Validation:**
  - `data/_raw-content-parsed.json` exists before any fill stage runs.
  - Fill stage code contains 0 string-parse regexes against `Raw Content` (grep audit).
  - Parsed JSON format distribution logged: must match expected `{B, C, A, unknown}` shares within tolerance. If a new format appears or `unknown` >0.1%, hard-fail and surface to user — extraction is refreshed only with user involvement.

### R2.6 — MPN normalization: leading-hyphen → prepend "0" (run-scoped, locked 2026-05-12)
- **Rule:** When a source MPN begins with `-` (e.g., `-3310S`, `-7448`, `-80573S`), prepend a `0` before writing to the output xlsx (→ `0-3310S`, `0-7448`, `0-80573S`). User-verified upstream typo: canonical Holley carb part numbers begin with `0-`. The dash-only form is a stripped-leading-zero artifact.
- **Why this run only:** the upstream data may be corrected at source in iteration 3; the rule is preserved as a defensive transform until then.
- **Scope of correction:** OUTPUT only. The internal VCdb join key keeps the dash-form so we don't have to re-materialize the 433K-row JSONL (where VCdb also carries the dash). Both sides of the join agree on `-3310S`; only the cell that ships to Walmart is corrected.
- **Enforcement:** `lib/mpn-normalize.js` exports `normalizeMpn(raw)`. Pure / deterministic / idempotent (8 tests passing). Wired in `20-fill.js` at the MPN cell write — the only place in the pipeline where MPN is written to ship.
- **Source label:** normalized cells use `derived(source.Part Number→mpn-normalize)` instead of `source.Part Number`. This matches the R1.5 whitelist's `derived.<expr>` category.
- **Validation:**
  - Pre-fix audit: count source MPNs matching `/^-/` — log for visibility.
  - Post-fix audit: scan output xlsx; **0 rows may have an MPN starting with `-`**. Hard-fail otherwise.
  - Diff audit: pre-fix vs post-fix count of `^-` MPNs should be (N) and (0) respectively.

### R2.5 — Pre-step materialization (general rule)
- **Rule:** Pre-step artifacts (Class B intermediates produced specifically to avoid R2.4 violations) carry these traits:
  - Deterministic input → deterministic output (no LLM calls, no time-dependent values)
  - Each artifact records: input file path, input file sha256, parser version, generated-at timestamp, row counts per format/dialect/branch
  - Re-running the pre-step on unchanged inputs produces byte-identical output
- **Enforcement:** Every pre-step writes a sidecar `.meta.json` with `{ inputPath, inputSha256, parserVersion, generatedAt, stats }`.
- **Validation:** Audit: re-run pre-step in a temp dir; diff output vs canonical → must be empty.

---

## Tier 3 — Carry-forward (still in force for Phase 2/3; kept here so they're not forgotten)

These were active rules in vf. Phase 1 doesn't need them, but Phase 2/3 will:

- **R3.1 — Trailing zeros preserved verbatim** (display + data)
- **R3.2 — Prefer 'in' over 'mm'** when both available; never auto-convert units
- **R3.3 — Bulbs: wattage > voltage** as primary measure
- **R3.4 — Fitting parts: inside_diameter** as primary measure
- **R3.5 — Volume products: capacity > length**
- **R3.6 — Dimensional default: length** when no obvious primary
- **R3.7 — Title-vs-attribute discrepancy detection** — flag when a part title says "21.50in" but source attr says "9.500in"
- **R3.8 — Color/material i18n vocab** — Spanish/French/German → English (Negro/Noir → Black)
- **R3.9 — CASE_SENSITIVE_UNITS exception** — don't lowercase W, V, A, etc.
- **R3.10 — Walmart-internal-ID regex** — `^1\d{8,9}$` (9-10 digits)
- **R3.11 — Hidden cols un-hide when writing** — NOT needed for Phase 1 (template has 0 hidden cols) but re-enable for Phase 2/3 templates
- **R3.12 — FAB-recovery** — regex-extract dims from features text when proposal CSV empty
- **R3.13 — Image sideload** — absolute-URL filter, reject `/images/mini_100/...` relative paths
- **R3.14 — Display-vs-data verification ritual** — JSON.stringify first when user reports value-shape concerns
- **R3.15 — 8 codified user-pick rules from wizard** — see `walmart-vf/data/_user-measure-overrides.json`

---

## ✅ BEFORE checklist

First identify the artifact **class** (A/B/C per scope table). Then tick the applicable items.

### Class A — Ship artifacts (xlsx outputs)
```
[ ] R0.1 — All cells will carry { value, source }; no LLM-derived values
[ ] R0.2 — Required cols list confirmed; missing-row drop logic in place
[ ] R0.3 — Numeric values stored as strings where precision matters
[ ] R0.4 — Re-read input state at start of stage; don't cache from prior session
[ ] R1.1 — First run will be --limit 3, NOT the full dataset
[ ] R1.4 — Fill stage refuses to write a cell without a source field
[ ] R1.5 — Source label whitelist enforced; priority rule (vcdb.col vs vcdb.rawContent) wired
[ ] R2.1 — FULL EXPLOSION confirmed; no dedup logic; one xlsx row per VCdb row
[ ] R2.2 — Year encoding via lib/year-encode.js ONLY (no inline grouping)
[ ] R2.3 — Optional cols 9-20 = source-or-blank; no interpolation
[ ] R2.4 — Raw Content parsed JSON exists; fill stage reads only the JSON, no regex on raw text
[ ] R2.6 — MPN normalizer wired; output cell uses normalizeMpn(); leading-dash count logged pre-fix
[ ] If Phase 2/3 territory: R3.1-R3.15 carry-forward rules reviewed
```

### Class B — Intermediate artifacts (JSON shards, lookups, manifests)
```
[ ] R0.1 — Provenance shape enforced where applicable
[ ] R0.2 — Required-field gates enforced for filled-row JSON
[ ] R0.4 — Re-read input state; don't cache
[ ] R1.1 — Smoke test on slice before full dataset
[ ] R1.4 — Provenance per cell (filled JSON only)
[ ] R1.5 — Source whitelist enforced
[ ] R2.4 — Pre-step rule honored: parsed JSON exists before fill stage runs
[ ] R2.5 — Sidecar .meta.json written with { inputPath, inputSha256, parserVersion, stats }
```

### Class C — Audit / report / doc
```
[ ] R0.4 — Re-read inputs; don't cite stale data
[ ] R1.1 — If generated from data, ran on a slice first to sanity-check shape
```

## ✅ AFTER checklist

### Class A — Ship artifacts
```
[ ] Excel readback verifier returned 0 mismatches
[ ] Source-label whitelist audit returned 0 violations
[ ] Source-priority audit: no Liter/CC/Cylinders cell sourced from vcdb.col (must be vcdb.rawContent)
[ ] Provenance audit: 0 cells with null/empty source
[ ] Required-col audit: 0 rows in output missing required cols
[ ] Dropped-manifest matches difference between candidate count & final count
[ ] Year-encoding audit: 0 rows match /^(\d{4})-\1$/ (no `1966-1966` style)
[ ] MPN normalization audit (R2.6): 0 rows in output match /^-/ (leading-dash already prepended with "0")
[ ] Row-count sanity: sum(per-brand) - drops == combined count; spot-check 3 MPNs vs VCdb match counts
[ ] If combined: 100-validate-combined.js returned 0 cell mismatches
[ ] Spot-check: 5 random cells manually traced to source files
[ ] Spot-check: 5 random dropped rows confirmed to legitimately lack required data
```

### Class B — Intermediate artifacts
```
[ ] Sidecar .meta.json written and inputSha256 matches actual input
[ ] If parser pre-step: format distribution within expected tolerance; unknown <0.1%
[ ] Re-run determinism check: re-running on unchanged input produces byte-identical output
[ ] Source-whitelist audit on any provenance fields
```

### Class C — Audit / report / doc
```
[ ] Cited file paths exist and were actually read this session
[ ] No claims based on memory or stale prior outputs
```

---

## How to use this doc

1. **At session start** (or after `/clear`): re-read this file. The agent should not assume the rules are loaded.
2. **Before any pipeline stage**: walk the BEFORE checklist; confirm each item is true OR document why it's deferred.
3. **After any pipeline stage that produces a file**: walk the AFTER checklist; produce an `_audit-<stage>.json` with results.
4. **If any rule is violated**: stop, report, fix the root cause. Don't ship around it.
5. **If a new rule is discovered**: add it here BEFORE the next session ends. Future agents will re-read this file.

---

## Decision log (resolved questions)

| Date | Question | Decision |
|---|---|---|
| 2026-05-11 | Dedup vs full explosion? | **Full explosion, no collapse** (R2.1) — opposite of vf-may-1 which collapsed |
| 2026-05-11 | Year encoding? | Contiguous→range, single→single, never `YYYY-YYYY` for one year (R2.2) |
| 2026-05-11 | Raw Content parsing approach? | Materialize as pre-step artifact; downstream reads parsed JSON only (R2.4 / R2.5) |
| 2026-05-11 | Liter source priority? | `vcdb.rawContent` wins over `vcdb.col` (codes vs decoded) — see R1.5 priority block |
| 2026-05-11 | Scope of these rules? | Three artifact classes (A/B/C); rules apply per class per scope table |
| 2026-05-11 | shipping_weight filter? | Deferred — not applied in Q2 Phase 1 v1; can layer on combined later |
| 2026-05-12 | MPN leading-dash handling? | **Normalize**: prepend `0` to any MPN starting with `-` (R2.6). User-verified upstream typo; canonical form begins with `0-`. |
