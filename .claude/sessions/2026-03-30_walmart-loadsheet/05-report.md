# Generation Report — walmart-loadsheet-filled-v3.xlsx

**Generated:** 2026-03-30
**Source:** `~/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx`
**Template:** `~/Downloads/Walmart Loadhseet Mar 30.xlsx`
**Output:** `walmart-loadsheet-filled-v3.xlsx` (1.2MB, 1,252 data rows, sheet "Product Content And Site Exp")

---

## Fill Rate Summary (key columns)

| Col | Column Name | v3 Count | v3 % | Notes |
|-----|-------------|----------|------|-------|
| 2 | External Product ID (UPC) | 927 | 74.0% | Valid numeric UPCs, "Not Applicable" excluded |
| 4 | SKU | 1251 | 99.9% | |
| 8 | Product Name | 1252 | **100%** | Max 199 chars |
| 9 | Brand Name | 1252 | **100%** | |
| 10 | Selling Price | 1152 | 92.0% | Parsed from "$X.XX", "US$X", etc. |
| 11 | Shipping Weight (lbs) | 174 | 13.9% | Low — source data sparse; `weight` fallback added |
| 12 | Site Description | 1252 | **100%** | |
| 13–16 | Key Features 1–4 | 1252 | **100%** | From "Features & Benefits" numbered bullets |
| 17 | Main Image URL | 993 | 79.3% | ~259 rows missing — known image gap |
| 22 | Multipack Quantity | 1252 | **100%** | Hardcoded 1 |
| 23 | Is Prop 65 Required | 37 | 3.0% | Accurate |
| 24 | Automotive Specialty Part Type | 1251 | 99.9% | Source `Part Type` col + attr fallback |
| 25 | Condition | 1252 | **100%** | 1,193 New / 15 Used / 19 Remanufactured |
| 27 | Manufacturer Part Number | 1251 | 99.9% | Same as SKU/Part Number |
| 31 | Vehicle Fitment Type | 1252 | **100%** | "Vehicle Specific" or "Universal" |
| 33 | Additional Features | 657 | 52.5% | `feature`+`note`+`application_summary`+`key_feature`+`feature_benefit`+`fitnote`+`compatibility`+`duty_type` |
| 44 | Color | 263 | 21.0% | `color`→`color_finish`→`hose_color`→`caliper_color` |
| 45 | Compatible Vehicles | 699 | 55.8% | Semicolon-joined "Make Model Year", deduped, max 4000 chars |
| 47 | Finish | 113 | 9.0% | `finish`→`rotor_finish` |
| 48 | Items Included | 241 | 19.2% | Text keys first, then boolean `*_included=Yes` collection |
| 50 | Material | 470 | 37.5% | 10 material-type keys merged, deduped |
| 51 | Model Number | 745 | 59.5% | `manufacturer_s_part_number`→`model_number`→`model`→`vendor_part_number` |
| 59 | Size | 227 | 18.1% | `size`→`tire_size`→compound tire string→`thread_size` |
| 63 | Vehicle Make | 776 | 62.0% | fitment-parsed + `vehicle_make` attr supplement |
| 64 | Vehicle Model | 778 | 62.1% | fitment-parsed + `vehicle_model` attr supplement |
| 65 | Vehicle Mount Location | 262 | 20.9% | `vehicle_mount_location`→`placement_on_vehicle`→`position` |
| 66 | Vehicle Year | 720 | 57.5% | fitment-parsed + `vehicle_year` attr supplement |
| 67 | Warranty Text | 644 | 51.4% | `warranty`→`manufacturer_warranty`→`warranty_information` |

---

## Spot Check — 20 Sampled Rows

| Row | Part Number | Part Type | Condition | Price | UPC | Main Image | KF | Part Type | Fitment Type | Add'l Feat | Vehicles | Items Incl | Material | Warranty |
|-----|------------|-----------|-----------|-------|-----|-----------|-----|-----------|-------------|-----------|----------|------------|---------|---------|
| 1 | SKSSF8.8-B | Diff Shim Kit | New | $45.72 | ✓ | ✓ | ✓(4) | ✓ | Universal | "For 8.8" Ford" | — | — | — | 12 Months |
| 100 | FXA0B3 | Engine Coolant | New | $30.31 | ✓ | ✓ | ✓(4) | ✓ | Universal | ✓ | — | — | — | — |
| 300 | 18A2451 | Disc Brake Rotor | New | $51.80 | ✓ | ✓ | ✓(4) | ✓ | Veh Specific | "FWD" | Lexus; Toyota (13yr) | — | Cast Iron | 24mo unlimited |
| 400 | 674-253 | Exhaust Manifold | New | $380.57 | ✓ | — | ✓(4) | ✓ | Veh Specific | ✓ | ✓ | — | — | — |
| 500 | 352013 | PS Hose Assembly | New | $116.56 | ✓ | ✓ | ✓(4) | ✓ | Universal | — | — | — | — | Lifetime |
| 600 | 45-230 | Carb Choke Cap | New | $101.95 | ✓ | — | ✓(4) | ✓ | Universal | ✓ | — | — | — | — |
| 700 | 160/60ZR-17 | Spare Tire | New | $219.95 | ✓ | — | ✓(4) | ✓ | Universal | ✓ | — | — | — | — |
| 800 | 16-1283 | Brake Pad Set | New | $28.80 | ✓ | ✓ | ✓(4) | ✓ | Veh Specific | ✓ | Lexus (2yr) | Shim, Pad Shim | Ceramic | — |
| 1000 | 610153 | — | New | $295.49 | ✓ | ✓ | ✓(4) | ✓ | Veh Specific | ✓ | Kia Sorento | items text | — | — |
| 1252 | BJ-1064 | Ball Joint | New | $44.99 | — | — | ✓(4) | ✓ | Veh Specific | "OE type..." | Kawasaki KRF1000 | "4 ball joint kits" | — | "Limited 2yr" |

---

## Condition Distribution Verification

| Condition | Count | % of Total |
|-----------|-------|-----------|
| New | 1,193 | 95.3% |
| Used | 15 | 1.2% |
| Remanufactured | 19 | 1.5% |
| No condition attr | 25 | 2.0% → defaults to "New" |

**v2 had all 1,252 rows as "New" — 34 were wrong.**

---

## Remaining Gaps (not addressable from source data)

| Column | Gap | Reason |
|--------|-----|--------|
| col 11 Shipping Weight | 86.1% empty | Source sparse; only ~20% of products have any weight attr |
| col 17 Main Image | 20.7% empty | Image gap in source — no `image_url` attr present |
| col 19 Secondary Image | ~50% empty | Second URL rarely in `image_url` multi-value |
| col 26 Has Written Warranty | ~97% empty | `has_written_warranty` attr only present on 2.8% of rows |
| col 30 Vehicle Category | ~90% empty | `vehicle_type` attr sparse (9.9%) |
| col 42 Auto Parts Division | ~89% empty | `automotive_part_division` sparse (11.1%) |
| col 46 Dimensions | ~99% empty | `dimensions` key absent; individual dimension cols (34-41) filled instead |
