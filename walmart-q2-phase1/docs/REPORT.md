# Walmart Q2 Phase 1 — Consolidated Report

**Sessions:** 2026-05-11 → 2026-05-12
**Status:** Iteration 3 ship-ready
**Canonical output:** `output/walmart-loadsheet-combined-q2p1-v3.xlsx`
**Validation:** all audits pass with 0 violations

---

## 1. What we built — at a glance

| Artifact class | Count | Total size |
|---|---|---|
| Pipeline scripts (Node.js) | 16 | ~3,200 lines |
| Library modules (lib/*) | 4 | ~600 lines |
| Brand configs | 2 (iter1 + iter3) | 161 entries |
| Intermediate JSON / JSONL artifacts | 700+ | ~3 GB |
| Validation-rules doc | 1 | 260 lines |
| Ship xlsx files (iter1 + iter3) | 11 | ~30 MB |

---

## 2. Pipeline architecture

```
SOURCE EXPORT (Walmart enhancement xlsx, 1,252 rows, 165 brands)
        │
        ▼
[10-extract-source.js]  ──→  data/01-{brand}-source.json  (× 161)
        │
        ▼ (brand-routed by regex from brands.config.js)

REFERENCE WORKBOOKS (5 files: Brand / Enhanced / Taxonomy / VCdb / FullScrape)
        │
        ▼
[11-build-indices.js]  ──→  data/{brand-mapping,enhanced-content,taxonomy}-by-mpn.json
        │
        ▼ (re-derived from sources; byte-identical to vf baseline)

VCdb MAPPING (35MB Excel, 433,582 fitment rows)
        │
        ▼
[04b-materialize-raw-content.js]  ──→  data/_raw-content-parsed.jsonl  (465 MB, 4 dialects A/B/B2/C)
        │
        ▼ (R2.4 pre-step: no on-the-fly string parsing downstream)

[20-fill.js]  ──→  data/02-{brand}-filled.jsonl  (× 161)
   uses:  lib/year-encode.js       (Year column: contiguous→range, single→single)
          lib/source-priority.js   (vcdb.col vs vcdb.rawContent decisions)
          lib/mpn-normalize.js     (R2.6 leading-dash → prepend "0")
          lib/raw-content-parser.js (dialect-aware; v1.1.0 catches Format B2)
        │
        ▼ (provenance per cell: { value, source })

[99c-consolidate-from-filled.js]  ──→  output/walmart-loadsheet-combined-q2p1-v3.xlsx
        │                                (413,008 rows, 26.6 MB, 87 brands)
        ▼
[100c-validate-from-filled.js]      AUDIT — 8,673,168 cells × 0 mismatches ✓
[90-context-sanity.js]              AUDIT — 161 brands × 0 violations    ✓
[_aggregate-dropped-mpns.js]        AUDIT — 559 dropped MPNs manifested  ✓
[_column-completeness.js]           AUDIT — coverage report per col      ✓
```

---

## 3. Final ship deliverable

| Field | Value |
|---|---|
| File | `walmart-q2-phase1/output/walmart-loadsheet-combined-q2p1-v3.xlsx` |
| Size | 26.6 MB |
| Rows | 413,008 fitment rows + 3 header rows |
| Cols | 21 (Walmart Q2 Phase 1 template) |
| Brands | 87 with data + 74 logged-empty in dropped-mpn manifest |
| sha256 | `1460347f509dff55c922…` (full in `_combined-manifest-v3.json`) |
| Build time (full pipeline) | ~3 min (cold) / ~38s (consolidate only) |

---

## 4. Locked rules — `validation-rules.claude.md`

### Tier 0 — trust (non-negotiable)
- **R0.1** No fabrication, ever — every cell traces to a structured source label
- **R0.2** Required cols are gates, not warnings — dropped rows go to manifest
- **R0.3** Display value matches data value — strings stored verbatim, no Number coercion
- **R0.4** State is ephemeral — re-read before side effects, hash inputs in metas

### Tier 1 — process discipline
- **R1.1** Test on 2-3 rows before any full run
- **R1.2** Cell-level cross-reference validator on combined output
- **R1.3** Excel readback verification (round-trip check)
- **R1.4** Provenance per cell in intermediate JSON
- **R1.5** Source-label whitelist; priority rules for Liter / CC / Cylinders / Aspiration

### Tier 2 — Phase 1 specific
- **R2.1** FULL EXPLOSION, NO COLLAPSE — one xlsx row per VCdb row (run-scoped, opposite of vf-may-1)
- **R2.2** Year encoding: contiguous→range, single→single, no `YYYY-YYYY` for same year
- **R2.3** Engine/body optional cols: source-or-blank, no interpolation
- **R2.4** No on-the-fly string parsing — materialize parsed Raw Content as a pre-step artifact
- **R2.5** Pre-step materialization general rule — deterministic, sidecar `.meta.json` with sha256
- **R2.6** MPN normalization (2026-05-12): leading-dash → prepend `0` (e.g., `-3310S` → `0-3310S`)

### Tier 3 — carry-forward (dormant; for Phase 2/3)
15 rules preserved from vf — trailing zeros, 'in' over 'mm', i18n vocab, hidden-col fix, etc.

---

## 5. Iteration log

| Iter | Date | Scope | Rows shipped | Audits |
|---|---|---|---|---|
| 1 | 2026-05-11 → 12 | 4 brands (ACDelco, Dorman, Holley, Dayco) | 70,152 | 1.47M cells × 0 mismatches |
| 2 | (merged into iter1) | refinement (B2 parser, MPN normalize) | — | — |
| 3 | 2026-05-12 | 161 brands (all viable from source) | **413,008** | **8.67M cells × 0 mismatches** |

---

## 6. Brand coverage breakdown

### By drop rate (universal-fit ratio per brand)

| Drop rate | Brands | Total MPNs | VCdb fitment rows |
|---|---|---|---|
| 0% (perfect) | 55 | 81 | 18,095 |
| 1-25% (sweet spot) | 12 | 411 | **266,112** |
| 26-50% (mixed) | 16 | 221 | 37,114 |
| 51-75% (high drop) | 4 | 149 | 22,951 |
| 76-99% (mostly universal) | 3 (Holley/Rain-X/Michelin) | 275 | 67,401 |
| 100% (pure universal-fit) | 75 | 114 | 0 |

### Top 10 brands by row count in iter3 ship

| Rank | Brand | Rows | % of total |
|---|---|---|---|
| 1 | Scrubblade | 178,854 | 43.3% |
| 2 | Purolator | 42,770 | 10.4% |
| 3 | Holley | 35,681 | 8.6% |
| 4 | Rain-X | 31,113 | 7.5% |
| 5 | Dayco | 16,523 | 4.0% |
| 6 | Motorcraft | 13,960 | 3.4% |
| 7 | Gates | 13,442 | 3.3% |
| 8 | PowerStop | 10,460 | 2.5% |
| 9 | ACDelco | 9,555 | 2.3% |
| 10 | Dorman | 8,393 | 2.0% |
| | **Top 10 share** | **360,751** | **87.3%** |

---

## 7. Column completeness — iter3 combined

| Col | Fill % | Distinct values | Notes |
|---|---|---|---|
| Action | 100% | 1 | constant "A" |
| MPN ✦ | 100% | 689 | 14,725 Holley rows normalized (R2.6) |
| BrandAAIAD ✦ | 100% | 84 | AAIA codes from brand-mapping |
| Year ✦ | 100% | 758 | mix of `YYYY` + `YYYY-YYYY` |
| Make ✦ | 100% | 143 | |
| Model ✦ | 100% | 2,626 | |
| PartTerminologyId ✦ | 100% | 223 | |
| PartTerminologyName | 100% | 223 | |
| SubModel | 100% | 5,000+ | ⚠ ~63% from-trim heuristic + Format-A fallback (numeric codes like "20") |
| BlockType | 99.3% | 5 | H, V, L, I (+1 outlier) |
| Cylinders | 99.4% | 8 | canonical: 1-12 |
| Liter | 97.9% | 112 | decoded decimals (parser solves the encoded-FK problem) |
| Aspiration | 97.7% | 7 | NA / Turbo / Super + variants |
| BodyNumDoors | 68.8% | 6 | 2/3/4/5/6/8 |
| FuelType | 68.4% | 3 | GAS / DIESEL / FLEX FUEL |
| CC | 64.8% | 765 | cubic centimeters |
| BodyType | 50.3% | 8 | Sedan/Coupe/Pickup/etc. |
| Position | 2.0% | 36 | sparse — only Format-C Notes:Position:… |
| **DriveType** | **0%** | — | by design — no VCdb source |
| **BedLength** | **0%** | — | by design — no VCdb source |
| Notes | 0% | — | unused in v1 |

✦ = required by Walmart template

### Why the lower-fill cols

- **CC / BodyType / BodyNumDoors / FuelType (50-68%):** these come from Format-C engine text (e.g., `2.2L 2212CC H4 GAS SOHC`) — present on ~70% of VCdb rows. The 30% that miss are Formats A/B/B2 which lack engine specifics.
- **Position (2%):** parser only extracts when VCdb Notes contains explicit `Position:` — most rows don't.
- **DriveType + BedLength (0%):** no VCdb source carries these. Per R2.3 source-or-blank we don't fabricate.

---

## 8. Audit chain — all 0 violations

| Audit | Scope | Cells / Items checked | Violations |
|---|---|---|---|
| Excel readback verifier (iter1 only) | 4 brands | 1,473,192 cells | **0** |
| Source-label whitelist (R1.5) | 161 brands | 1.07M cells (iter1) + iter3 | **0** |
| Provenance audit (R1.4) | 161 brands | all cells | **0** |
| Forbidden `vcdb.col.Liter` check | 161 brands | all Liter cells | **0** |
| MPN dash-prefix audit (R2.6 post-fix) | 161 brands | all MPN cells | **0** |
| Year same-range audit (R2.2) | 161 brands | all Year cells | **0** |
| Combined cross-reference (iter1) | 4 brands | 1,473,192 cells | **0** |
| Combined cross-reference (iter3) | 87 brands | **8,673,168 cells** | **0** |

---

## 9. Open items for future iterations

| Item | Severity | Notes |
|---|---|---|
| SubModel suspect values | Med | `vcdb.col.SubModel Name` returns numeric codes like `"20"` for Format-A rows; consider filter at fill stage or downstream consumer |
| Position parser coverage | Low | 2% today; broader Notes scan could 3-5× it for iter4 |
| Mixed-format duplicate rate (89-97%) | TBD | Walmart may push back; if so add dedup pass on ship-cols set |
| ExcelJS heap usage at scale | Low | 8GB heap suffices through 500K rows; >500K needs WorkbookWriter streaming |
| FullScrape re-derivation for scrape-only MPNs | Low | Iter1 skipped scrape-only; if Walmart asks, re-enable in iter4 |

---

## 10. File locations (everything you might need)

### Ship artifacts
- `output/walmart-loadsheet-combined-q2p1-v3.xlsx` — iter3 canonical ship
- `output/walmart-loadsheet-combined-q2p1-v1.xlsx` — iter1 canonical (audit trail)
- `output/walmart-loadsheet-{brand}-q2p1-v1.xlsx` (× 4) — iter1 per-brand splits
- `output/walmart-loadsheet-iteration3-sample.xlsx` — 824-row review sample (10/brand × 87 brands)

### Audits + manifests
- `data/_combined-manifest-v3.json` — per-brand row ranges + sha256 chain
- `data/_audit-validate-combined-v3.json` — 8.67M cells × 0 mismatches
- `data/_audit-context-sanity-{brand}.json` (× 161) — per-brand whitelist + provenance
- `data/_audit-column-completeness-v3.json` — column fill stats
- `data/_dropped-mpn-manifest-v3.json` — 559 dropped MPNs across 110 brands
- `data/_brand-discovery.json` — 165-brand universe with drop rates
- `data/_iter3-universal-fit-audit.json` — drop-rate buckets

### Intermediates
- `data/_raw-content-parsed.jsonl` (465 MB) + `.meta.json` — pre-step (R2.4)
- `data/02-{brand}-filled.jsonl` (× 161) + `.meta.json` — per-brand fill stage
- `data/01-{brand}-source.json` (× 161) + `.meta.json` — source extracts

### Docs + rules
- `validation-rules.claude.md` — locked rule set (R0-R3 tiers)
- `docs/TODO.md` — open items, decision log, iter3 spec
- `docs/REPORT.md` — this file
- `docs/TEMPLATE_DIFF.md` — vf vs Q2 Phase 1 template comparison
- `docs/CARRYFORWARD.md` — vf rules audit (still-applies vs out-of-scope)
- `docs/FITMENT_AVAILABILITY.md` — VCdb source dive
- `docs/PLAN.md` — original session plan

### Scripts (in build order)
- `08-discover-brands.js` — brand universe scan
- `09-sample-rows-per-brand.js` — iter3 sampling gate (parametrized, error-hardy)
- `10-extract-source.js` — brand-routed source filter
- `11-build-indices.js` — re-derive taxonomy/brand/enhanced indices
- `04b-materialize-raw-content.js` — VCdb Raw Content parser (R2.4 pre-step)
- `20-fill.js` — core join + emit stage
- `30-assemble.js` — per-brand xlsx (iter1)
- `40-verify.js` — Excel readback verifier (iter1)
- `90-context-sanity.js` — source-label + provenance audit
- `95-mixed-format-dupes-audit.js` — T5 visibility metric
- `99-consolidate.js` — iter1 consolidate (per-brand xlsx → combined)
- `99c-consolidate-from-filled.js` — iter3 consolidate (filled.jsonl → combined)
- `100-validate-combined.js` — iter1 validator
- `100c-validate-from-filled.js` — iter3 validator
- `_aggregate-dropped-mpns.js` — dropped-mpn manifest aggregator
- `_column-completeness.js` — per-col coverage report
- `_sample-and-assemble.js` — iter1 sample script (Mulberry32 + Fisher-Yates)
- `_generate-brands-config.js` — auto-generates iter3 brands config
- `_inspect-output.js` — xlsx structural inspector (debug helper)

### Libraries (`scripts/lib/`)
- `raw-content-parser.js` v1.1.0 — VCdb Raw Content dialect parser (formats A/B/B2/C)
- `year-encode.js` v1.0.0 — 16/16 fixtures pass
- `source-priority.js` v1.0.0 — 7/7 fixtures pass
- `mpn-normalize.js` v1.0.0 — 8/8 fixtures pass

---

## 11. Surprises worth remembering

- **The encoded-Liter problem.** VCdb's `Liter` column carries FK codes like `20, 105, 1055` — not decoded decimals. We solved this by parsing the human-readable `Raw Content` column instead. Source-priority rule (R1.5) hard-bans `vcdb.col.Liter` so the encoded form can never accidentally ship.
- **The Format B2 parser miss.** During iter1 validation we discovered 2,941 rows misclassified as Format B with no extracted fields. They were actually a 4th dialect (`YYYY | Make | Model | Trim | Engine | Notes`, pipe-positional, no key:value pairs). Parser v1.1.0 catches them.
- **The Holley universal-fit pattern.** 41 of 56 Holley source MPNs had no AAIA vehicle fitment because they're carb sub-components (jets, valves, gaskets). Generalized to iter3: 75 of 161 brands are 100% universal-fit (oils, mats, chemicals). All logged in dropped-mpn manifest.
- **The PTs_LIST defined-name corruption.** ExcelJS's `definedNames.remove()` doesn't actually take during write — the external workbook reference (`[1]Hidden_product_content_and_sit'!$A$50`) survives to corrupt the output. Fix: post-process the xlsx as a zip and regex-strip `<definedNames>` from `xl/workbook.xml`.
- **The leading-dash MPN typo.** Holley source data had `-3310S` where the canonical name is `0-3310S`. User-verified upstream typo. Fix: R2.6 normalizer prepends `0` at output time (14,725 normalized in iter3).
- **The auto-generated config worked first try.** 161 of 165 brands snake-cased cleanly into config keys; only 4 required explicit handling (unknown, 2 numerics, 1 case dup).
