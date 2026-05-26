# Carry-Forward Brief — vf → Q2 Phase 1

Rules and gotchas from `walmart-vf/` that survive the template change, tagged by relevance to Phase 1.

## ✅ STILL APPLY — keep doing

### Process rules
- **No fabrication ever** — every cell traces to a real source field. Provenance per cell `{ value, source }`. Hallucinated `12V` for VVT solenoid in vf was caught by user; rule now in `~/.claude/mistake-patterns.md`. Same rule applies to vehicle attributes here: never invent a Cylinders/Liter/FuelType.
- **Test on 2-3 rows before full run.** Verify output by reading the xlsx back, don't trust the write.
- **Cell-level cross-reference validator** — vf had `100-validate-combined.js` (3666 cells, 0 mismatches). Phase 1 should ship the same trust check between per-brand outputs and combined.
- **Provenance-per-cell architecture** in the intermediate JSON, even though Phase 1's final xlsx is simpler.
- **JSON-mediated pipeline**: source → indices → fill (JSON) → assemble (xlsx) → verify-readback.
- **Brand parametrization** via `brands.config.js`. The 4-brand pattern works as-is.
- **Random-sampling spot checks** (`80-spot-check-random.js --seed 100`).
- **Display-vs-data verification**: when a value's shape looks wrong, JSON.stringify the file before re-running pipeline.

### Data semantics
- **Trailing zeros preserved verbatim** in display AND data (e.g. `"2.0"` not `2`, `"0.7000"` not `0.7`).
- **Drop rows where required cols are missing** — no yellow-flagging hack. Phase 1 required cols: MPN, BrandAAIAD, Year, Make, Model, Part Terminology Id.
- **Consolidation rule changes**: vf dropped rows missing `shipping_weight`. Phase 1 has no weight col. New rule: **drop rows missing any of the 6 required cols.**

### Source data
- Same 5 reference workbooks: Brand Mapping, Enhanced Content, Taxonomy, VCdb, Full Scrape.
- Same 4 brands: ACDelco, Dorman, Holley, Dayco.
- Same input export: the 2026-03-30 enhancement file.
- `taxonomy-by-mpn.json` already gives us **Part Terminology Id** (col 7). ✅
- `brand-mapping-by-mpn.json` already gives us **BrandAAIAD** (col 3). ✅

## ⚠️ CHANGED RELEVANCE

### Hidden columns — no longer an issue
vf template shipped with 23 hidden cols; pipeline had to un-hide them. Q2 Phase 1 has 0 hidden cols. Drop the un-hide block.

### Image / measure / weight rules — out of scope
The 8 normalize rules from vf were about choosing the primary measure (length vs capacity vs inside_diameter). Phase 1 has no measure column at all. Bulb wattage, fitting inside_diameter, volume capacity rules — **not used here**. Save for Phase 2/3.

### i18n color/material maps — out of scope
Phase 1 has no color/material cols. Save the translation maps.

### FAB-recovery (regex-extract dims from features text) — out of scope
No measure cols.

### Image sideload — out of scope
No image URL cols in Phase 1.

### `splitMeasureUnit`, `pickFirstAttr`, KEY_UNIT_MAP — out of scope
Phase 1 has no numeric attribute cols requiring unit normalization. (Liter, CC are dimensionless — Walmart accepts the raw number.)

## ❌ NEW RULES TO ESTABLISH

### Fitment row explosion
For each MPN, enumerate one row per resolved vehicle config. Source priority:
1. **VCdb direct lookup** (canonical) — preferred. VCdb integration was deferred in vf; now mandatory.
2. **compatibleCars text parse** — fallback. Each `Make Model (YYYY-YYYY)` becomes 1 row (or N rows if we explode the year range — open question).
3. **Source attributes** `vehicleYear`, `vehicleMake`, `vehicleModel` if compatibleCars is empty.

### Year handling — range vs explosion
Template accepts `Year(YYYY) or Year Range (YYYY-YYYY)`. Two valid representations:
- **Compact**: keep `(1977-1981)` as a single range → 1 row.
- **Exploded**: emit 5 rows for years 1977, 1978, 1979, 1980, 1981.

**Decision needed from user.** Compact is fewer rows + matches source data shape; exploded is more standard for relational fitment systems. Engine-spec attributes (Cylinders/Liter/FuelType) might **vary within a year range** for the same Make/Model — in which case exploded is the only correct shape.

### Engine/body attributes — VCdb-first
Cols 9-20 require trim-level vehicle data we don't have in vf cells. Options:
- A: Leave them blank (template marks them Optional). Ship MPN × Year × Make × Model only.
- B: Wire up VCdb lookup (~30-45 min per vf checkpoint). Adds full trim coverage.
- C: Partial: cherry-pick attributes where source data already has them (e.g. some Dorman MPNs have `vehicle_mount_location` → Position).

### Extended attribute cols (S, T)
Two cols with header-dropdown picking from `{CylinderHeadType, EngineDesignation, BodyType, BodyNumDoors}`. Template defaults to BodyType + BodyNumDoors. We can switch the picks.

**Decision needed from user.** Suggest leaving as template default unless data favors a different pair.

## Notes for future agents

- **Adding a new brand**: same 4-line `brands.config.js` pattern from vf. Once Phase 1 pipeline is built, brand additions stay fast.
- **Adding a new column**: only 3 places — `20-fill.js`, `30-assemble.js`, `40-verify.js` — far simpler than vf because no hidden-col gymnastics.
- **Trust check**: re-implement vf's `100-validate-combined.js` against the manifest. Phase 1 has only 21 cols so the cell count will be lower but the test is structurally identical.
