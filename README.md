# Versable Scripts — eBay Product Pipeline

Reusable pipeline for importing, transforming, and previewing eBay product data from Excel exports.

## Directory Structure

```
scripts/
├── pipeline/          # Core framework
│   ├── io.js          # Universal xlsx/csv/json reader + writer
│   ├── run.js         # Pipeline orchestrator (runs a run.config.js)
│   └── preview.js     # Serve any pipeline JSON in the preview dashboard
│
├── transforms/        # Reusable transform steps
│   ├── jegs-normalize.js     # Normalize raw JEGS eBay export
│   └── clean-attributes.js   # LLM-powered attribute value cleaner
│
├── runs/              # One folder per data batch
│   ├── jegs-mar-07/   # Mar 07 JEGS batch (normalize only)
│   │   ├── run.config.js
│   │   ├── raw/       # Input xlsx files
│   │   ├── data/      # Intermediate step outputs (raw.json, normalize.json, final.json)
│   │   ├── output/    # Final xlsx export
│   │   └── posters/   # Downloaded poster PNGs
│   │
│   └── jegs-mar-17/   # Mar 17 JEGS batch (normalize + LLM clean)
│       ├── run.config.js
│       ├── raw/
│       ├── data/
│       ├── output/
│       └── posters/
│
├── preview-dashboard/ # Static dashboard UI (served by pipeline/preview.js)
├── parse-excel/       # Python xlsx → JSON converter (legacy input tool)
└── archive/           # Old one-off scripts (kept for reference)
```

---

## Running a Pipeline

### Full run (import + all steps + export)

```bash
node pipeline/run.js runs/jegs-mar-07
```

### Resume from a specific step (skips re-import)

```bash
node pipeline/run.js runs/jegs-mar-17 --from clean-attributes
```

### Run only one step

```bash
node pipeline/run.js runs/jegs-mar-17 --step normalize
```

### Preview the output in the dashboard

```bash
node pipeline/run.js runs/jegs-mar-17 --preview
# or directly:
node pipeline/preview.js --data runs/jegs-mar-17/data/final.json --port 3457
```

### Dry run (print steps, no execution)

```bash
node pipeline/run.js runs/jegs-mar-07 --dry
```

### Limit rows (for testing)

```bash
node pipeline/run.js runs/jegs-mar-07 --limit 10
node pipeline/run.js runs/jegs-mar-07 --slice 0,49
```

---

## Run Config Format (`run.config.js`)

```js
module.exports = {
  name: 'My Run',
  input: { file: './raw/data.xlsx', sheet: 'Sheet1' },
  steps: [
    { id: 'normalize', fn: 'jegs-normalize', config: { brand: 'JEGS' } },
    { id: 'clean-attributes', fn: 'clean-attributes', config: { mode: 'sdk' } },
  ],
  output: './output/final.xlsx',
  preview: {
    port: 3457,
    fields: { sku: 'Part Number', title: 'Title', image: 'Images', specs: 'Attributes Full' },
  },
};
```

Each step's `fn` maps to `transforms/<fn>.js`. The step outputs are saved as `data/<step-id>.json`.

---

## Transforms

### `jegs-normalize`
Normalizes raw JEGS eBay export rows. Handles two attribute formats:
- **JSON array:** `[{"name":"Voltage","value":"12","uom":"volt"}]`
- **Semicolon-separated:** `"Voltage: 12 volt; Amperage: 15 amp"`

Config: `{ brand: 'JEGS' }` — substitutes `{{brand}}` in title templates.

### `clean-attributes`
LLM-powered cleaner. Trims marketing copy bleed from attribute values, drops part-number-as-spec artifacts, removes truncated values.

Config:
- `mode: 'sdk'` — uses `ANTHROPIC_API_KEY` (set env var)
- `mode: 'agent'` — use with `--agent-slices <n>` flag for manual sub-agent batches
- `batchSize: 20` — items per API call (sdk mode)
- `model: 'claude-haiku-4-5-20251001'`

---

## IO Utility (`pipeline/io.js`)

Handles reading and writing xlsx, csv, and json files uniformly.

```bash
# Convert xlsx to json
node pipeline/io.js --from data.xlsx --to out.json --sheet "Sheet1"

# Convert json to xlsx
node pipeline/io.js --from data.json --to out.xlsx

# List sheets
node pipeline/io.js --from data.xlsx --list-sheets

# Limit rows
node pipeline/io.js --from data.xlsx --to out.json --limit 50 --slice 0,49
```

---

## Preview Dashboard

The dashboard (`preview-dashboard/`) auto-detects field names and supports:
- Grid / Table / Compare / Export views
- Search with spec chip click-to-filter
- "Show everything" toggle for non-primary fields
- Row/card selection for compare mode

Field auto-detection order (first match wins):
- `sku`: Part Number, SKU, id
- `title`: Title, name, Product Name
- `image`: Images, Main Image, Image URL
- `desc`: Description, description
- `cat`: Part Type, Category
- `specs`: Attributes Full, Attributes Small, item_specifics

Override with `--fields '{"sku":"SKU","title":"Product Name"}'`.

---

## Notes

- `data/raw.json` = imported sheet, `data/final.json` = last step output (always kept in sync)
- NaN values from xlsx are replaced with `null` automatically
- The `parse-excel/` Python tool is a legacy import path; prefer `pipeline/io.js` (Node.js, no venv)
