# Issues Encountered — 2026-03-30

## Bugs Fixed This Session

### Bug 1: Data appended at wrong row in v1 (FIXED)
- **Symptom**: Output rows were written starting at row 1001 instead of row 6
- **Root cause**: `ws.addRow()` in ExcelJS appends after the last existing row. The template already has 1,000 placeholder rows, so `addRow()` started at row 1001.
- **Fix**: Switch to `ws.getRow(DATA_START_ROW + written)` with explicit row numbers. Add clearing loop to null out rows 6–1000 first.
- **Status**: Fixed in v2, carried forward in v3.

### Bug 2: `items_included` key with 0% coverage (FIXED)
- **Symptom**: Col 48 (Items Included) was always empty in v2
- **Root cause**: The primary key in the fallback chain was `items_included` — but this key never appears in the dataset (confirmed by alias audit: 0 occurrences). Actual keys are `item_included`, `include`, `package_content` (each ~4%) plus 20+ `*_included` boolean keys.
- **Fix**: Removed `items_included` as primary (dead key). Added `parseItemsIncluded()` that checks direct text keys first, then collects all `*_included=Yes` booleans.
- **Status**: Fixed in v3. Col 48 fill rate went from ~4% to 19.2%.

### Bug 3: `color_family` fallback with 0% coverage (FIXED)
- **Symptom**: Col 44 (Color) fallback chain included `color_family` which never appears
- **Root cause**: `color_family` was defined as an expected key but the actual dataset never uses it
- **Fix**: Removed `color_family`; added `color_finish` (6.1%), `hose_color` (2.5%), `caliper_color` (2.2%)
- **Status**: Fixed in v3.

### Bug 4: Condition hardcoded "New" for all rows (FIXED)
- **Symptom**: 34 rows (15 Used, 19 Remanufactured) were incorrectly labeled "New" in v2
- **Root cause**: `cols[25]` was hardcoded to `'New'`. The `condition` attribute (98% coverage) was ignored.
- **Fix**: Added `parseCondition()` that reads the `condition` attr, maps to Walmart-accepted values ("New"/"Used"/"Remanufactured"). Also kept `remanufactured=Yes` override.
- **Status**: Fixed in v3. Distribution: 1,193 New / 15 Used / 19 Remanufactured.

### Bug 5: Vehicle Make/Model/Year empty when fitment text absent (FIXED)
- **Symptom**: Cols 63, 64, 66 empty for rows where the raw fitment field is blank but `vehicle_make`/`vehicle_model`/`vehicle_year` attributes exist
- **Root cause**: Vehicle fields were only populated from `parseFitment()` output, which parses the `fitment` text column. If that column is empty, all three vehicle cols were empty.
- **Fix**: Added attr supplement: if `parseFitment()` returns empty, fall back to `vehicle_make`, `vehicle_model`, `vehicle_year` direct attrs.
- **Status**: Fixed in v3. Makes col fill rate: 62% (up from lower).

## Known Remaining Issues

### Issue A: "From Pump" in col 65 (Vehicle Mount Location) — LOW
- Hose products use `position` attr which contains values like "From Pump" for hose routing. This populates col 65 which Walmart expects to contain body-position values like "Front"/"Rear".
- Not wrong per se, but unusual. Acceptable for now — better than empty.

### Issue B: ~8% rows missing main image URL — DATA GAP
- ~259 rows have no `image_url` attribute or the URL is not HTTP. Cannot fix without external data sourcing.
- Known from prior audit. Unchanged.

### Issue C: Col 11 (Shipping Weight) 13.9% fill rate — DATA GAP
- Source data only provides `shipping_weight` or `weight` on ~20% of rows total.
- Cannot improve without external product data enrichment.

## Query/Script Issues

### Query-vcdb.js: Relaxed model lookup showed only recent models (FIXED)
- **Symptom**: When a VCDB match failed, the "relaxed" fallback showed only 2024-2026 models because `ORDER BY YearID DESC LIMIT 50` surfaced only new models
- **Fix**: Changed relaxed fallback to use `LIKE model_prefix%` + `ORDER BY ModelName` instead, finding nearest alphabetical models regardless of year
