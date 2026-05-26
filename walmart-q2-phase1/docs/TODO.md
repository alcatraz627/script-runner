# Walmart Q2 Phase 1 — TODO & Decisions Log

**Last updated:** 2026-05-11
**Run scope:** This run + next iteration = 4 brands (ACDelco, Dorman, Holley, Dayco). Iteration 3 = TBD brand expansion (see open question Q1).

---

## Resolved decisions (locked 2026-05-11)

| # | Decision | Rule ref |
|---|---|---|
| D1 | Full explosion, no collapse — one xlsx row per VCdb row | R2.1 |
| D2 | Year encoding: contiguous→range, single→single, never `YYYY-YYYY` for one year | R2.2 |
| D3 | Raw Content parsing is a pre-step (materialized JSONL); downstream reads only the JSONL | R2.4 / R2.5 |
| D4 | Source priority: rawContent wins over col for Liter/CC/Cylinders/Aspiration/etc.; col wins for Year/Make/Model | R1.5 |
| D5 | Liter = `"0"` is **kept as-is** (explicit rule for this run only — do not coerce to blank) | new run-rule |
| D6 | Unknown-format rows (41 total): **drop** in fill stage with reason `"unknown raw content format"` | new run-rule |
| D7 | Long-position threshold raised from 30 → 50 chars. Positions >50 chars logged to `_long-position-review.jsonl` for next-iteration parser improvement | parser tweak |
| D8 | 6/8 BodyNumDoors values: keep as-is (legitimate van/truck data) | data trust |
| D9 | shipping_weight filter: deferred — not applied in Q2 Phase 1 v1; can layer later | run-rule |
| D10 | Mixed-format duplicate (Year, Make, Model) tuples within an MPN: **ship as duplicates** per R2.1 full-explosion rule. Log count per MPN in AFTER audit. | clarification of R2.1 |

---

## Open items requiring action

### T1 — Parser fix: Format B2 detection (2.3% of Format B rows misclassified)
**Severity:** Medium — affects 2,941 of 127,874 Format B rows. Currently parsed with `year/make/model = undefined`, silently dropping into ship-blank rows.

**Discovered shape** (pipe-positional, no key:value pairs):
```
1990 | Nissan | 300ZX | 2+2 Coupe 2-Door | 3.0L 2960CC 181Cu. In. V6 GAS DOHC Naturally Aspirated | Front;BuyAutoParts New
```

**Fix plan:**
1. In `lib/raw-content-parser.js`, add Format B2 detection: when `head === "YYYY"` (just 4-digit year) AND next `|`-segment has no colon, parse as positional.
2. Assign `format: 'B2'` so source labels stay distinguishable.
3. Re-run `04b-materialize-raw-content.js` (parser version bumps to 1.1.0 → meta sha256 changes, audit-trail honored).

---

### T2 — Build `lib/year-encode.js` with exhaustive format coverage
**Severity:** Required for pipeline.

Year-encode logic must handle all observed VCdb year shapes. Test fixtures (must produce expected output):

| Input | Expected output (rows) | Source |
|---|---|---|
| `"1966"` | `["1966"]` | format C |
| `"1977, 1978, 1979, 1980, 1981"` | `["1977-1981"]` | format C |
| `"1983, 1985, 1986"` | `["1983", "1985-1986"]` | user spec |
| `"1977, 1979, 1981, 1982"` | `["1977", "1979", "1981-1982"]` | user spec |
| `"2006, 2018-2019"` | `["2006", "2018-2019"]` | format A |
| `"2007-2011, 2013-2019"` | `["2007-2011", "2013-2019"]` | format A |
| `"1993, 1995-1998"` | `["1993", "1995-1998"]` | format A |
| `"1977-1977"` | `["1977"]` | sanity (no same-year range) |
| `""` | `[]` | empty source |

**Unmatched input logging:** any year string that doesn't match a known pattern → append to `data/_year-encode-anomalies.jsonl` with `{ input, vcdbRow, mpn }`. Do NOT silently emit. Pipeline continues; user reviews anomalies for next iteration.

---

### T3 — Holley MPN coverage gap (41 of 56, 73%)
**Severity:** Run scope — affects how many Holley MPNs ship in Phase 1.

**Investigation result (2026-05-11):** the 41 missing Holley MPNs are **universal-fit aftermarket parts** — carburetor sub-components (jets, needle valves, power valves, accelerator pumps, throttle ball joints, air cleaner gaskets). They don't have AAIA fitment data because they fit "any Holley Model 2010/2300/4010/4150/etc. carburetor", not "1985 Camaro".

Sample (8 of 41):
- `20-11SA` Carburetor Accelerator Pump Conversion Kit — vehicleYear/Make/Model all empty in vf
- `122-107` Carburetor Metering Jet — compatibleCars `"Fits All Holley Model 2010; 2300; 4010; 4011; 4150; 4160 & 4500"` (product compat, not vehicle)
- `108-4` Air Cleaner Mounting Gasket — all empty
- `125-75` Carburetor Power Valve — all empty
- `6-518-2` Carburetor Needle Valve — all empty

Full list: `data/_missing-holley-mpns.json`.

**Other sources checked:** Full Scrape (probed earlier — has these MPNs but only as product-key/value rows like `wattage`/`color`, not vehicle fitment). compatibleCars in vf is mostly empty for them. No alternative structured fitment source exists.

**Decision needed (Q2):** see open question Q2 below.

---

### T4 — Drop unknown-format rows (41 rows)
Fill stage drops VCdb rows with `rawContent.format === 'unknown'`. Recorded in `_dropped-row-manifest.json` with reason `"unknown raw content format"`. The unknown rows are clustered in motorcycle fitments (`Fit for Honda Motorcycle ...`) and other one-off shapes — not part of the 4 target brands' MPN universe (verified: none of the 4 target brands' shipped MPNs appear in the 41 unknown rows).

---

### T5 — Mixed-format duplicate logging (no behavior change)
390 MPNs (52%) appear in multiple Raw Content formats. 34-76 (Year, Make, Model) tuples per MPN appear duplicated across formats. Per R2.1 full-explosion, **ship duplicates as-is** — no dedup, no merge.

But: add to AFTER audit a `mixedFormatDupesCount` field per output. If Walmart pushes back on duplicates in submission, we layer dedup in a future iteration.

---

### T6 — Brand expansion for iteration 3
User question: "I want to also run this pipeline on ALL brands in the original data (as opposed to the 4 we shortlisted for the last run). Will that need extra pre-parsing work on your end?"

**Answer: No, the materialization step is already brand-agnostic.** `04b-materialize-raw-content.js` parses ALL 433,582 VCdb rows across all 745 distinct MPNs, regardless of brand. The per-brand filter happens at the fill stage where we join source-export MPNs (from the JEGS enhancement file) with the materialized lookup. Expanding to more brands = expand `brands.config.js`, not re-parse.

**For iteration 3, what we need from you:**
- The full list of brands present in the source enhancement export (we can enumerate them)
- A pick: 2 / 4 / N / all
- A confirmation that VCdb coverage gaps (like Holley's 73%) are acceptable for whichever brands are added

No code/parser work needed in advance.

---

### T7 — Pipeline stages still to build
After T1 + T2 land, the actual pipeline shape:

1. `10-extract-source.js` — read source enhancement export, filter to brands.config.js entries, write `data/01-{brand}-source.json`
2. `11-build-indices.js` — already-built JSONs for taxonomy / brand-mapping / enhanced-content from vf carry over; copy and verify hashes
3. `20-fill.js` — join source MPNs with materialized VCdb JSONL; emit one row per VCdb match × year-encode expansion; apply source-priority rule; provenance per cell; drop missing-required-col rows
4. `30-assemble.js` — write per-brand xlsx (21 cols per Q2 template)
5. `40-verify.js` — Excel readback verifier
6. `99-consolidate.js` — straight concat of per-brand xlsx into combined
7. `100-validate-combined.js` — cell-level cross-reference validator (vf trust check)
8. `90-context-sanity.js` — source-label whitelist audit + provenance audit

---

## Notes / parking lot

- **N1**: Parser version bumps must be reflected in `_raw-content-parsed.meta.json` AND any downstream artifact that references it.
- **N2**: Source-label whitelist allows `vcdb.rawContent.formatB2.<field>` once T1 lands. R1.5 entry to update.
- **N3**: `lib/source-priority.js` is the single decision point for "where does a value come from when both VCdb col and parsed Raw Content have it?" — needs implementation alongside `20-fill.js`.
- **N4**: For iteration 3 brand expansion, the brand→MPN association comes from the source enhancement file's `Brand` column, NOT from VCdb. VCdb has no brand info per row, only Part Number.

---

## Resolved (2026-05-11)

### Q1 — Brand scope for iteration 3 → ALL brands, with sampling gate
Iteration 3 runs **all brands present in the source enhancement export**, but gated by a sample-first review step:

1. New stage `09-sample-rows-per-brand.js` (build for iteration 3):
   - Parametrized: `--rows-per-brand N` (default 10), `--brands all|<list>`, `--out <path>`
   - Per brand: pick up to N rows from `02-{brand}-filled.jsonl`; if `<N` rows total, take all
   - Verbose error logging: brand-missing-from-source, brand-with-zero-vcdb-coverage, parse failures
   - Output: `data/_iteration3-sample-{date}.jsonl` + sidecar `_iteration3-sample.meta.json` with brand-by-brand row counts
2. User reviews sample. Tweaks to heuristics happen here.
3. After approval, full run executes for all brands.

The materialization step is already brand-agnostic (433K VCdb rows × all 745 MPNs covered) — no parser pre-work is needed before iteration 3. We just enumerate source-export brands and run.

### Q2 — Holley universal-fit MPNs → ignore + flag
**Decision: drop rows where the MPN has no VCdb match (or yields no fitment rows after the join), flag for review.**

- Drop happens at fill stage when `vcdbMatchCount === 0` for a source MPN, OR when all candidate rows fail required-col gates.
- Dropped MPNs go to `data/_dropped-mpn-manifest.json` with `{ brand, mpn, partType, reason, vcdbMatchCount, vfHadFitment }`.
- The 41 universal-fit Holley MPNs land here naturally — no special case logic needed.
- Manifest IS the review flag. User can scan it after each run.

---

## Iteration 3 scope (not now)

- Sampling step (Q1 resolution)
- Run full pipeline across all brands in source export
- Universal-fit ratio analysis per brand (Holley pattern likely applies to other aftermarket brands)
- Possibly: a non-fitment-submission destination for universal-fit MPNs (out of Phase 1 scope)

---

## Resolved (2026-05-11, second batch)

### Q3 — Output file naming → CONFIRMED
- Per brand: `output/walmart-loadsheet-{brand}-q2p1-v1.xlsx`
- Combined: `output/walmart-loadsheet-combined-q2p1-v1.xlsx`
- Audits: `data/_audit-{brand}-v1.json`
- Version bumps `v1 → v2 → ...` within this same datestamped run

### Q4 — Indices: re-derive from reference workbooks (NOT copy)
**Decision: re-derive in this run.** Avoids stale-data risk even if inputs look unchanged. T7b now builds `11-build-indices.js` to read the 5 reference workbooks and write fresh `taxonomy-by-mpn.json`, `brand-mapping-by-mpn.json`, `enhanced-content-by-mpn.json` into `walmart-q2-phase1/data/`. Each output gets a sidecar `.meta.json` per R2.5 with input sha256.
