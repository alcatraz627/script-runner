# Walmart Loadsheet vf — Workflow Plan

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         INPUTS  (~/Downloads/…)                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌─ Source Enhancement Export ────────────┐  (1,252 rows, 12 cols)           │
│  │  Brand=ACDelco filter → 64 rows        │                                  │
│  └────────────────────────────────────────┘                                  │
│                                                                              │
│  ┌─ 1. Brand Mapping       ──┐  ┌─ 2. Enhanced Content    ──┐                │
│  │  2,624 rows               │  │  1,252 rows               │                │
│  │  Part# → AAIA codes       │  │  Part# → Title/Desc/F&B   │                │
│  └───────────────────────────┘  └───────────────────────────┘                │
│                                                                              │
│  ┌─ 3. VCdb Mapping       ──┐   ┌─ 4. Taxonomy Mapping   ──┐                 │
│  │  many rows / Part#       │   │  2,624 rows              │                 │
│  │  Part# → fitment combos  │   │  Part# → PartTermID, …   │                 │
│  └──────────────────────────┘   └──────────────────────────┘                 │
│                                                                              │
│  ┌─ 5. Full Scrape        ──┐  (PENDING — see QUESTIONS Q6)                  │
│  │  part_fitment key        │                                                │
│  └──────────────────────────┘                                                │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                  STAGE 1 — convert to JSON shards (no Excel in core loop)    │
├──────────────────────────────────────────────────────────────────────────────┤
│  scripts/01-extract-acdelco.js          → data/01-acdelco-source.json        │
│  scripts/02-build-brand-index.js        → data/brand-mapping.json            │
│  scripts/03-build-enhanced-index.js     → data/enhanced-content.json         │
│  scripts/04-build-taxonomy-index.js     → data/taxonomy.json                 │
│  scripts/05-build-vcdb-index.js         → data/vcdb.json   (sharded if >5MB) │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            STAGE 2 — per-column transforms over JSON                         │
├──────────────────────────────────────────────────────────────────────────────┤
│  scripts/10-fill-acdelco.js consumes:                                        │
│    01-acdelco-source.json + brand/enhanced/taxonomy/vcdb indices             │
│  Emits → data/02-acdelco-filled.json with:                                   │
│    { partNumber, cells: { col: { value, source, confidence, note }, … } }    │
│                                                                              │
│  Each column has a tiny pure transform (composable, testable):               │
│    fillBrand() · fillMpn() · fillMeasureUnit() · fillVehicleCategory()       │
│    fillVehicleFitmentType() · fillAaiaBrandId() · fillAdditionalFeatures()   │
│    fillPartTerminologyId() · fillTitle() · fillDescription()                 │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            STAGE 3 — validation BEFORE we write Excel                        │
├──────────────────────────────────────────────────────────────────────────────┤
│  scripts/20-validate-filled.js:                                              │
│    • per-column fill-rate report                                             │
│    • flag rows where required cells (MPN/Measure/Unit/VehCat/VehFit) blank   │
│    • flag lookup misses with provenance                                      │
│  scripts/21-spot-check-html.js → output/spot-check.html                      │
│    • 5 rows side-by-side: source attrs · lookups · filled · provenance       │
│    • dark/light toggle (per existing pattern)                                │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            STAGE 4 — assemble final Excel                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│  scripts/30-assemble-loadsheet.js:                                           │
│    • read template (Walmart Loadhseet Mar 30.xlsx)                           │
│    • clear template data rows 6+                                             │
│    • write each ACDelco row from 02-acdelco-filled.json                      │
│    • normalizeText() at the cell-write boundary                              │
│  → output/walmart-loadsheet-acdelco-vf-v1.xlsx                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            STAGE 5 — verify Excel readback matches JSON                      │
├──────────────────────────────────────────────────────────────────────────────┤
│  scripts/40-verify-excel.js:                                                 │
│    • re-open output xlsx, extract every cell                                 │
│    • compare cell-by-cell to 02-acdelco-filled.json                          │
│    • produce diff report — must be empty for sign-off                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Per-column verification criteria

| Column                     | Required? | Fill-rate target | Verification                                                      |
| -------------------------- | --------- | ---------------- | ----------------------------------------------------------------- |
| Brand                      | yes       | 100% (64/64)     | All cells == agreed brand string (Q1)                             |
| Manufacturer Part Number   | yes       | 100%             | == source `Part Number` exactly                                   |
| Measure                    | yes       | 100%             | Numeric/parseable; comes from extracted attribute (Q2)            |
| Unit                       | yes       | 100%             | Closed vocabulary (in/lb/oz/qt/W/V…); pairs with Measure          |
| Vehicle Category (+)       | yes       | 100%             | == "Auto Accessories" verbatim                                    |
| Vehicle Fitment Type       | yes       | 100%             | ∈ {Universal, Vehicle Specific}; matches `fitment` rule (Q5)      |
| AAIA Brand ID              | partial   | best-effort      | Only when Brand Mapping lookup hits agreed criteria (Q3)          |
| Additional Features (+)    | partial   | high             | Sourced from Enhanced Content `Features and Benefits`             |
| Part Terminology ID        | partial   | depends on Q7    | Only when Taxonomy lookup hits; rows handled per Q7               |
| Title                      | partial   | high             | From Enhanced Content per Q4                                      |
| Description                | partial   | high             | From Enhanced Content per Q4                                      |

## Reliability / flakiness call-outs (post-coverage probe)

Updated after Full Scrape probe + per-column coverage stats on ACDelco.

- 🟢 **Solid (100% deterministic, all 64 rows covered):**
  - Brand filter (64 ACDelco rows in source)
  - Manufacturer Part Number (direct copy)
  - Vehicle Category constant ("Auto Accessories")
  - **AAIA Brand ID** — Brand Mapping has 100% coverage, all `Mapped?=true`,
    all `Confidence=high`, all 64 → `Brand Code = "BCVC"`. Effectively a
    constant for ACDelco.
  - **Part Terminology ID** — Taxonomy PCdb sheet has 100% coverage; 64/64 have
    a PartTerminologyID across 54 distinct PartTerminologyNames.
  - **Additional Features (+)** — Enhanced Content has 100% coverage of ACDelco
    MPNs, all with Features and Benefits filled.

- 🟠 **Brittle: Vehicle Fitment Type.** The user-named source key
  (`part_fitment`) covers only **1 of 64 ACDelco MPNs** (=1.6%). Sibling key
  `vehicle_fitment_type` covers 10 more. Source's `fitment` column covers 35.
  The remaining **29 MPNs have no fitment signal anywhere** — Q11/Q13 must
  resolve before a value can be written.

- 🟠 **Brittle: Measure / Unit.** Open attribute schema, no canonical
  "primary measure" field. Resolution = per-part-type rule table built with
  user (Q2 / Q16). 54 distinct part types in scope.

- 🟡 **Medium: 5 ACDelco MPNs in scrape but not in source** — Q15.

- 🟡 **Sideload step:** v9 vs v10 differ in 2 image columns only
  (mainImageUrl: +113 added, 647 changed; productSecondaryImageURL: +715 added).
  Need scope confirmation in Q14.

## What I will not do
- Load any Excel file fully into Claude's context.
- Write a value to the loadsheet that doesn't trace to a documented source.
- Change RULES.md without your sign-off.
