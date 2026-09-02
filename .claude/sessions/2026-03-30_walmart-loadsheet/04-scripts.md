# Scripts Written This Session — 2026-03-30

## New Scripts

### `inspect-walmart-excel.js`
Streams the enhancement Excel file, prints sheet names, column headers, row count, and 3 sample rows. Used for initial data exploration.
- Input: `~/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_*.xlsx`
- Output: stdout

### `spot-check-walmart.js`
Samples N evenly-spaced rows, outputs formatted markdown spot-check report.
- Usage: `node spot-check-walmart.js [--count N] [--out report.md]`

### `walmart-dashboard.js`
Seeded RNG + reservoir sampling → self-contained dark-mode HTML product cards.
- Usage: `node walmart-dashboard.js [--count N] [--seed S] [--out file.html]`

### `inspect-walmart-loadsheet.js`
Full workbook read of template, prints all sheets, headers, and sample rows. One-time use for mapping spec.

### `fill-walmart-loadsheet.js` ← MAIN OUTPUT SCRIPT
Maps enhancement Excel → Walmart loadsheet template. Auto-versioned output.
- Helpers: `parseAttrs`, `parseImageUrls`, `parsePrice`, `parseLeadingNumber`, `firstAttr`, `parseWarranty`, `parseUpc`, `parseFitment`, `parseFab`, `parseAdditionalFeatures`, `parseItemsIncluded` (new v3), `parseMaterial` (new v3), `parseCondition` (new v3)
- Output versions: v1 (5-row test, 243KB), v2 (1,252 rows, 1.1MB), v3 (1,252 rows, 1.2MB)
- Usage: `node fill-walmart-loadsheet.js [--limit N]`

### `verify-loadsheet.js`
Reads filled loadsheet, prints spot-check of N data rows against key columns. Auto-detects latest vN.xlsx.
- Usage: `node verify-loadsheet.js [file.xlsx] [N]`

### `audit-walmart-attrs.js`
Streams all rows, collects all unique attribute keys with frequency and 3 sample values. Marks mapped vs unmapped keys, sorted by frequency. Found 200+ unique keys.

### `alias-audit-walmart-attrs.js`
24 semantic groups; up to 5 diverse sample values per key; consolidation recommendations.
- Output: `alias-audit-report.md` (3,319 lines)
- Groups: Part Number/SKU, Product Line/Series, Part Type, Warranty, Vehicle Fitment Type, Vehicle Mount, Package Dimensions, Weight, Color, Material, Finish, Country of Origin, Feature/Note Text, Items Included, Vehicle Make/Model, Quantity, Size, Tire/Wheel, Brake-Specific, Fuel/Pump, Hose, Condition, Prop 65, Shipping

### `query-vcdb.js`
Interactive VCDB SQLite query tool. Validates fitment strings against VCDB.
- Dependency: `better-sqlite3` (installed as devDependency)
- DB: `/Users/alcatraz627/Code/Versable/enhancement-product/backend/vcdb.sqlite`
  - 246,412 vehicles, 548 makes, 19,338 models, 1896–2026 year range
- Modes:
  - `--stats`: DB overview
  - `--lookup "2019 Ford F-150"`: parse + validate fitment string
  - `--make Ford [2019]`: list models for a make
  - `--query "SELECT ..."`: raw SQL
  - `--walmart FILE.xlsx [N]`: validate fitment from Walmart Excel
  - Interactive REPL: `.lookup`, `.make`, `.vehicles`, `.stats`, raw SQL

## Output Files

| File | Size | Description |
|------|------|-------------|
| `walmart-loadsheet-filled-v1.xlsx` | 243KB | 5-row test run |
| `walmart-loadsheet-filled-v2.xlsx` | 1.1MB | Full 1,252 rows, pre-fixes |
| `walmart-loadsheet-filled-v3.xlsx` | 1.2MB | Full 1,252 rows, all fixes applied |
| `alias-audit-report.md` | ~160KB | 24-group alias analysis |
