# Walmart Q2 Phase 1 — Plan

**Started:** 2026-05-11
**Input:** `input/walmart-q2-phase1-template-20260511.xlsx` (copied from `~/Downloads/Walmart Q2 Template Phase 1 Input.xlsx`)
**Previous work:** `walmart-vf/` — 4 brands shipped, combined-vf-v1.xlsx (39 rows, 0 mismatches)

## Goal

Re-load the SAME source data (ACDelco, Dorman, Holley, Dayco — 4 per-brand files + 1 consolidated) into the NEW Walmart Q2 Phase 1 template. Different template, same underlying product data. Output mirrors vf shape: 4 per-brand xlsx + 1 combined xlsx with strict filter.

## Approach — two exploration passes around a user review gate

1. **Pass 1 — Structural exploration (this session, before showing results)**
   - Probe new template: sheets, headers, hidden columns, dropdown vocabularies, sample data.
   - Probe old vf template the same way for an apples-to-apples diff.
   - Diff column-by-column: identical / renamed / new / dropped.
   - Distill carry-forward rules from vf into a brief.

2. **USER REVIEW GATE** — present findings, recommendations, risks. Wait.

3. **Pass 2 — Validation (after review)**
   - Re-verify accepted assumptions against the actual file (no assumptions on second-hand evidence).
   - Catch sloppy mistakes before any pipeline code is touched.

## Carry-forward priorities (from `walmart-vf/`)

Rules that MUST survive the template change:
- **No fabrication**: every cell traces to source. Provenance `{ value, source }` architecture.
- **Trailing zeros preserved** in display AND data.
- **'in' over 'mm'** when both available; never auto-convert units.
- **Bulbs → wattage > voltage** for primary measure.
- **Fitting parts → inside_diameter** as primary measure.
- **Volume products → capacity** > length.
- **Dimensional default = length** when no obvious primary.
- **Drop rows missing required cols** (no yellow-flagging hack).
- **Consolidation rule** (from final vf session): drop rows missing `shipping_weight`.
- **Hidden cols un-hide** when we write to them.
- **Sources**: Brand Mapping, Enhanced Content, Taxonomy, VCdb, Full Scrape — same 5 reference workbooks.

## Folder layout

```
walmart-q2-phase1/
├── input/      ← reference input template (preserved untouched)
├── data/       ← intermediate JSON (per-brand sources, indices, filled, audits)
├── output/     ← per-brand xlsx + combined xlsx
├── scripts/    ← probes, pipeline (forked from walmart-vf/scripts/ as needed)
└── docs/       ← PLAN, TEMPLATE_DIFF, CARRYFORWARD, QUESTIONS, RULES
```

## Anti-mistake checklist (from vf session)

- [ ] No wizard option pre-fills a value not present in source data
- [ ] Every fabricated-looking column has a source attribution
- [ ] Test transforms on 2-3 rows before full run
- [ ] Verify Excel reads-back match the JSON we wrote
- [ ] `unit.toLowerCase()` must skip case-sensitive units (W, V, A, etc.)
- [ ] Walmart-internal-ID regex must handle 9-digit too (`^1\d{8,9}$`)
- [ ] When users report value-shape concerns, JSON.stringify first — display vs data
