# Skeptical review: AEP Catalog V9 flat-sheet transform

Reviewed 2026-09-03. Read-only throughout. The source workbook and the output were
copied to `/tmp/aep-review/` before anything was executed, and the mutation harness had
its `OUT_FILE` and `JSON_SIDECAR` constants repointed into `/tmp` before it was run even
once. Nothing under `aep-catalog-v9/` was written or executed in place except
`scripts/03-verify-against-enhancement-ingest.js`, which only reads.

While I was working, `README.md` gained a `scripts/04-validate.js` section. That file is
being written concurrently and is **out of scope** here, so the validator spec at the end
is written as if it does not exist. Treat it as a checklist to diff against whatever 04
ended up containing.

## The headline

**The transform itself is correct.** I rebuilt the expected output independently from the
raw source grid and compared it to the written xlsx cell by cell. Every one of the 17
passthrough columns matches on all 898 rows. All 3,843 fitment entries match in content
*and* order. `Fitment Count` disagrees with the source on zero rows. There is no
`undefined`, `null`, `NaN`, `[object Object]`, newline, tab, control char, or
formula-injection prefix anywhere in the output. The 32,767 limit is not approached (max
16,441). Source `Vehicles` equals recomputed `Fitment Count` on all 352 matched items.
Zero orphans, zero duplicate keys, zero rows lost to `blankrows:false`.

**The verification is not correct.** I mutation-tested it. Breaking one shared helper
produces a silently wrong output that passes all 18 checks. Details in S1 below.

**Three documented numbers are wrong**, one of them in a way that will bite a downstream
consumer. See D1: it is 348 rows with fitment and 550 without, not 352 and 546.

## Ranked findings
| confidence | severity | file:line | check | what's suspect | how to verify |
|---|---|---|---|---|---|
| certain, mutation-proven | **high** | `build-aep-flat-sheet.js:131`, `:241`, `:283`, `:285`, `:287` | S1 self-verify circular on `carriesNoVehicle` | Build and verify share the sentinel predicate. I copied the script to `/tmp`, changed `carriesNoVehicle` to `() => false`, and ran it: **pass=18 fail=0**. The output it blessed turns all four scrape-note rows into fake vehicle applications. `47DPCAMRT` and its three siblings get `Fitment Count = 1` and `Fitment = [{"options":"Part confirmed on site — no fitment published"}]`, and `Fitment Note` is empty on every row. The four checks that should catch this (`entry total equals source vehicle rows`, `items with fitment match source`, `sentinel notes preserved`, `sentinel rows carry an empty fitment array`) recompute the *source side* with the same broken helper, so they move in lockstep with the bug. | `sed 's/^const carriesNoVehicle = .*/const carriesNoVehicle = (row) => false;/'` into a copy with the output paths repointed, run it, read the pass count. |
| certain, mutation-proven | **high** | `build-aep-flat-sheet.js:223`, `scripts/01-build-single-sheet.js:251` | S2 `--out` does not redirect the JSON sidecar | Both writers take `dest` for the xlsx but write the sidecar to the hardcoded `CONFIG.JSON_SIDECAR` and `JSON_SIDECAR`. So `node build-aep-flat-sheet.js --src test.xlsx --out /tmp/scratch.xlsx` silently overwrites the **production** `output/AEP-Catalog-V9-Flat.json` with test data, then prints `sidecar : …/output/AEP-Catalog-V9-Flat.json` as if that were intended. This is the exact hazard the review brief warned about. I had to patch it out of my own copy before I could mutation-test at all. | Read the two lines. `dest` is a parameter of `write()`; the sidecar path is not derived from it. |
| certain | **medium** | `docs/PLAN.md:119`, `:23`, `README.md:27` | D1 the fitment row-set split is wrong | PLAN says "352 rows have a non-empty `Fitment`. The other 546 have `[]` and a non-empty `Not Found Reason`", and `:23` says "546 Catalog items have no fitment. All 546 are exactly the `Status = "Not found"` rows." Measured on the actual output: **348** rows have a non-empty Fitment, **550** have `[]`, and 4 of those 550 have `Status = "Found"`, `Fitment Count = 0`, and a **blank** `Not Found Reason`. Those four are the sentinels. This matters because "no fitment" is the obvious downstream filter, it returns 550, and four of them look Found with no reason. | `rows.filter(r => JSON.parse(r.Fitment or '[]').length > 0).length` gives 348. `rows.filter(r => r.Fitment === '[]' && !String(r['Not Found Reason']).trim()).length` gives 4. |
| certain, mutation-proven | **medium** | `build-aep-flat-sheet.js:121` | S3 self-verify circular on `str()` | Dropping `.trim()` from `str` yields **pass=18 fail=0** with a materially different file. Section labels become `"CUMMINS  "` and `"NISSAN  "`, and 282 Catalog cells ship with their leading and trailing whitespace. `group counts match the source bands` at `:269` and both reason checks at `:292` and `:294` compare two values that were each produced by the broken helper. | Same harness, replacing `str` with a version that does not call `.trim()`. |
| certain, mutation-proven | **medium** | `build-aep-flat-sheet.js:257`, `:258` | S4 the section checks are circular too | With `isSection` forced to `false`, `no section rows survived` and `row count equals source data rows` both **pass**, because the check filters the source with the same predicate, so `srcData.length` becomes 910 to match. The breakage was caught only incidentally, by the duplicate-join-key pre-check at `:320`, because section rows have a blank `ITEM` and `''` collides with itself. I disabled that pre-check and re-ran: **14 of the 18 checks still pass**. Only `join key unique and complete`, `join key set identical to source`, `OEM GROUP on every row`, and `group counts match the source bands` fire. Those four are the only genuinely load-bearing assertions in the file. | Break `isSection` and short-circuit the `:320` and `:321` guards, then read the pass count. |
| certain | **medium** | `build-aep-flat-sheet.js:190-196` versus `scripts/01-build-single-sheet.js:198-222` | S5 the two builders emit different JSON sidecars | The xlsx is identical, because ExcelJS matches on `key` rather than insertion order. The sidecar is not, because it is `JSON.stringify` of the record objects, so its key order is insertion order. The one-shot builds `rec` by looping `PASSTHROUGH` and *then* assigning `Not Found Reason`, landing it at position **19**. `01-build` uses an object literal in COLUMNS order, landing it at position **12**. I read `output/AEP-Catalog-V9-Flat.json` back: `Not Found Reason` sits between `Year Range` and `Vehicles`, so the file on disk came from the one-shot and does **not** match the documented column order at `docs/PLAN.md:44-68`. Anything consuming the sidecar positionally gets a different answer depending on which builder last ran. | `Object.keys(JSON.parse(fs.readFileSync('output/AEP-Catalog-V9-Flat.json'))[0])` |
| certain | **medium** | `scripts/01-build-single-sheet.js:265` versus `build-aep-flat-sheet.js:320-321` | S6 `01-build` does not hard-fail on duplicates or orphans | The one-shot exits 1 on duplicate join keys or orphan fitment items. `01-build` prints both and writes the file anyway. Its only hard failure is the cell-limit check at `:268`. A future drop with a duplicate `ITEM` gets a silently fanned-out sheet from `01` and a loud failure from the one-shot. | Compare the two blocks. `01` has exactly one `process.exit(1)`. |
| certain | **medium** | `build-aep-flat-sheet.js:228-306` versus `scripts/02-verify-output.js:92`, `:122`, `:124` | S7 consolidating into the one-shot dropped three checks | `02-verify-output.js` asserts `12 distinct groups`, `every reasoned row has Status "Not found"`, and `every "Not found" row carries a reason`. The one-shot's inlined verify has none of the three. `README.md:11` calls the one-shot "the whole job", so the weaker verifier is the one that actually runs. The two dropped Status checks are precisely what would have surfaced D1. | Count `check(` calls: 22 in `02`, 18 in the one-shot. Then diff the labels. |
| certain | **medium** | `build-aep-flat-sheet.js:287`, `scripts/02-verify-output.js:116` | S8 `sentinel notes preserved` compares items to rows | `notes.length` counts output **rows** carrying a note, which is one per item. `srcSentinels.length` counts source **rows**. These are different units. It passes only because each of the four sentinel items happens to have exactly one sentinel row. One item with two sentinel rows makes the check fail on correct data, since the builder joins them with a pipe separator, which is right. Two sentinel rows on different items still passes. It is also the only check standing between the codebase and S9. | Read the two expressions. `notes` derives from `rows`, the 898 output rows. `srcSentinels` derives from `srcFit`, the 3,847 source rows. |
| certain on the structure, measured 0 occurrences today | **medium**, latent | `build-aep-flat-sheet.js:181-182` | S9 `Options` double-duty lets a row vanish | `dicts` takes rows where `!carriesNoVehicle`. `note` takes `carriesNoVehicle` rows with a non-empty `Options`, then `.filter(Boolean)`. A row blank in Years, Make, Model, Trim and Engine **and** blank in Options falls out of both and leaves no trace: no entry, no note, no count, no warning. I checked the data and **0 such rows exist today**, since all 4 vehicle-blank rows carry the same note text. If one appeared, `entry total equals source vehicle rows` at `:283` would still pass, because the source side classifies it as a sentinel too. Only S8's item-versus-row mismatch would notice, and only by accident. | `fit.filter(r => VEHICLE_FIELDS.every(c => !str(r[c])) && !str(r.Options)).length` gives 0. |
| certain | **medium** | `build-aep-flat-sheet.js:73`, `:100`, `scripts/01-build-single-sheet.js:68`, `scripts/02-verify-output.js:25`, `scripts/_ingest_probe.py:17` | S10 the 23-column list exists in four hand-maintained copies | Plus `PASSTHROUGH` as a fifth partial copy. `README.md:21` promises "change the `CONFIG` block … and nothing else", which is false. `COLUMNS` and `PASSTHROUGH` sit outside `CONFIG`, and the two verifiers hold their own literal lists. Renaming `OEM GROUP`, which `docs/PLAN.md:38` explicitly invites, needs edits in five places. Forgetting one turns a verifier green but meaningless, or red but correct. | `grep -c "OEM GROUP"` across the four files. |
| certain | **medium** | both builders, whole file | S11 the duplication itself | `build-aep-flat-sheet.js` and `scripts/01-build-single-sheet.js` are near-duplicates that must agree, and they have already diverged three ways: S5 sidecar key order, S6 failure policy, S19 header source. Nothing pins them equal, not a test and not a shared module. `README.md:46` presents `01` as a live entry point. Either delete `01` and point the README at the one-shot's `--no-verify`, or extract the build into a module both require. | Diff the two `build()` functions. |
| certain | **low** | `docs/PLAN.md:36` | D2 "68 distinct families" is wrong | Actual: **67** distinct `ENGINE FAMILY` values after trimming, **69** before. Neither is 68. The load-bearing half of the sentence, that there are 0 conflicts and every family maps to exactly one band, I recomputed and it **is** correct, both trimmed and untrimmed. | `new Set(data.map(r => str(r['ENGINE FAMILY']))).size` gives 67. Without `str` it gives 69. |
| certain | **low** | `docs/PLAN.md:78` | D3 "median 908 chars" is wrong | Actual median `Fitment` payload is **803.5** over the 348 items that have fitment, **777.5** over all 352 items present in the Fitment sheet, and **2** over all 898 output rows. No reading produces 908. The `max 16,441` and the item `5.7HEMILIFR` are both **correct**, confirmed against the written file. | Sort the payload lengths and take the middle. |
| certain | **low** | `docs/PLAN.md:96-98` | D4 the `Reason` values are presented as verbatim but are paraphrased | Reason 3 actually reads `…(oversize/coated) — not an OEM number, no dealer site lists it`, not `, not an OEM number, no dealer site listing`. Reasons 4 and 5 are truncated in the doc; both really end `— generic hardware / engine brand with no OEM dealer catalogue`. Counts, which the doc omits: 209, 196, 129, 3, 9. | Tally `Reason` on the Not Found sheet. |
| certain | **low** | `docs/PLAN.md:25`, `scripts/01-build-single-sheet.js:57` | S12 the `Reference` column is dropped and no doc mentions it | The Fitment sheet has 13 columns and `Reference` is column 2. PLAN's redundancy argument covers five columns and never names `Reference`. The only trace anywhere in the tree is `FITMENT_ITEM_LEVEL`, a constant that is **declared and never referenced**. I grepped the whole directory for other hits and found zero. **I verified the drop independently and it is safe**: `Fitment.Reference` agrees with Catalog `ALTERNATE REFERENCE` on **352 of 352** items, 283 of which are non-blank, with zero items carrying more than one distinct `Reference` value. So no data is lost, but that evidence was never written down, and a dead constant is the only hint the question was ever asked. | For each item, compare `new Set(fitRows.map(r => str(r.Reference)))` against `str(catalogRow['ALTERNATE REFERENCE'])`. 352 agree, 0 disagree. |
| certain | **low-medium** | `build-aep-flat-sheet.js:221`, the ExcelJS `addRow` path | S13 empty values are written as empty strings, not blank cells | Every text column has 898 string-typed cells even where only 66 carry content, as in `NOTES`. pandas reads `''` rather than `NaN`, so `dropna()`, `isna()` and `.notnull()` all see a completely full column. The enhancement backend happens to be safe, because `lib/importer/excel.py:186` does `str(x).strip() != ""`, which is why `03` passes 14 of 14. Any other consumer differs. Worth one line in the README rather than a code change. | Read cell `.t` per column from the output. `NOTES` gives `{"s":898}`. |
| certain | **low** | `build-aep-flat-sheet.js:193` | S14 `Vehicles` is mixed-type in the xlsx | 352 numeric cells and 546 empty-string cells, because the blank branch emits `''` rather than `null`. pandas gives the column `object` dtype, so the count that PLAN keeps "for audit" is not numerically usable without a cast. `Fitment Count` at `:194` is uniformly numeric and does not have this problem. Emitting `null` would fix it. The `Number(str(...))` coercion itself is fine here. I checked every value: 32 distinct, zero produce `NaN`. | Cell `.t` tally for `Vehicles` gives `{"n":352,"s":546}`. |
| high, about 90% | **low-medium** | `scripts/03-verify-against-enhancement-ingest.js:24` | S15 the ingest verifier swallows its own diagnostic on failure | `execFileSync` throws on a non-zero exit, and `_ingest_probe.py:79` exits 1 when any check fails. `out` is never assigned, so `process.stdout.write(out)` never runs. The operator sees a Node stack trace instead of the `FAIL` lines, which are sitting unread in `err.stdout`. Wrap in try/catch and print `e.stdout` and `e.stderr`. Currently invisible because the run is green: I ran it, 14 of 14, exit 0. | Force a failure by pointing `TARGET` at a stale file, then watch what prints. |
| high, about 90% | **low** | `scripts/02-verify-output.js:146`, `:147`, `:139` | S16 the spot-check hardcodes a data value and mis-slices | `'47DPCAMRT'` is a literal member of `picks`. On a new drop without that item, `rows.find(...)` returns `undefined` and `:153` `str(out.Fitment)` throws a `TypeError`. Separately, `:147` `slice(0, spotN + 1)` is off by one, so the default `--spot 3` prints four items. The array also caps at 4 picks, so `--spot 20` still prints 4 while `:139` announces 20. | Read the array. `picks` has 4 literal entries and no guard on `find`. |
| high, about 85% | **low**, latent | `build-aep-flat-sheet.js:127` | S17 `raw: false` is safe on this file but is a live risk for a new drop | I diffed `raw:false` against `raw:true` across every Catalog column on all 898 data rows and found **zero string differences**, so nothing is mangled today. But `raw:false` returns the cell's *formatted* text, and the sheet already contains number-typed cells: 16 in `ITEM`, 42 in `ALTERNATE REFERENCE`, 2 in `NOTES`, 352 in `Vehicles`. A future drop where any of those carries a number format, a date serial, or a thousands separator silently changes the value, and no check would see it, because the verify reads the source the same way. The 34 leading-zero `ITEM`s survive only because they are string-typed in this file. | Compare `sheet_to_json(..., {raw:false})` against `{raw:true}` column by column. |
| certain | **low** | `build-aep-flat-sheet.js:322` versus `pipeline/io.js:53-58`, `build-full-export.js:64`, `build-diff-excel.js:76`, `transforms/cc30-highlight-newer.js:39` | S18 no truncation path, against the repo convention | `CLAUDE.md` Critical Rule 3 and four sibling scripts all truncate with `'… [TRUNCATED]'`. This builder hard-exits instead, and `docs/PLAN.md:78` describes that as "no truncation path fires". **I think the divergence is correct**, because truncating a JSON array yields invalid JSON, which is strictly worse than failing. But it is undocumented, it means one oversized part kills the whole build, and the repo's own shared helper at `pipeline/io.js` was neither reused nor referenced. Say so in the code, in one line. | `grep -rn "TRUNCATED" scripts/` finds 4 siblings plus `pipeline/io.js`. The AEP builder has none. |
| certain | **low** | `build-aep-flat-sheet.js:218` versus `scripts/01-build-single-sheet.js:245` | S19 `c.key` where `c.header` belongs | The one-shot's `COLUMNS` entries have no `header` property and `write()` passes `header: c.key`. `01`'s entries carry a redundant `header` equal to `key` and it passes `header: c.header`. Output is identical today. If anyone ever adds a display header to the one-shot's `COLUMNS`, it is silently ignored. Pick one and make the other match. | Read both `ws.columns =` lines. |
| certain | **low** | `build-aep-flat-sheet.js:285` | S20 a failing check that prints nothing useful | `check('items with fitment match source', withFit === new Set(...).size)` passes no `detail`, so on failure it prints the bare label. Its counterpart at `scripts/02-verify-output.js:114` prints `${withFitment} vs ${srcFitItems.size}`. Every other check in the file supplies a detail. This is the one that does not. | Read the call. The third argument is absent. |
| certain | **low** | `scripts/_ingest_probe.py:60`, `:66` | S21 the ingest probe hardcodes this drop's row counts | `total == 898` and `non_empty == 546` are literals. On the next drop the probe fails for the right reason with the wrong message, "fill stats see all 898 data rows". Pass the expected counts in as `argv`, or derive them from the source. | Read the two `check(` calls. |
| certain | info | `build-aep-flat-sheet.js:121` | S22 trimming silently normalises 445 source cells | 282 Catalog cells and 163 Not Found cells carry leading or trailing whitespace and are trimmed on the way out, mostly `FEATURES AND BENEFITS` with 104 and `ENGINE FAMILY` with 141. `NOTES` holding a single space becomes `""`. **The join key is unaffected.** I checked every `ITEM` in all three sheets and not one carries whitespace, so trimming the key changes zero matches, and there are no case-only or whitespace-only `ITEM` collisions: 898 distinct trimmed equals 898 distinct untrimmed. No fidelity check can see the normalisation, because every comparison applies `str()` to both sides. Recording it as deliberate-looking behaviour nobody wrote down, not as a defect. | `rows.filter(r => String(r[col]) !== String(r[col]).trim())` per column, per sheet. |
| certain | info | `build-aep-flat-sheet.js:127` | S23 `blankrows:false` drops nothing, checked rather than assumed | `blankrows:true` returns the same row counts on all three sheets, 910, 3,847 and 546, for a delta of 0. No sheet has duplicate or blank header cells, so using header values as object keys is safe and no column is renamed to `X_1`. Both concerns from the brief are clean. | Run `sheet_to_json` with `blankrows` both ways, then compare `.length` and the key union. |

### Claims I checked that hold

Recording these so nobody re-derives them. From `docs/PLAN.md`: `:13-15` sheet dimensions
of 910 by 18, 3,847 by 13, and 546 by 10, correct. `:21` `ITEM` unique, 898 distinct,
zero duplicates, correct. `:22` zero orphans, all 352 Fitment items exist in Catalog,
correct. `:24` rows per item at min 1, median 7, max 148, correct exactly. `:25` all five
shared scrape columns agree 352 of 352, correct, and `Reference` does too, per S12. `:31`
the twelve band labels, correct. `:34` zero data rows above the first band, correct, and
in fact the first Catalog row *is* a band. `:36` zero family-to-band conflicts, correct.
`:78` max 16,441 at `5.7HEMILIFR`, correct. `:84` `Vehicles` equals recomputed `Fitment
Count` on all 352 matched items with zero disagreements, correct. `:88` blank Years 78,
Make 67, Trim 1,905, correct exactly. `:92` all 546 Not Found rows exist in Catalog, map
one to one onto the `Status = "Not found"` rows, carry 5 distinct reasons, and their 9
shared columns match Catalog **byte for byte**, with 0 raw diffs rather than merely 0
trimmed diffs. `:117` the per-band tally, all twelve numbers, correct. `:118` 3,843
entries, correct. `:132` "14 of 14", which I ran: 14 of 14, exit 0. From `README.md`:
`:25` 898 rows, 23 columns, one sheet named `Catalog`, correct.

Against the `CLAUDE.md` Critical Rules. Rule 1, sample first, is served by `--limit 3
--dry`. Rule 2, verify exports by reading them back off disk, is the part this code does
best. Rule 3, the 32,767 limit, is asserted but not truncated, which is S18. Rule 4, the
`flattenArrayFields` arrays-of-objects trap, is avoided correctly via `JSON.stringify`,
and `no [object Object]` is asserted. Rules 5, 6 and 7 do not apply.

## Validator specification

A standalone validation script. The governing rule, learned from S1, S3 and S4: **it must
rebuild the expected answer from the raw source grid without calling any helper the
builder calls**. Read the source with `{header: 1}` as an array of arrays and index
columns by position resolved from row 1, so a broken `str`, `isSection` or
`carriesNoVehicle` in the builder cannot also corrupt the expectation. Report `FAIL` for
wrong or missing data separately from `WARN` for things worth a human look, and exit 1 on
any `FAIL`.

### (a) Structural

1. Output workbook has exactly one sheet, named `Catalog`.
2. Row 1 holds exactly the 23 expected headers in order, asserted against a list
   **imported from one module** rather than a fourth literal copy. See S10.
3. No header cell is blank, duplicated, or matches `^Unnamed:`. Those are the three
   shapes `lib/importer/excel.py:151` silently drops.
4. Used range is `A1:W899`, meaning 23 columns by 1 header row plus 898 data rows. Assert
   both dimensions, so a trailing blank row or column is caught.
5. No row anywhere has `Status == "— section —"`.
6. Every data row has a non-empty `ITEM`.
7. The frozen top row and bold header survive the write. Cosmetic, so `WARN` only.

### (b) Completeness and data loss

8. Row count equals source Catalog rows minus source band rows, where **both are counted
   from the raw grid** by testing column `J`, which is `Status`, against the marker. Not
   by calling the builder's `isSection`.
9. Column provenance, asserted rather than assumed. Every source column of all three
   sheets is accounted for. Catalog's 18 are all present. Fitment's 13 break down as
   `ITEM` the join key, 6 that become dict keys, 5 proven redundant, and `Reference`
   proven redundant. Not Found's 10 break down as 9 proven redundant plus `Reason`
   folded in. Fail if any source header falls in none of those buckets. That is how a
   *new* column in a future drop gets noticed instead of silently dropped.
10. Re-prove the redundancy rather than trusting it. For all 6 Fitment item-level
    columns, **including `Reference` against Catalog `ALTERNATE REFERENCE`**, which is
    the claim PLAN never made, assert every Fitment row's value equals its Catalog row's,
    and that no item carries two distinct values. `WARN` with the disagreeing items named
    if a future drop breaks the 352 of 352.
11. Same for the Not Found sheet. All 9 shared columns match Catalog **raw**, byte for
    byte, on all 546 rows.
12. The sum of `Fitment Count` across all rows equals the count of source Fitment rows
    that name a vehicle, computed from the raw grid.
13. **Every source Fitment row is accounted for.** Assert that vehicle rows plus note
    rows plus dropped rows equals 3,847, and assert dropped equals 0 explicitly. This is
    the check that closes S9. The ghost row currently has no detector at all.
14. No source Fitment row is vehicle-blank *and* `Options`-blank. `FAIL` with the row
    numbers if any is.
15. Every distinct source `ITEM` in Fitment appears in the output, giving zero orphans,
    and every source Catalog `ITEM` appears exactly once, giving zero duplicates and zero
    drops. Do both as set comparisons and print the symmetric difference.
16. `Not Found Reason` is non-empty on exactly as many rows as the Not Found sheet has
    rows, and the Not Found `ITEM` set equals the set of output rows carrying a reason.

### (c) Referential integrity against source

17. For **every** row, not a sample, all 17 passthrough columns equal the source Catalog
    cell, compared raw and then trim-normalised. Report the raw-diff count separately as
    a `WARN`, so the 445 whitespace normalisations from S22 are visible rather than
    invisible.
18. For **every** item with fitment, `JSON.parse(Fitment)` deep-equals the array rebuilt
    from the raw Fitment grid, **including order**. Order matters. It currently matches
    source row order and nothing asserts that.
19. Each dict has only keys drawn from years, make, model, trim, engine and options. No
    key maps to `""`. No key is present when the source cell was blank.
20. `Fitment Count` equals the parsed array length, **and** equals the source vehicle-row
    count for that item. Two separate assertions. The first is self-consistency. Only the
    second reaches the source.
21. `Fitment Note` equals the pipe-separated join of the `Options` values of that item's
    vehicle-blank source rows. Assert the **text**, not the count. This replaces S8's
    broken comparison. Then separately assert that the set of items with a note equals
    the set of items having at least one vehicle-blank source row.
22. Every row with a note has `Fitment == "[]"` and `Fitment Count == 0`.
23. `OEM GROUP` forward-fill correctness, rebuilt from the raw grid. For each of the 898
    data rows, the group equals the label of the nearest preceding band row. Assert the
    per-band tally against CHRYSLER/DODGE 90, CUMMINS 3, FORD 175, GENERAL MOTORS 167,
    HARDWARE 9, HONDA 18, HYUNDAI/KIA 233, JEEP 26, NISSAN 21, SUBARU 69, TOYOTA 81,
    VOLKSWAGEN/AUDI 6, summing to 898. Assert 12 distinct groups, which is the check the
    one-shot dropped per S7.
24. Zero data rows precede the first band row, since otherwise the fill has a null head.
25. Every `ENGINE FAMILY` maps to exactly one `OEM GROUP`. Report the distinct family
    count in the output so D2 cannot drift again.
26. `Reason` text matches its source row per item, and the reason distribution matches
    209, 196, 129, 3, 9 across the 5 distinct strings. `WARN` if the set of distinct
    reasons changed.
27. `Vehicles` equals the source `Vehicles` string for every row. Separately, as a `WARN`
    rather than a `FAIL`, assert it equals `Fitment Count` wherever both are present.
    They agree on all 352 today. A future divergence is a data-quality signal, not a
    build error.

### (d) Value sanity

28. No cell contains `[object Object]`, `undefined`, `NaN`, a literal `null`, or `#REF!`.
29. No cell exceeds 32,767 chars. `WARN` above 30,000. Report the max and its item and
    column.
30. `Vehicles`: every non-blank value is a non-negative integer. Assert `Number()`
    produces no `NaN` and no `Infinity`, since the coercion at `:193` has no guard.
31. No cell contains a newline, tab, or C0 control character. All clean today, but a
    scrape change could introduce one and it would break naive CSV consumers.
32. No cell begins with `=`, `+`, `@`, or a `-` followed by a letter, which is the CSV
    formula-injection shape. Clean today.
33. Cell type audit per column, reporting the numeric and string tally. Assert `Fitment
    Count` is uniformly numeric, and `WARN` on any mixed-type column, which will flag
    `Vehicles` per S14 until someone decides to emit `null`.
34. Every `Fitment` cell is exactly `"[]"` or parses to a non-empty array. No cell is the
    empty string.
35. Report these as named counts rather than assertions: rows with fitment, expect 348.
    Rows with `[]`, expect 550. Rows with `[]` and no reason, expect 4, the sentinels.
    Rows with fitment and a reason, expect 0. These four numbers are what D1 got wrong,
    and printing them every run is what stops it recurring.
36. Per-column fill counts printed every run, so a collapse to zero is visible.
    `PURCHASE DESCRIPTION` 875, `FEATURES AND BENEFITS` 144, `NOTES` 66, `ALTERNATE
    REFERENCE` 611, then `Searched As`, `Source Site`, `Product Title`, `Source URL` and
    `Vehicles` at 352 each, `Part Number (site)` 147, `Year Range` 346, `Not Found
    Reason` 546, `Fitment Note` 4.

### (e) Enhancement-module readiness

37. `get_excel_file_sheets` returns exactly `["Catalog"]`.
38. `get_excel_file_headers` returns all 23 names. Assert the set difference in **both**
    directions, so an added column is caught as loudly as a dropped one.
39. `get_excel_file_metadata(read_rows=True, column_fill_stats=True)` reports a `total`
    equal to the row count derived from the source, not a hardcoded 898. See S21.
40. `ITEM` and `OEM GROUP` are 100% filled under *their* fill rule, which is
    `str(x).strip() != ""` at `lib/importer/excel.py:186`.
41. A streamed `Fitment` cell round-trips through `json.loads`. Sample the first row, the
    max-payload row `5.7HEMILIFR`, and one sentinel, rather than only the first.
42. The probe's failure output actually reaches the operator. Wrap the `execFileSync` in
    try/catch and print `e.stdout`. See S15.
43. The JSON sidecar is checked, not just the xlsx. Same row count, same 23 keys, **key
    order equal to the declared column order**, which is the assertion that catches S5,
    and cell-for-cell equality with the xlsx.
44. Sidecar path safety: assert the sidecar sits beside the xlsx that was actually
    written. A validator run should also refuse to proceed if `~$*.xlsx` lock files exist
    beside the output, since Excel holding the file open is how a half-written sheet gets
    validated. One such lock file was present while I reviewed.

### The 30-row spot-check sample

Not the first 30 rows. Those are all `CHRYSLER/DODGE`, all consecutive, and would
exercise one band, one status, and one fitment shape. Print each pick with source beside
output across every column. Stratify by the axes along which this transform can actually
be wrong, which are the band boundary, the sentinel branch, the payload extremes, and the
scrape shapes.

| n | stratum | why this axis |
|---|---|---|
| 12 | the **first data row under each of the 12 bands**: `CB-1520CK24S-STD`, `NAM3973512`, `CYLFO121 BARE`, `CYLGM153HP`, `06-01-003`, `HO141AEP`, `24356-2E700`, `JP36CAMSET-AEP`, `13025-6KA0A`, `13050VVT-SEAL`, `13201-79215AEP`, `CYLVW06K BARE` | the forward-fill's only failure mode is an off-by-one at a band edge, and the first row under a band is where a fill that lags or leads shows up. Covers all 12 groups by construction. |
| 3 | the **last data row of three bands**, one small, one large, one adjacent to a small band: `C-193A AEP` for CHRYSLER/DODGE at 90 rows, `22224-3CAB0` for HYUNDAI/KIA at 233, `NAM3958414` for CUMMINS at 3 | the other edge. CUMMINS has 3 rows, so a one-row fill error there is proportionally invisible in the tally and visible only per row. |
| 4 | **all four no-vehicle sentinels**: `47DPCAMRT`, `37773-P8B-305AEP`, `26250-2E031`, `24900-3C158` | the `Options` double-duty branch from S9, and the mutation S1 proved undetectable. These four rows are the entire discriminating evidence for `carriesNoVehicle`, so a sample that omits them cannot see the bug. Assert `Fitment == "[]"`, `Fitment Count == 0`, `Fitment Note` equal to the note text, `Status == "Found"`, and `Not Found Reason` empty. |
| 3 | **fitment volume extremes**: `15066-ZL80B` at 148 rows, `5.7HEMILIFR` at the 16,441-char max payload, and a one-row item such as `90301-A0061AEP` | the cell-limit path, the JSON-assembly path at scale, and the degenerate single-entry array. |
| 5 | **one item per distinct `Reason`**: `9-5557AEP`, `DDX41GSK-OS`, `2146AEP.50`, `NAM3973512`, `06-01-003` | proves the Not Found fold is per-row rather than a broadcast of the modal reason. The two rare reasons, at 3 and 9 rows, are the ones a bulk join would lose. `NAM3973512` and `06-01-003` double as band-first rows, which is fine; they carry two properties each. |
| 3 | **odd-shaped scrapes**: items among the 52 whose Fitment rows have a blank `Years` with the range inside `Model`, such as `AT4Z-6C262-A  AEP`, `F3LY-6214-A AEP`, `F6AZ-6310- AB` | `docs/PLAN.md:88` says these pass through verbatim, and this is the sample that proves it. It also exercises an `ITEM` containing a double internal space, which trimming must **not** collapse. |
| 3 | **awkward part numbers**: a leading-zero `ITEM` such as `02103AEPOS`, one of 34; a leading-zero `Part Number (site)` such as `0411131343`; and a numerically-typed `ITEM` cell, one of the 16 | leading zeros and number-typed keys are how `raw:false`, per S17, would silently corrupt a future drop. |

Overlaps are deliberate. `NAM3973512` and `06-01-003` each satisfy two strata, which is
why 12 plus 3 plus 4 plus 3 plus 5 plus 3 plus 3 dedupes from 33 picks to 30. Keep the
selection **derived**, as in nearest row under each band, max by payload, one per distinct
reason, rather than a literal list, so it survives a new drop. That is the failure
`scripts/02-verify-output.js:146` already has.

## Dispositions

| # | finding | severity | verdict |
|---|---|---|---|
| S1 | self-verify circular on `carriesNoVehicle`; 18 of 18 pass on knowingly broken output | high | **fixed** — verify now delegates to 04-validate, which shares no helper. Mutation re-run: 5 checks fire, exit 1. |
| S2 | `--out` does not redirect the JSON sidecar, so test runs clobber production | high | **fixed** — sidecar derived via `sidecarFor(dest)`. Regression-tested: a `--out` run leaves production untouched. |
| D1 | `PLAN.md:119` and `:23`: 348 with fitment and 550 without, not 352 and 546 | medium | **fixed** — PLAN corrected to 348/550/4; the validator prints all four numbers every run. |
| S3 | self-verify circular on `str()` trim, mutation-proven | medium | **fixed** — new absolute check "no output cell carries leading or trailing whitespace". Mutation now caught, exit 1. |
| S4 | `no section rows survived` and `row count` circular on `isSection`, mutation-proven | medium | **fixed** — mutation-tested with the dup-key pre-check disabled: 8 checks fire independently, exit 1. |
| S5 | the two builders emit different JSON sidecar key orders | medium | **fixed** — 01-build is now a wrapper, so one implementation emits the sidecar. |
| S6 | `01-build` does not hard-fail on duplicates or orphans | medium | **fixed** — same wrapper; the one-shot owns the failure policy. |
| S7 | the one-shot's verify dropped 3 checks present in `02-verify-output.js` | medium | **fixed** — the one-shot now runs 04 (56 checks), a superset of the 22 it dropped from. |
| S8 | `sentinel notes preserved` compares items to rows | medium | **fixed** — replaced with a text comparison per item, plus an item-set comparison. |
| S9 | a vehicle-blank and options-blank row vanishes silently; 0 today, undetected if it appeared | medium | **fixed** — builder hard-fails on a vehicle-blank and options-blank row; validator asserts the row ledger balances. |
| S10 | the 23-column list is duplicated in 4 places, and `README.md:21` overstates `CONFIG` | medium | **fixed** — scripts/schema.js is the single declaration; the probe parses it rather than holding a fifth copy. |
| S11 | two near-duplicate builders with nothing pinning them equal | medium | **fixed** — 01-build delegates; there is one build implementation. |
| D2 | `PLAN.md:36`: 67 distinct families, not 68 | low | **fixed** — recomputed independently: 67 trimmed, 69 raw. PLAN says both. |
| D3 | `PLAN.md:78`: median 803.5, not 908 | low | **fixed** — recomputed independently: median 803.5 over the 348 items with fitment. |
| D4 | `PLAN.md:96-98`: reasons paraphrased rather than verbatim, and counts omitted | low | **fixed** — table of verbatim reasons with counts 209/196/129/9/3. |
| S12 | `Reference` dropped undocumented, `FITMENT_ITEM_LEVEL` dead; the drop itself verified safe | low | **fixed** — PLAN now names Reference among six provenance columns; the validator re-proves all six each run. Dead constant gone with the 01-build rewrite. |
| S13 | empty values written as empty strings rather than blank cells | low-medium | **documented** — README says blank text cells are `''` not `NaN`, so `dropna()` will not drop them. No code change: the target backend uses `str(x).strip() != ""`. |
| S14 | `Vehicles` mixed-type in the xlsx | low | **fixed** — blank Vehicles now emits `null`. |
| S15 | `03-verify` swallows the probe's FAIL lines | low-medium | **fixed** — try/catch prints `e.stdout` and `e.stderr`, then exits with the probe status. |
| S16 | `02-verify` hardcodes `'47DPCAMRT'`, and `--spot` is off by one | low | **fixed** — 02 retired to a delegating entry point, so the hardcoded item and the off-by-one are gone. |
| S17 | `raw:false` safe today, latent for a future drop | low | **open, accepted** — latent for a future drop only. Zero differences today between raw:true and raw:false. Not fixed: switching read modes is a change to the transform, not to its checks, and would want its own test pass. |
| S18 | no truncation path, against repo convention and `pipeline/io.js` | low | **documented** — one-line comment at the exit stating why hard-fail beats truncating a JSON array. |
| S19 | `c.key` used where `c.header` belongs | low | **fixed** — one COLUMNS definition in schema.js, keyed on `key`. |
| S20 | the `:285` check prints no detail on failure | low | **superseded** — that check now lives in 04 with a detail string. |
| S21 | `_ingest_probe.py` hardcodes 898 and 546 | low | **fixed** — 03 derives the counts from the source workbook and passes them in. |
| S22 | trimming normalises 445 source cells, undocumented; join key unaffected | info | **documented** — PLAN has a "Whitespace is normalised" section; the join key is proven unaffected. |
| S23 | `blankrows:false` and header-as-key both verified clean | info | **noted, no action** — confirms two brief concerns are clean. |
