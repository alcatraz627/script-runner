# aep-catalog-v9

Turns the three-sheet AEP Catalog V9 workbook into one flat sheet for the enhancement module.

## Run it

```bash
node aep-catalog-v9/build-aep-flat-sheet.js
```

That is the whole job. It reads the source, writes the sheet, reads the sheet back off disk, and verifies it against the source. Exit code is non-zero if any check fails.

Other modes:

```bash
node aep-catalog-v9/build-aep-flat-sheet.js --limit 3 --dry   # sample 3 items, print every field with its type, write nothing
node aep-catalog-v9/build-aep-flat-sheet.js --src in.xlsx --out out.xlsx
node aep-catalog-v9/build-aep-flat-sheet.js --no-verify
```

For a new drop of the same workbook shape, the paths and sheet names are in the `CONFIG` block at the top of `build-aep-flat-sheet.js`. The output shape, meaning the column list, the join key, the section marker and the fitment field mapping, lives in `scripts/schema.js` and is read by the builder, both verifiers and the ingest probe, so renaming a column is a one-file change rather than five.

## Output

`output/AEP-Catalog-V9-Flat.xlsx`, one sheet named `Catalog`, header on row 1, 898 rows, 23 columns. A JSON sidecar with the same rows sits next to it for anything that would rather not parse xlsx.

Three columns are new: `OEM GROUP` (the old spanning section rows), `Not Found Reason` (folded in from the Not Found sheet), and `Fitment` (a JSON array of dicts, one per vehicle application). `Fitment Count` and `Fitment Note` support the last one.

## Auditing the data

```bash
node aep-catalog-v9/scripts/04-validate.js
node aep-catalog-v9/scripts/04-validate.js --spots 50 --verbose --json audit.json
```

The deep audit, and what `build-aep-flat-sheet.js` runs as its own verify step. It rebuilds the expected answer from the raw source grid rather than reusing any helper the builder used, so a wrong shared helper cannot pass both build and check. That is not a theoretical concern: an earlier inline verify shared its helpers with the builder and passed all 18 of its checks on knowingly broken output. Seven mutations are now caught, each exiting 1. Findings split into FAIL (missing or wrong) and WARN (worth a human look), grouped as structural, completeness, integrity, values, and ingest readiness. It ends with 30 spot checks stratified across the 12 bands, the boundary rows, the fitment extremes, the no-vehicle sentinels, one row per Not Found reason, the odd-shaped scrapes, and the awkward part numbers, each printed source beside output.

Exit code is 1 on any FAIL or any spot-check problem, 0 otherwise.

Two things it reports that are worth knowing rather than fixing. Blank text cells are written as empty strings, not blank cells, so a pandas consumer sees `''` rather than `NaN` and `dropna()` will not drop them. And the row-set split it prints every run is the number people get wrong: 348 rows have fitment, 550 carry `[]`, and 4 of those 550 are `Status = "Found"` with no reason, because the site confirmed the part but published no vehicles.

## Proving it loads

```bash
node aep-catalog-v9/scripts/03-verify-against-enhancement-ingest.js
```

This one does not read the file with our tools. It shells into the enhancement backend venv and calls `get_excel_file_sheets`, `get_excel_file_headers`, and `get_excel_file_metadata` from `lib/importer/excel.py`, the same functions the upload screen calls. It matters because their header rule drops any column pandas labels `Unnamed: N`, which is what a blank header cell becomes. A file can look right in Excel and lose a column on upload.

## What the source looked like, and why the transform is safe

`docs/PLAN.md` carries the measured shape of the workbook, the join evidence, the group-band evidence, and the verification assertions. Read it before changing any rule in `CONFIG`.

## Files

| Path | What it is |
|---|---|
| `build-aep-flat-sheet.js` | the one-shot: build, write, verify |
| `scripts/schema.js` | the one declaration of the output shape; everything else reads it |
| `scripts/01-build-single-sheet.js` | build without verifying, delegates to the one-shot |
| `scripts/02-verify-output.js` | kept as an entry point, delegates to 04 |
| `scripts/03-verify-against-enhancement-ingest.js` | loads the output through the enhancement backend's own reader |
| `scripts/_ingest_probe.py` | the Python half of that, run in the backend venv |
| `scripts/04-validate.js` | the full audit: 55 checks plus 30 stratified spot checks |
| `scripts/_probe.js` | sheet names, dimensions, first rows, merges |
| `scripts/_analyze-1-joins.js` | key cardinality, orphans, duplicate keys, column agreement |
| `scripts/_analyze-2-sections.js` | section forward-fill safety, payload sizes, cell lengths |
| `scripts/_analyze-3-edges.js` | the four no-fitment sentinels, blank-field rows, Not Found parity |
| `docs/PLAN.md` | the plan and the evidence behind it |
