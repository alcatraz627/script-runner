# Excel playbook

Read this before starting any "turn this workbook into that workbook" task in this repo. It is the accumulated cost of several of them, written for whoever picks up the next one.

## Reach for these first

| Need | Use |
|---|---|
| Read or slice a data file | `xlsx` (SheetJS) from this repo's `node_modules` |
| Write a styled sheet | `exceljs`, the convention in `build-full-export.js` |
| Change format only (csv/tsv/xlsx/json) | `zconvert <in> <out>` |
| A worked end-to-end example | `aep-catalog-v9/` |

The File Tools MCP is the documented first choice for data files, and on this machine `list_sheets` currently fails with `XLSX.readFile is not a function`. Probe with it if you like, but have the Node fallback ready rather than burning turns on it.

`npm install` may be needed. `node_modules/` is gitignored and was absent as of 2026-09.

## The order that works

1. **Probe before reading.** Sheet names, `!ref`, the first six rows as raw arrays, and the merge count. Never load a whole workbook into context. `aep-catalog-v9/scripts/_probe.js` is a copyable version.
2. **Analyse the joins before designing anything.** Key uniqueness, orphans both directions, rows per key, and whether columns that look duplicated actually are. `_analyze-1-joins.js` is the shape.
3. **Enumerate the edge cases and put them in a plan.** Sentinel rows, blank fields, rows that carry a note instead of data. Write the numbers down; you will quote them later and they must be right.
4. **Dry-run on 2 or 3 rows and print every field with its type.** This is the repo's oldest rule and it exists because arrays-of-objects once shipped as `[object Object]`.
5. **Run the whole thing, then read the file back off disk.** Writing succeeded is not the same as the file being right.
6. **Validate against the source, not against your own build.** See the next section; this is the part that is easy to get wrong.

## Verification that actually verifies

A checker that reuses the builder's helpers is not a checker. It recomputes the expected answer with the same broken code and moves in lockstep with the bug.

This was measured, not theorised. An inline verify in `aep-catalog-v9` shared `str`, `isSection` and `carriesNoVehicle` with its builder. Setting `carriesNoVehicle` to always return false produced a sheet that turned scrape-note rows into fake vehicle applications, and the verify passed **18 of 18**.

Three rules that follow:

- **Rebuild the expectation from the raw grid.** Read the source with `{ header: 1 }` as arrays of arrays and resolve columns by position from row 1. Share no helper with the builder.
- **Some properties must be asserted absolutely, not compared.** If both sides of a comparison get trimmed, a builder that stops trimming still compares equal. Assert "no output cell carries leading or trailing whitespace" instead.
- **Mutation-test the checker.** Copy the pipeline to a scratch dir, break one helper, and confirm the checker goes red and exits non-zero. A guard nobody has watched fail is untested. `aep-catalog-v9` has seven such mutations recorded in its review.

## Traps this repo has actually hit

**32,767 characters per cell.** Assert it; do not assume. Truncating with a `[TRUNCATED]` marker is the repo convention (`pipeline/io.js`, `build-full-export.js`), but truncating a JSON array yields invalid JSON, so a JSON-bearing column should hard-fail instead. Say which you chose in a comment.

**`flattenArrayFields` corrupts arrays-of-objects.** `.join()` calls `toString()`. Use `JSON.stringify`, and assert no cell contains `[object Object]`.

**`require.cache`.** `engine.js` clears it before loading configs and transforms. Cached modules ignore your edits.

**Sideload scripts.** After one modifies `raw.json`, check which downstream fields are re-derived rather than passed through.

**Write JS with the Write tool, not a heredoc.** zsh mangles template literals.

**`rm` is blocked machine-wide.** Use `trash`.

**A hardcoded output path beside a `--out` flag.** One builder took `--out` for the xlsx and wrote its JSON sidecar to a constant, so every test run silently overwrote the production sidecar. Derive every secondary path from the one that was passed in.

**`raw: false` in `sheet_to_json`** returns the cell's formatted text. Safe when every cell is string-typed, silently wrong the day a part number arrives number-typed or a date carries a format. Compare `raw:true` against `raw:false` once per new drop.

## Handing a sheet to enhancement-product

The upload path is `lib/importer/excel.py` in `enhancement-product/backend`. Read it rather than guessing; the useful facts as of 2026-09:

- `get_excel_file_headers` parses with `nrows=0`, so it only ever sees row 1. There is no header detection at this layer.
- It **drops** any column pandas names `Unnamed: N`. That is what a blank header cell becomes, so a blank header loses the column with no error shown.
- pandas renames a duplicate header to `X.1`, silently changing the name your column map expects.
- `_compute_sheet_column_fill_stats` reads the whole sheet, and "filled" means `str(x).strip() != ""`. An empty string counts as filled, so a column of `""` reports 100% full.
- Blank cells written as `""` rather than left empty read as `''`, not `NaN`. `dropna()` will not drop them.

So the target file is: one sheet, one header row, no blank or duplicate headers, no whitespace in header names.

**Verify it by running their reader, not by reasoning about it.** `aep-catalog-v9/scripts/03-verify-against-enhancement-ingest.js` shells into `enhancement-product/backend/.venv/bin/python` and calls the real functions. That venv has openpyxl and pandas; the system python does not.

## Spot checks

Thirty rows off the top of the file exercise one group, one status, and one data shape. Stratify instead, along the axes the transform can actually be wrong on: the first row under each group band, the last row of a small band, every sentinel row, the payload extremes, one row per distinct enum value, the odd-shaped scrapes, and the awkward keys.

Cap each stratum. A populous one will otherwise take every slot and the sample degrades into a biased one while still reporting thirty checks passed. That happened here on the first attempt.

Derive the picks rather than listing them, or the sample breaks on the next drop.

## Where things live

| Path | What |
|---|---|
| `pipeline/` | the engine: `engine.js`, `run.js`, `io.js`, `manifest.js`, `job-queue.js` |
| `transforms/` | pipeline steps, `{ meta, run(items, config, ctx) }` |
| `runs/<run-id>/` | per-run config, data, logs, posters |
| `aep-catalog-v9/` | a complete worked example: probe, analyse, build, validate, ingest-check |
| `walmart-q2-phase1/`, `walmart-vf/` | earlier one-off projects, same `{input,output,data,docs,scripts}` layout |
| `docs/EXCEL-PLAYBOOK.md` | this file |
| `.claude/skills/runtime-notes.md` | per-session findings from earlier work |

New one-off projects follow the sibling layout: `<name>/{input,output,data,docs,scripts}`, numbered scripts `01-…`, `02-…`, and `_`-prefixed exploratory ones.
