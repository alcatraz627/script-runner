# Reference Data Schemas (probed 2026-04-30)

All probes done with streaming readers — no sheet was loaded fully into memory.

## 1. Source Enhancement Export — `~/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx`

- **Rows:** 1,252
- **Columns (12):** `title`, `Part Number`, `Part Type`, `Brand`, `attributes`,
  `Description`, `fitment`, `Title`, `$token_usage`, `id`, `processed`,
  `Features & Benefits`
- **Brand value seen:** `ACDelco` (one token, no space). 64 rows.
- **`attributes`** is pipe-delimited `key: value | key: value` (lowercase keys).
  Keys observed in one ACDelco row: `diameter`, `country_of_origin_primary`,
  `bulb_color`, `availability`, `wiring_harness_included`, `width_in`, `weight_lb`,
  `wattage`, `voltage`, `terminal_type`, `programming_required`,
  `oem_interchange_number`, `mpn`, `length_mm`, `length_in`, `height_in`,
  `diameter_mm`, `diameter_in`, `alternate_inventory_number`, `width`, `weight_lb`,
  `warranty_special`, `voltage`, `upc`, `terminal_quantity`, …
- **`fitment`** is newline-`\n`-separated free text fitment lines, e.g.
  `1977 Buick Century Base 3.8L 6cyl \n 1977, 1978, 1979, 1980, 1981 Buick Electra Base \n …`
- **`Features & Benefits`** is a numbered string `1. … \n 2. …`.

## 2. Brand Mapping — `Walmart_Brand Mapping_vf.xlsx`

- **Sheet:** `Sheet1`, **Rows:** 2,624
- **Columns:** `Input Brand`, `Part Number`, `Mapped?`, `Match Method`,
  `Match Confidence`, `Parent Company Code`, `Brand Code`
- Sample row: `Sixity Auto | 4096769986 | true | heuristic_exact | high | FQRP | FQRS`
- **Question:** "AAIA Brand ID" — is that `Brand Code`, `Parent Company Code`, or both?
  *(see QUESTIONS.md Q3)*
- **Lookup key:** `Part Number` (likely string; sample is numeric — case mismatch risk).

## 3. Enhanced Content — `Walmart_Enhanced Content_vf.xlsx`

- **Sheet:** `Sheet1`, **Rows:** 1,252 (matches source row count)
- **Columns:** `Input Brand`, `Part Number`, `Part Type`, `Title`, `Description`,
  `Features and Benefits`
- **Question:** is this a *replacement* for source's `Title`/`Description`/`Features & Benefits`,
  or a *fallback*? *(QUESTIONS.md Q4)*

## 4. Taxonomy Mapping — `Walmart_Taxonomy Mapping_vf.xlsx`

- **Sheets:**
  - `PCdb Mapping` — 2,624 rows: `Brand`, `Part Number`, `CategoryID`,
    `CategoryName`, `SubCategoryID`, `SubCategoryName`, `PartTerminologyID`,
    `PartTerminologyName`
  - `Walmart Taxonomy Mapping` — 2,624 rows: PCdb cols + `Taxonomy Mapped?`,
    `Mapping Confidence`, `Level 2`, `Level 3`, `Level 4`, `Engine Rationale`
- **PartTerminologyID** lives on both sheets. Use **PCdb sheet** as primary
  (source per user: "look up (4. Taxonomy)"); Walmart Taxonomy adds confidence/levels.

## 5. VCdb Mapping — `Walmart_VCdb Mapping_vf.xlsx`

- **Sheet:** `Sheet1`, file size 35 MB → many rows per Part Number
- **Columns:** `Part Number`, `Make Name`, `Model Name`, `SubModel Name`, `Liter`,
  `CC`, `CID`, `Cylinders`, `Block Type`, `Year ID`, `Vehicle Type ID`, `Make ID`,
  `Model ID`, `SubModel ID`, `EngineBase ID`, `Raw Content`
- One row per fitment combination; multiple per Part Number.
- **Use:** could power Vehicle Fitment Type accuracy AND fill richer fitment columns
  if loadsheet template has them. *(QUESTIONS.md Q5)*

## 6. Full Scrape — `Walmart_Full Scrape_ vf.xlsx` (added 2026-04-30)

- **Sheet:** `Sheet1`, file size 33 MB
- **Rows:** 506,514 — **tall key-value table**, NOT wide
- **Columns (15):** `Input Row`, `productbrand`, `mpn`, `site`, `key`, `raw_key`,
  `value`, `source`, `url`, `explanation`, `evidence_text`, `confidence`,
  `match_mode`, `page_type`, `status`
- **Schema:** each row is one (mpn, key, value) tuple. To reconstruct a product,
  group all rows for a given mpn.
- **Distinct keys:** 3,108
- **Top keys (overall):** `fitment` 448,621 · `title` 3,884 · `brand` 3,797 ·
  `price` 3,477 · `mpn` 2,972 · `image_url` 2,931 · `description` 2,455 ·
  `part_number` 1,495 · `upc` 1,487 · `vehicle_fitment_type` 440 · `part_fitment` 221
- **`part_fitment` value distribution (entire file):** Semi Universal (96),
  Direct Fit (96), Universal (29). 221 rows TOTAL across all brands.
- **ACDelco coverage:** 12,524 rows, 69 distinct MPNs (vs 64 in source — 5 extras
  in scrape).
