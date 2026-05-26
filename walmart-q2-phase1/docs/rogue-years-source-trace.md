# Rogue Years — Source Trace

> **TL;DR:** 163 rows in the Walmart-supplied source xlsx
> (`Walmart_VCdb Mapping_vf.xlsx`) had a `Year ID` cell containing a 4-digit
> token outside `[1900, 2030]` — `1800`, `1824`, `1854`, or `2067`. Every
> one traces back to a 4-digit number that appears elsewhere in the same row's
> text columns (Raw Content, Notes, Model Name). Walmart's VCdb-export logic
> appears to naively scrape `\d{4}` matches from those columns into the
> `Year ID` column alongside the real year. The R2.12 token-level
> plausibility filter (`1900–2030`) strips the polluted tokens at fill time
> while preserving the legitimate year sibling, so all 163 rows ship with the
> correct year. The lone `_year-corrections.json` patch for Prenco/36-8062
> (2067→2007) is redundant net of the filter.

---

## 1. Methodology

Two passes, cross-confirmed:

1. **Pipeline-side scan** — streamed `walmart-q2-phase1/data/_raw-content-parsed.jsonl`
   (the materialized R2.4/R2.5 artifact, 465 MB, 433,582 rows). Filtered rows
   whose `vcdbCol["Year ID"]` contained any comma-separated token outside
   `[1900, 2030]`. Output: `/tmp/rogue-years.json`.
2. **Source-side scan** — streamed the original source workbook
   `~/Downloads/Walmart Reference/Walmart_VCdb Mapping_vf.xlsx` directly via
   ExcelJS `WorkbookReader`. Applied the same filter against the `Year ID`
   column. Output: `/tmp/rogue-source-rows.json` (includes full row context
   per hit: all 16 columns + Excel row number).

Both passes returned **163 rows** — identical count, confirming the JSONL is a
faithful materialization of the source xlsx.

The AutoCare SQLite (`~/Downloads/vcdb.sqlite`) was queried separately:

```sql
SELECT * FROM BaseVehicle WHERE YearID IN (1800, 1824, 1854, 2067) LIMIT 20;
```

Returned **zero rows**. The rogue values do **not exist** in AutoCare's
canonical Year/BaseVehicle tables. The corruption is downstream of AutoCare,
specifically in Walmart's xlsx-export pipeline.

## 2. Findings

### 2.1 Group breakdown (34 unique `(partNumber × make × model × badToken)` groups)

| Rogue token | Rows | Source PN | Make/Model context | What the token leaked from | Snippet from `Raw Content` |
|---|---:|---|---|---|---|
| `2067` | 32 | `36-8062` (Prenco boot kit) | Ford Fusion (18) + Mercury Milan (14) | Cross-referenced **related-part number** in Notes | `Notes:Part Note: INCLUDES 36-2067 BOOT KIT~WARNING: MFR INDICATES THIS IS A CA PROP 65 ITEM Quantity Required:4` |
| `1800` | 38 | `823062` (Holley Sniper carb) | Various 6.2L LSx vehicles (Camaro SS, Corvette, Escalade, Hummer H2, GMC Sierra/Yukon Denali, Pontiac G8, etc.) | **Engine RPM lower bound** in Fitment Notes | `Fitment Notes: Single Plane; Dual Quad Carbureted; RPM Power Band 1800-7000; Black w/Sniper Logo;Legal for Racing Use Only` |
| `1800` | 72 | `821051` (Holley Sniper carb) | Various 5.7L / 6L LSx vehicles (Corvette, Camaro Z28, Firebird, CTS-V, Trailblazer SS, GTO, SSR) | Same RPM spec | `Fitment Notes: Single Plane Carbureted; RPM Power Band 1800-7000; Silver w/Sniper Logo;Legal for Racing Use Only` |
| `1854` | 5 | `17755` | International 1854 medium-duty truck | **Truck model number** in description | `International 1854 (1984-1987)` |
| `1824` | 2 | `-80573S` | International 1824 truck | Truck model number | `1979 INTERNATIONAL 1824 \| Liter: 7.3 \| SubModel: BASE \| Aspiration: NATURALLY ASPIRATED \| CUI: 446 \| Engine Type: V8 ( 7.3L / 446 ) \| Engine Vin: -` |
| `1824` | 2 | `-3310S` | International 1824 truck | Truck model number | (same as above) |
| `1800` | 1 | `SB1600` | Mazda 1800 (1971) | **Car model name** | `1971 MAZDA 1800 \| Liter: 1.8 \| SubModel: BASE \| Aspiration: NATURALLY ASPIRATED \| CUI: 110 \| Engine Type: L4 ( 1.8L / 110 ) \| Engine Vin: -` |
| `1800` | 1 | `SB1600` | Volvo 1800 (1973) | Car model name | `Year: 1973 \| Make: Volvo \| Model: 1800 \| Trim: ES Wagon 2-Door \| Engine: 2.0L 1986CC 121Cu. In. l4 GAS OHV Naturally Aspirated` |
| `1800` | 1 | `'SB1600` | Mazda 1800 | Car model name | (same as SB1600 / Mazda) |
| `1800` | 1 | `'SB1600` | Volvo 1800 | Car model name | (same as SB1600 / Volvo) |
| `1800` | 2 | `'SB1100` | Volvo 1800 E (1970, 1972) | Car model name | `1970 VOLVO 1800 \| Liter: 2.0 \| SubModel: E \| Aspiration: NATURALLY ASPIRATED \| CUI: 121 \| Engine Type: L4 ( 2.0L / 121 ) \| Engine Vin: -` |
| `1800` | 1 | `CBB1600` | Mazda 1800 (1971) | Car model name | `Year: 1971 \| Make: Mazda \| Model: 1800 \| Trim: Base Sedan 4-Door \| Engine: 1.8L 1796CC 110Cu. In. l4 GAS SOHC Naturally Aspirated` |
| `1800` | 1 | `CBB1600` | Volvo 1800 (1972) | Car model name | `Year: 1972 \| Make: Volvo \| Model: 1800 \| Trim: E Coupe 2-Door \| Engine: 2.0L 1986CC 121Cu. In. l4 GAS OHV Naturally Aspirated` |
| `1800` | 1 | `CBR1600` | Volvo 1800 (1971) | Car model name | (same shape as CBB1600 / Volvo) |
| `1800` | 1 | `YTX20HL-BS` | Honda GL1800 Valkyrie (2014) | **Motorcycle model name** | `Year: 2014 \| Make: Honda \| Model: Valkyrie 1800 \| Submodel: GL1800C` |
| `1800` | 1 | `3233` | Honda GL1800 Gold Wing (no other year token) | Description text | `For Honda GL 1800 '01-17` |

**Totals**

- Affected rows: **163** (matches checkpoint claim of 162 + 1).
- Rows with at least one valid sibling token: **162** — these keep the real year after R2.12 filtering.
- Rows with only-bad tokens: **1** (`3233`, Honda GL1800 — Honda not in shipped brands, so it wouldn't have shipped anyway).

### 2.2 Single underlying upstream bug

All 5 surface patterns collapse to **one mechanism** in Walmart's export pipeline:

> A naive `\b\d{4}\b` (or similar) regex is run across the row's text columns
> (Raw Content, Notes, Model Name, Fitment Notes), and every match is unioned
> into the `Year ID` column alongside the canonical year.

Evidence:

- **`2067`** comes from the literal substring `36-2067` (a related-part number) in Notes.
- **`1800` (Holley parts)** comes from the literal substring `1800-7000` (engine RPM band) in Fitment Notes — purely an engine spec, no semantic relation to year.
- **`1824`, `1854`** come from International truck model numbers that happen to fall in the 4-digit range.
- **`1800` (Volvo/Mazda/Honda)** comes from car/motorcycle model names that literally contain `1800`.

In every single one of the 162 mixed-token rows, the **canonical year sits beside the polluted token in the same comma-list** (e.g., `"2006, 2067"` for the 2006 Ford Fusion). This proves the canonical year was correctly extracted and only the comma-list aggregation is broken.

## 3. Pipeline response

The downstream Q2 Phase 1 fill (`scripts/20-fill.js:62-146`) handles the corruption with a two-step R2.12 rule:

1. **Manual patch table** (`data/_year-corrections.json`) — token-level rewrite keyed by `(brand, mpn)`. Currently one entry: Prenco/36-8062/2067→2007. Token-level (not full-string) so it works on comma-lists like `"2006, 2067"`.
2. **Plausibility filter** — keep only tokens matching `^\d{4}(-\d{4})?$` with start ≥ 1900 and end ≤ 2030. If all tokens are dropped, the whole row is suppressed (`allYearsFiltered` flag).

```js
function isYearPlausibleStr(yearStr) {
  const m = yearStr && yearStr.match(/^(\d{4})(?:-(\d{4}))?$/);
  if (!m) return false;
  const start = +m[1], end = m[2] ? +m[2] : +m[1];
  return start >= 1900 && end <= 2030;
}
yearStrings = yearStrings.filter(isYearPlausibleStr);
```

Outcome in v6-final:

- **162 rows** retained — bad tokens stripped, real year siblings preserved.
- **1 row** dropped (`3233`, Honda GL1800 — not in shipped brands, so shipped-row delta is zero).
- **0 implausible years** remain in `walmart-loadsheet-combined-q2p1-v6-final.xlsx` (verified by `05-stats-and-validate.js:85`).

## 4. Observations / open items

### 4.1 The Prenco manual patch is redundant net of the filter

For the 32 Prenco/36-8062 rows, both `"2006, 2067"` and `"2007, 2067"` already contained a real year token (2006 or 2007). The plausibility filter alone would have produced byte-identical output by dropping the `2067` token and keeping the sibling. The manual patch (rewriting `2067→2007`) was added when we thought we needed to *recover* the bad-token row's information, but that information was already present.

**Recommendation:** safe to remove the Prenco entry from `_year-corrections.json`, OR keep it as a documented example of the patch surface for future genuine off-by-decade typos. Either is defensible; v6-final shipped with the patch.

### 4.2 Walmart export bug — worth flagging upstream

This is a systematic bug in Walmart's `Walmart_VCdb Mapping_vf.xlsx` export, not a one-off data error. If Walmart ever re-exports or extends the dataset, the same bug will produce new rogue tokens. A short technical note to the export's owner would let them fix the upstream regex and remove the need for any downstream filtering on the consumer side.

### 4.3 Filter is conservative — `> 2030` tokens also handled

The filter `start >= 1900 && end <= 2030` would also catch `7000` from `RPM Power Band 1800-7000` (Holley Sniper) if it ever leaked into Year ID. Spot check: scanning the source for `Year ID` tokens > 2030 returned **zero** outside the 2067 set. The upstream's regex seems to bound at `\d{4}` and cap by some other means, but the filter is correct to be belt-and-suspenders.

## 5. Artifacts

- Per-row JSON (parsed JSONL view): `/tmp/rogue-years.json` (163 entries)
- Per-row JSON (raw source xlsx view): `/tmp/rogue-source-rows.json` (163 entries + 16-column headers)
- Fill-time logic: `walmart-q2-phase1/scripts/20-fill.js:62-146` (R2.12 implementation)
- Manual patch surface: `walmart-q2-phase1/data/_year-corrections.json`
- Source workbook: `~/Downloads/Walmart Reference/Walmart_VCdb Mapping_vf.xlsx` · Sheet1 · `Year ID` column
- Materialized JSONL: `walmart-q2-phase1/data/_raw-content-parsed.jsonl` (465 MB)
