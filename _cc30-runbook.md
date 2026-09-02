# CC30 Pipeline — Runbook

> How to process a new JEGS eBay cc30 format Excel file into normalized product data.

---

## What This Pipeline Does

Converts a JEGS eBay cc30 flat-attribute Excel export (one row per product×attribute, ~24K rows)
into **~556 normalized product records** with structured columns and curated attributes.

**Output:** JSON + Excel with fields: Part Number, Brand, Part Type, Image, original_title,
fit_type, final_attributes[], fitment_extracted{}, and more.

---

## Input Format

| Field | Value |
|---|---|
| File location | `~/Downloads/` — download from source before running |
| Sheet name | `Extracted Rows` (exact, case-sensitive) |
| Row structure | One row per product×attribute key |
| Column names | `Input Row`, `productbrand`, `mpn`, `site`, `url`, `key`, `raw_key`, `value`, `source`, `explanation`, `evidence_text`, `confidence`, `match_mode`, `page_type`, `status` |

---

## Pipeline Steps

| Step ID | Transform | What it does |
|---|---|---|
| `group-attributes` | `cc30-group-attributes` | Groups 24K flat rows by `Input Row` → N products. Builds `original_attributes[]` and `raw_attributes[]`. Discards: `confidence`, `match_mode`, `page_type`, `status` columns. |
| `extract-columns` | `cc30-extract-columns` | Pulls Part Type (fallback: `part_type` → `line` → `part_category`), Image (prepends `https://www.jegs.com` to relative paths), `original_title`, `raw_fitment[]`, `fit_type` (normalized), `fitment_extracted{}` into top-level columns. |
| `filter-attributes` | `cc30-filter-attributes` | Blacklist approach: removes extracted/metadata/fitment/feature/regulatory keys → produces `final_attributes[]` with only physical/technical specs. |
| `sideload-part-types` | `cc30-sideload-part-types` | Applies manual JSON overrides for Part Type, Image, and product patches. Promotes `fit_type` into `final_attributes` as "Part Fitment". |

---

## Running for a New File

### Step 1 — Create a run directory

```bash
mkdir -p runs/jegs-cc30-<date>
```

Example: `runs/jegs-cc30-apr03`

### Step 2 — Create `run.config.js`

Copy and update from the reference run:

```bash
cp runs/jegs-cc30-mar26/run.config.js runs/jegs-cc30-<date>/run.config.js
```

Then edit the new `run.config.js`:
- Update `input.file` to the new Excel file path
- Update `input.sheet` if the sheet name differs (usually `"Extracted Rows"`)
- Update `name` and `description`

Minimal config structure:
```js
module.exports = {
  name: 'Jegs cc30 — <Label>',
  description: '<description>',
  input: {
    file: '~/Downloads/<new-file>.xlsx',
    sheet: 'Extracted Rows',
  },
  steps: [
    { id: 'group-attributes',    fn: 'cc30-group-attributes',    name: 'Group Attributes by Product', config: { columnMap: { productbrand: 'Brand', mpn: 'Part Number', site: 'brand_site' }, discardColumns: ['confidence', 'match_mode', 'page_type', 'status'], groupBy: 'Input Row' } },
    { id: 'extract-columns',     fn: 'cc30-extract-columns',     name: 'Extract Columns from Attributes' },
    { id: 'filter-attributes',   fn: 'cc30-filter-attributes',   name: 'Filter to Final Attributes' },
    { id: 'sideload-part-types', fn: 'cc30-sideload-part-types', name: 'Sideload Part Type Overrides', config: { file: 'part-type-overrides.json', patchFile: 'product-patches.json', imageFile: 'image-overrides.json' } },
  ],
};
```

### Step 3 — Create required sideload files

These must exist in the run directory (even empty) or `sideload-part-types` will throw:

```bash
cd runs/jegs-cc30-<date>

echo '{ "overrides": {} }' > part-type-overrides.json
echo '{ "patches": {} }'   > product-patches.json
echo '{ "overrides": {} }' > image-overrides.json
```

### Step 4 — Test with a small sample

```bash
node pipeline/run.js runs/jegs-cc30-<date> --limit 3
```

Verify output — spot check 2-3 records:
```bash
node -e "const d = require('./runs/jegs-cc30-<date>/data/sideload-part-types.json'); console.log(d.slice(0,2).map(x => ({ pn: x['Part Number'], pt: x['Part Type'], img: (x['Image']||'').slice(0,60), attrs: x.final_attributes?.length })))"
```

What to check:
- `Part Type` is a readable string (not blank for all items)
- `Image` starts with `https://` (not a relative path)
- `final_attributes` is an array with a reasonable count (not empty, not `[object Object]`)
- No `[object Object]` in any field

### Step 5 — Full run

```bash
node pipeline/run.js runs/jegs-cc30-<date>
```

### Step 6 — Verify the Excel output

The Excel is auto-generated at:
```
runs/jegs-cc30-<date>/output/<slug>-<YYYY-MM-DD>.xlsx
```

Open it and check:
- Column values are readable strings/numbers
- No cells show `[object Object]`
- Arrays are newline-separated in cells (not raw JSON)
- Cell length is within 32,767 chars (check long description fields)

---

## Resuming / Re-running Steps

The pipeline is idempotent — re-running a step skips it if its output JSON already exists.

To force a step to re-run, delete its data file first:
```bash
rm runs/jegs-cc30-<date>/data/<step-id>.json
node pipeline/run.js runs/jegs-cc30-<date> --step <step-id>
```

To resume from a step (using prior steps' cached output):
```bash
node pipeline/run.js runs/jegs-cc30-<date> --from <step-id>
```

Step IDs: `group-attributes`, `extract-columns`, `filter-attributes`, `sideload-part-types`

---

## Known Data Gaps (from mar26 run)

| Field | Gap | Notes |
|---|---|---|
| Part Type | ~49/556 products | No `part_type`, `line`, or `part_category` in source data. Fill manually via `part-type-overrides.json`. |
| Image | ~140/556 products | No `image_url` in source. Fill via `image-overrides.json` using URLs from older runs or manual lookup. |
| fit_type | Inconsistent values | Values like "Direct-Fit" vs "Direct Fit" or "Specific" vs "Vehicle-Specific" — normalize manually if needed. |

---

## Sideload File Formats

### `part-type-overrides.json`
```json
{
  "overrides": {
    "555-11140": "Headlight Switch",
    "555-12345": "Oil Filter"
  }
}
```

### `image-overrides.json`
```json
{
  "overrides": {
    "555-11140": "https://www.jegs.com/images/product/...",
    "555-12345": "https://www.jegs.com/images/product/..."
  }
}
```

### `product-patches.json`
```json
{
  "patches": {
    "555-11140": {
      "original_title": "JEGS Headlight Switch",
      "fit_type": "Universal"
    }
  }
}
```

---

## Output Column Reference

| Column | Source | Notes |
|---|---|---|
| `Part Number` | `mpn` column | Primary key |
| `Brand` | `productbrand` column | Always "JEGS" |
| `Part Type` | `part_type` attr (fallback: `line`, `part_category`) | |
| `Image` | `image_url` attr | `https://www.jegs.com` prepended to relative paths |
| `original_title` | `title` attr | Raw title from source |
| `fit_type` | Normalized from `universal`/`universal_or_specific_fit`/`direct_fit` attrs | "Universal" / "Vehicle-Specific" / "Direct Fit" |
| `original_attributes[]` | All attrs from source | Full detail with source, explanation, evidence_text |
| `raw_attributes[]` | Simplified from original_attributes | `[{key, value}]` pairs using raw_key |
| `final_attributes[]` | Filtered from original_attributes | Physical/technical specs only; fit_type added as "Part Fitment" |
| `fitment_extracted{}` | make, model, engine, transmission attrs | Dict of vehicle compatibility keys |
| `raw_fitment[]` | All `fitment` attr values | Raw vehicle compatibility strings |
| `url` | `url` column | Source product page URL |

---

## Reference Run

- **Run ID:** `jegs-cc30-mar26`
- **Input:** `~/Downloads/Jegs eBay Test 2.16.26_JEGS_EBAY_cc30.xlsx` — 24,531 rows
- **Output:** `runs/jegs-cc30-mar26/output/jegs-cc30-extracted-attributes-2026-03-25.xlsx` — 556 products
- **Config:** `runs/jegs-cc30-mar26/run.config.js`
