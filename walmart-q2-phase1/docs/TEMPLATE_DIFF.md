# Template Diff — vf (Mar 30) vs Q2 Phase 1

**Date:** 2026-05-11
**Old:** `~/Downloads/Walmart Loadhseet Mar 30.xlsx` — 3 sheets, 94 cols, 23 hidden, 31 dropdowns
**New:** `walmart-q2-phase1/input/walmart-q2-phase1-template-20260511.xlsx` — 1 sheet, 21 cols, 0 hidden, 2 dropdowns

## Headline: this is a different *shape*, not just a different schema

vf was a **product loadsheet** — one row per MPN, ~94 columns covering title, description, images, weight, attributes, etc., with vehicle compatibility flattened into one `compatibleCars` text cell.

Q2 Phase 1 is a **fitment loadsheet** — one row per `(MPN × vehicle config)`, 21 columns covering nothing but vehicle attributes. Product content is presumably in Phase 2/3.

Implication: a single MPN that fit "Buick Century (1977); Buick Electra (1977-1981); …" used to be one row in vf. In Q2 Phase 1, that same MPN becomes **many** rows — one per resolved vehicle config (and potentially × engine × body × drivetrain).

## Column-by-column map (new → old)

| # | New header (row 3) | Required? | Mapped from vf (cells.*) | Source quality | Notes |
|---|---|---|---|---|---|
| 1 | Action(A or D) | Opt | — | constant 'A' | New concept; default 'A' |
| 2 | Manufacturer Part Number (MPN) | **Req** | `manufacturerPartNumber` | ✅ have | direct |
| 3 | BrandAAIAD | **Req** | `aaiaBrandID` | ✅ have | direct |
| 4 | Year(YYYY) or Year Range (YYYY-YYYY) | **Req** | derived from `compatibleCars` per-vehicle | ⚠️ need explosion | one row per year-range |
| 5 | Make | **Req** | derived from `compatibleCars` per-vehicle | ⚠️ need explosion | |
| 6 | Model | **Req** | derived from `compatibleCars` per-vehicle | ⚠️ need explosion | |
| 7 | Part Terminology Id | **Req** | `partTerminologyID` | ✅ have | direct from taxonomy index |
| 8 | Part Terminology Name | Opt | `specProductType` / partType | ✅ have | derivable from id |
| 9 | SubModel | Opt | not in vf cells | ❌ VCdb only | e.g. "Base", "LT", "XL" |
| 10 | BlockType | Opt | not in vf cells | ❌ VCdb only | "L", "V", "I" (engine block) |
| 11 | Cylinders (int) | Opt | not in vf cells | ❌ VCdb only | |
| 12 | Liter (decimal) | Opt | not in vf cells | ❌ VCdb only | engine displacement |
| 13 | CC (int) | Opt | not in vf cells | ❌ VCdb only | |
| 14 | Position | Opt | partial — `vehicle_mount_location` | ⚠️ rough | front/rear/passenger |
| 15 | FuelType | Opt | not in vf cells | ❌ VCdb only | Gas, Diesel, Flex Fuel |
| 16 | Aspiration | Opt | not in vf cells | ❌ VCdb only | Natural, Turbocharged |
| 17 | DriveType | Opt | not in vf cells | ❌ VCdb only | FWD, RWD, 4WD, AWD |
| 18 | Bed Length (decimal in) | Opt | not in vf cells | ❌ VCdb only | trucks only |
| 19 | BodyType (drop down) | Opt | not in vf cells | ❌ VCdb only | Sedan, Coupe, SUV |
| 20 | BodyNumDoors (drop down) | Opt | not in vf cells | ❌ VCdb only | 2, 4, 5 |
| 21 | Notes | Opt | — | free text | |

## Old columns that **do not exist** in new template

These were filled in vf but have no Q2 home — they're not lost data, they belong in a future Phase 2/3:

- sku, specProductType (as product-content field), productIdType, productId
- brand (string), productName, shortDescription, keyFeatures_0..3
- count, multipackQuantity
- automotive_specialty_part_type, automotivePartsDivision
- mainImageUrl, productSecondaryImageURL (×2)
- ShippingWeight ← **was the consolidation filter key in vf**
- condition, has_written_warranty
- measure, unit, vehicleCategory, vehicle_fitment_type
- features, assembled{Length,Height,Weight,Width}_{measure,unit}
- prop65WarningText, color, dimensions, finish, items_included
- manufacturer, material, modelNumber, netContentStatement, pieceCount, occasion
- warrantyText
- compatibleCars ← **becomes input, not output** — exploded into rows

## New concepts (no vf equivalent)

- **Action(A/D) column** — submission verb; default 'A' (add). vf had no concept of update/delete.
- **Required Year/Make/Model as own cols** — vf rolled these into a single text field.
- **Engine specifics** (BlockType, Cylinders, Liter, CC, Aspiration, FuelType) — not in vf at all.
- **Bed Length, BodyType, BodyNumDoors** — body-style specifics not in vf.
- **Cols 19-20 are user-configurable extended attribute headers** — dropdown picks from `{CylinderHeadType, EngineDesignation, BodyType, BodyNumDoors}`. Template defaults to BodyType + BodyNumDoors. We may want a different pick.

## Dropdowns / data validation

vf had **31 dropdowns** across 23 hidden cols (Walmart spec vocabularies for color, material, condition, etc.).
Q2 Phase 1 has **2 dropdowns** only — for cols 19 & 20, an "extended attribute header" selector with 4 options.

Implication: most Q2 Phase 1 values are free-form (number, string), constrained only by the row-2 instructions. No spec-vocab validator is needed.

## Hidden columns

vf: **23 hidden cols** (cols 1-3, 6-8, 10-26 mixed). Walmart shipped them hidden; vf un-hid when writing.
Q2 Phase 1: **0 hidden cols**. All 21 are visible.

The "hidden-col fix" rule from vf is **not needed** here. Good — one less gotcha.

## Defined names / external lookups

vf: `PTs_LIST` defined name pointed to internal sheet `Hidden_product_content_and_sit!$A$50` (a 626-row lookup table inside the workbook — held part-terminology IDs and other vocabulary).
Q2 Phase 1: `PTs_LIST` defined name STILL EXISTS but now points to **external workbook** `[1]Hidden_product_content_and_sit!$A$50` (the `[1]` prefix means "linked to another file we don't have"). 

⚠️ **Open question**: does Walmart expect us to populate Part Terminology Id from the same canonical PCDB list? The vf taxonomy index from `walmart-vf/data/taxonomy-by-mpn.json` should still apply. We can verify by sampling.

## Estimated volume change

vf combined: 39 rows (after filter).
Q2 Phase 1 combined: **TBD — likely 1000s of rows** depending on explosion factor.

Quick math from ACDelco MPN 25324356 (sample): compatibleCars = "Buick Century (1977); Buick Electra (1977-1981); …" — counting semicolons in a typical entry shows 20-50 vehicles, each ranging 1-5 years. So one MPN ≈ 100-500 fitment rows. ACDelco alone could be 5,000-20,000 rows.

If we need engine-level granularity (Cylinders, Liter, etc.), VCdb explosion multiplies that further.
