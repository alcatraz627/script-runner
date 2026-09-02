# AEP Catalog V9: flatten to one enhancement-ready sheet

Source: `/Users/alcatraz627/Downloads/AEP Catalog V9 - Fitment Data.xlsx`

Goal: one sheet, one header row, no section bands, fitment colocated with its part, ready to drop into `enhancement-product`.

## What the workbook actually is (measured, not assumed)

Every number below came out of the probe scripts run against the real file.

| Sheet | Rows | Cols | What it holds |
|---|---|---|---|
| Catalog | 910 | 18 | 12 section-band rows plus **898 unique parts** |
| Fitment | 3,847 | 13 | vehicle-application rows for **352 distinct parts** |
| Not Found | 546 | 10 | the 546 parts with no OEM hit, plus a `Reason` |

### The join

`Catalog.ITEM` to `Fitment.ITEM`, one to many.

- `ITEM` is unique in Catalog. 898 distinct values across 898 data rows, **zero duplicates**, so the join cannot fan out the catalog.
- Every one of the 352 Fitment `ITEM` values exists in Catalog. **Zero orphans.**
- 546 Catalog items are `Status = "Not found"` and have no fitment rows at all. A further 4 have a fitment row that publishes no vehicle, so **550 output rows carry `[]`** and only **348 carry entries**. Nothing is silently dropped.
- Fitment rows per item: min 1, median 7, max 148.
- Six Fitment columns are item-level provenance rather than per-vehicle data, so they stay once on the catalog row and are not repeated inside every dict: `Searched As`, `Source Site`, `Part Number (site)`, `Product Title`, `Source URL`, and `Reference`. Each agrees with its Catalog counterpart on **352 of 352** items (`Reference` against `ALTERNATE REFERENCE`), with no item carrying two distinct values. The validator re-proves all six on every run rather than trusting this paragraph.

### The section bands

12 rows carry `ENGINE FAMILY` plus `Status = "— section —"` and nothing else:

`CHRYSLER/DODGE · CUMMINS · FORD · GENERAL MOTORS · HARDWARE · HONDA · HYUNDAI/KIA · JEEP · NISSAN · SUBARU · TOYOTA · VOLKSWAGEN/AUDI`

They are a forward-fill band over the rows beneath them. Two checks make the fill safe:

- Zero data rows sit above the first band, so nothing forward-fills to null.
- Every `ENGINE FAMILY` value maps to exactly **one** section (0 conflicts across 67 distinct families, or 69 before trimming), so the band is a genuine parent level rather than a re-slicing of the same axis.

**New column name, defaulted to `OEM GROUP`.** `ENGINE FAMILY` is the finer level (`FORD 5.0 COYOTE`). The band is the OEM brand above it. `MANUFACTURER` was the runner-up, but `HARDWARE` is not a manufacturer. Say the word and I rename it in one constant.

## Output sheet: 23 columns, one header row, 898 rows

Order runs identity, then source data, then status, then provenance, then fitment.

| # | Column | Origin |
|---|---|---|
| 1 | `OEM GROUP` | **new**, forward-filled section band |
| 2 | `ENGINE FAMILY` | Catalog |
| 3 | `PART CATEGORY` | Catalog |
| 4 | `ITEM` | Catalog (join key) |
| 5 | `DESCRIPTION` | Catalog |
| 6 | `PURCHASE DESCRIPTION` | Catalog |
| 7 | `FEATURES AND BENEFITS` | Catalog |
| 8 | `NOTES` | Catalog |
| 9 | `ALTERNATE REFERENCE` | Catalog |
| 10 | `PRIMARY COO` | Catalog |
| 11 | `Status` | Catalog (`Found` / `Not found`; section sentinel gone) |
| 12 | `Not Found Reason` | **new**, folded in from the `Not Found` sheet |
| 13 | `Searched As` | Catalog |
| 14 | `Search Column` | Catalog |
| 15 | `Source Site` | Catalog |
| 16 | `Part Number (site)` | Catalog |
| 17 | `Product Title` | Catalog |
| 18 | `Source URL` | Catalog |
| 19 | `Year Range` | Catalog |
| 20 | `Vehicles` | Catalog, their original count, kept for audit |
| 21 | `Fitment Count` | **new**, recomputed from real fitment rows |
| 22 | `Fitment Note` | **new**, the "no fitment published" sentinel lifted out |
| 23 | `Fitment` | **new**, JSON array of dicts |

### `Fitment` cell shape

```json
[{"years":"2020","make":"Dodge","model":"Journey","trim":"Crossroad","engine":"2.4L L4 - Gas"}]
```

Keys are snake_case. Empty values are omitted rather than emitted as `""`. `options` is included when present. Item-level columns are not repeated inside each dict.

Measured payload size across the 348 items that have fitment: median 803.5 chars, **max 16,441** (item `5.7HEMILIFR`). The Excel cell cap is 32,767, so nothing comes near it and no truncation path fires. The verify script still asserts the cap, because a future data drop could change that.

### The four sentinel rows

`47DPCAMRT`, `37773-P8B-305AEP`, `26250-2E031`, `24900-3C158` each have one Fitment row whose vehicle fields are all blank and whose `Options` reads `"Part confirmed on site — no fitment published"`. The original Catalog agrees: it says `Vehicles = 0` for all four.

So those do **not** become a fake fitment entry. They get `Fitment = []`, `Fitment Count = 0`, and the sentence lands in `Fitment Note`. For the other 348 matched items, `Vehicles` already equals the real row count exactly, so the recomputed `Fitment Count` and their number agree everywhere.

### Data quality carried forward, not laundered

Some source sites publish fitment in a different shape and the scrape kept it verbatim. `fordpartsgiant.com` rows put the year range inside `Model` (`"2021-2023, 2011-2019 Ford F-150"`) and leave `Years` and `Make` blank. Across the sheet, 78 rows have blank `Years`, 67 blank `Make`, 1,905 blank `Trim / Body`. These pass through as-is. Normalizing them is a judgment call about vehicle data, not a flattening step, so it stays out of this pass unless you want it.

### Whitespace is normalised, and the join key is unaffected

445 source cells carry leading or trailing whitespace and are trimmed on the way out: 282 in Catalog, mostly `ENGINE FAMILY` and `FEATURES AND BENEFITS`, and 163 in Not Found. Content is preserved; a `NOTES` cell holding a single space becomes empty.

The join key is untouched by this. No `ITEM` in any of the three sheets carries whitespace, and 898 distinct trimmed equals 898 distinct untrimmed, so trimming changes zero matches. The validator asserts the output is trim-clean as an absolute property, because every value comparison trims both sides and so cannot see the difference.

## The `Not Found` sheet is worth exactly one column

Its 10 columns are 9 copies of Catalog columns plus `Reason`. Verified: all 546 `ITEM` values exist in Catalog, all 546 shared cells match Catalog byte for byte, and the 546 map one to one onto the Catalog rows with `Status = "Not found"`. No row and no fact in it is missing from Catalog, except `Reason`, which has **5 distinct values**:

| Rows | Reason, verbatim |
|---|---|
| 209 | No OEM cross-reference supplied; the AEP item number is not listed on the OEM site |
| 196 | Neither the OEM reference nor the AEP item number is listed on the OEM site |
| 129 | Supplier's own catalogue number (oversize/coated) — not an OEM number, no dealer site lists it |
| 9 | No Hardware parts site exists to search — generic hardware / engine brand with no OEM dealer catalogue |
| 3 | No Cummins parts site exists to search — generic hardware / engine brand with no OEM dealer catalogue |

**Verdict: fold `Reason` in as `Not Found Reason`, then drop the sheet.** It tells the enhancement module *why* a part has no OEM data, which separates "we failed to scrape it" from "there is nothing to scrape". Worth having, and it costs one column. Everything else in that sheet is duplication.

## Work plan

| # | Step | Check that closes it |
|---|---|---|
| 1 | Scaffold `aep-catalog-v9/{input,output,data,docs,scripts}` per the `walmart-*` sibling layout | dir exists |
| 2 | `scripts/01-build-single-sheet.js`, consts at top, forward-fill, aggregate, fold Reason | reads clean |
| 3 | Dry-run `--limit 3`, print every field with its **type** | no `[object Object]`, JSON reparses |
| 4 | Full run to `output/AEP-Catalog-V9-Flat.xlsx` | writes |
| 5 | `scripts/02-verify-output.js`, **reading the xlsx back** | assertions below |
| 6 | Consolidate into the one-shot `build-aep-single-sheet.js` plus a README | one-shot rerun reproduces the same row count |

### Verify assertions (step 5, run against the written file, not the in-memory object)

1. Exactly 1 sheet. Header on row 1. 23 columns in the declared order.
2. 898 data rows. `ITEM` unique. No row where `Status === "— section —"`.
3. `OEM GROUP` non-empty on every row. Its 12 distinct values match the source bands. Per-group row counts match the source tally: `CHRYSLER/DODGE 90 · CUMMINS 3 · FORD 175 · GENERAL MOTORS 167 · HARDWARE 9 · HONDA 18 · HYUNDAI/KIA 233 · JEEP 26 · NISSAN 21 · SUBARU 69 · TOYOTA 81 · VOLKSWAGEN/AUDI 6`.
4. `JSON.parse` every non-empty `Fitment` cell. Sum of array lengths equals 3,843 (3,847 source rows minus the 4 sentinels).
5. **348** rows have a non-empty `Fitment`. **550** carry `[]`. Of those 550, **546** have a `Not Found Reason` and **4** do not: the scrape-note sentinels, which are `Status = "Found"` with `Fitment Count = 0`. The validator prints these four numbers on every run.

   The trap this replaces: "no fitment" is the obvious downstream filter, it returns 550 rather than 546, and four of those look Found with no reason attached.
6. Every cell is 32,767 chars or fewer.
7. Spot-check 3 items against the source workbook end to end, printed side by side for eyeball.

### Ingest assertions (step 7, run through the enhancement backend's own reader)

Our verification proves the file matches the source. It does not prove the target can read it. `scripts/03-verify-against-enhancement-ingest.js` closes that by calling the real functions in `enhancement-product/backend/lib/importer/excel.py`:

- `get_excel_file_sheets` returns exactly `["Catalog"]`.
- `get_excel_file_headers` returns all 23 names. Their rule at `lib/importer/excel.py:151` drops any column pandas labels `Unnamed: N`, which is what a blank header cell becomes, and pandas silently renames a duplicate header to `X.1`. Both would lose a column with no error, so this is asserted rather than assumed.
- `get_excel_file_metadata(read_rows=True, column_fill_stats=True)` streams rows and computes fill stats over all 898 rows.
- A streamed `Fitment` cell still parses as JSON after passing through their reader.

Result on the current build: 14 of 14.

## Not doing (say the word and I will)

- Normalizing the Ford-style rows where `Model` holds the years, into real year/make/model triples.
- A human-readable `Fitment Summary` text column alongside the JSON. Cheap to add. The ask said JSON dicts, so JSON dicts is what ships.
- Uploading anything to `enhancement-product`. Out of scope by your instruction.
