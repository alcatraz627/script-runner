# Overfitting / Underfitting Audit — fill-walmart-loadsheet.js

## Definitions

**Overfitting**: Using an attribute key that appears to match the target semantically but produces wrong or misleading data. Examples from data:
- O1: Col 25 hardcoded "New" even though `condition=Used` is present in 15 rows
- O2: `items_included` as primary key for col 48 — the key literally never appears in the dataset (0%)
- O3: `color_family` in the color fallback chain — 0% coverage, purely illusory

**Underfitting**: Failing to collect data that exists in the source, leaving columns empty when they shouldn't be. Examples from data:
- U1: `vehicle_make=Dodge` / `vehicle_year=2006,2007,2008` on row 817423 — ignored because only `parseFitment()` text was used
- U2: `brake_pad_material=Ceramic` on row 16-1283 — ignored because only `material` was checked
- U3: `mounting_hardware_included=No` on rows XKMI24011-1A/1C — never collected; col 48 empty

---

## Overfitting Cases

| # | Column | Key / Behavior | Coverage | Issue |
|---|--------|---------------|----------|-------|
| O1 | col 25 Condition | Hardcoded `"New"` | N/A | 34 rows with wrong condition shipped |
| O2 | col 48 Items Included | `items_included` as primary | 0% | Dead key; always falls through |
| O3 | col 44 Color | `color_family` in fallback | 0% | Dead key; gives false confidence |

---

## Underfitting Cases

| # | Column | Missing Keys | Coverage | Impact |
|---|--------|-------------|----------|--------|
| U1 | col 63/64/66 Vehicle Make/Model/Year | `vehicle_make`, `vehicle_model`, `vehicle_year` | 28.8%, 26.2%, 16.5% | Many rows with no fitment text had vehicle attrs ignored |
| U2 | col 50 Material | `brake_pad_material`, `rotor_material`, `hose_material`, `disc_material`, `pad_material`, `friction_material_composition`, `system_material`, `muffler_material` | 2–5% each | ~62% of material data beyond generic `material` key lost |
| U3 | col 48 Items Included | `hardware_included` (4.4%), `mounting_hardware_included` (10.6%), `gasket_included`, `shim_included`, `pad_shim_included` + 16 more `*_included` booleans | 2–11% each | Col nearly always empty in v2 |
| U4 | col 11 Shipping Weight | `weight` (10.1%) | 10.1% | When `shipping_weight` absent, `weight` could fill — wasn't used |
| U5 | col 33 Additional Features | `fitnote` (3.5%), `compatibility` (10.9%) | 3.5%, 10.9% | Fitment notes and compatibility text dropped |
| U6 | col 59 Size | `tire_size` (3.9%), compound tire string (`section_width`+`aspect_ratio`+`wheel_diameter`) | — | Tire-specific sizing never populated |

---

## Fixes Applied in v3

| Fix | What Changed |
|-----|-------------|
| F1 | `parseCondition()`: reads `condition` attr → maps to "New"/"Used"/"Remanufactured" |
| F2 | `parseItemsIncluded()`: checks direct text keys first; collects all `*_included=Yes` booleans |
| F3 | `parseMaterial()`: merges 10 material-type keys, semicolon-joined, deduped |
| F4 | col 44: removed `color_family`, added `color_finish`/`hose_color`/`caliper_color` |
| F5 | col 11: added `weight` fallback after `shipping_weight` |
| F6 | col 33: added `fitnote`, `compatibility`; removed `style`/`duty_type` (product-type descriptors, not features) |
| F7 | cols 63/64/66: supplement from `vehicle_make`/`vehicle_model`/`vehicle_year` attrs when fitment parser returns empty |
| F8 | col 59: added `tire_size`, compound tire string builder (`{width}/{aspect}R{diameter}`) |
| F9 | col 51: added `vendor_part_number` to model number fallback chain |
| F10 | col 46: changed `dimensions` → `firstAttr('dimensions', 'dimension')` to catch both keys |
