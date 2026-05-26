# Fitment Data Availability — Findings

**Probe date:** 2026-05-11
**Sample MPNs:** L97 (ACDelco bulb), 639-033 (Dorman HVAC bulb), 302-3BK (Holley oil pan), 95172 (Dayco belt)
**Output JSONs:** `data/_mpn-fitment-probe.json`, `data/_vcdb-probe.json`, `data/_fullscrape-probe.json`

## TL;DR

**VCdb is the canonical structured source** for cols 4-13 (Year, Make, Model, SubModel, Liter, CC, Cylinders, BlockType). It contains 433,583 rows and matched all 4 MPNs cleanly.

**Caveat — VCdb data quality issue**: the `Liter` column contains values like `20`, `105`, `1055`, `1411` — clearly NOT liters in the human-readable sense. These look like foreign-key engine IDs, NOT decoded displacement values. Same column header says "Liter" but values are codes. **Need user input** on whether we should ship as-is, lookup a decoder, or leave blank.

**Full Scrape `fitment` rows** carry Aspiration + Fitment Notes embedded as delimited strings (e.g. `"1963 CHEVROLET BEL AIR | Liter: 4.6 | SubModel: BASE | Aspiration: NATURALLY ASPIRATED | …"`). This is back to string parsing, which user wanted to avoid — but it's the only source for Aspiration.

**Optional cols 14-20** (Position, FuelType, Aspiration, DriveType, Bed Length, BodyType, BodyNumDoors): **no structured source available** in any reference file. Either leave blank (template allows it) or string-parse FullScrape `fitment` (against the rule).

## Per-column data source matrix

| Q2 col | Name | Required | Structured source? | Notes |
|---|---|---|---|---|
| 1 | Action | opt | constant `A` | per user |
| 2 | MPN | **req** | source.PartNumber | ✅ clean direct |
| 3 | BrandAAIAD | **req** | brandMapping."Brand Code" | ✅ clean lookup |
| 4 | Year | **req** | **VCdb."Year ID"** | ✅ — values like `1977` or `"1977, 1978, 1979, 1980, 1981"` (comma list for ranges) |
| 5 | Make | **req** | **VCdb."Make Name"** | ✅ clean (Buick, Cadillac, …) |
| 6 | Model | **req** | **VCdb."Model Name"** | ✅ clean (Century, LeSabre, …) |
| 7 | Part Terminology Id | **req** | taxonomy.PartTerminologyID | ✅ direct |
| 8 | Part Terminology Name | opt | taxonomy.PartTerminologyName | ✅ direct |
| 9 | SubModel | opt | **VCdb."SubModel Name"** | ⚠️ values like `"20"` (numeric-looking) — verify these are real submodel codes |
| 10 | BlockType | opt | **VCdb."Block Type"** | ✅ values: `H, V, L, -` (Horizontal/V-block/In-Line/blank) |
| 11 | Cylinders | opt | **VCdb."Cylinders"** | ✅ integer values like 6, 8 |
| 12 | Liter | opt | **⚠️ VCdb."Liter" appears encoded** | values like `20, 105, 1055` — these look like FK IDs, not displacement decimals. **NEEDS USER REVIEW** |
| 13 | CC | opt | **VCdb."CC"** | values include `-` blanks; need sanity sample |
| 14 | Position | opt | none structured | could derive from vf cells.vehicle_mount_location (rough) |
| 15 | FuelType | opt | none structured | could parse FullScrape `fitment` (string op) |
| 16 | Aspiration | opt | string in FullScrape `fitment` value | string parse needed |
| 17 | DriveType | opt | none | — |
| 18 | Bed Length | opt | none | — |
| 19 | BodyType | opt | none | dropdown col — template default |
| 20 | BodyNumDoors | opt | none | dropdown col — template default |
| 21 | Notes | opt | — | leave blank for first ship |

## Row-volume implications

Per-MPN VCdb row counts (sample):

| MPN | Brand | VCdb rows | Distinct Year×Make×Model combos |
|---|---|---|---|
| L97 | ACDelco | 56 | ~56 |
| 639-033 | Dorman | 664 | TBD |
| 302-3BK | Holley | 2,545 | TBD |
| 95172 | Dayco | 135 | TBD |

If we ship one xlsx row per VCdb match, ACDelco alone (29 MPNs in vf-shipped) could be tens of thousands of rows. **Need user decision on dedup level:**

- **Option A — full VCdb explosion**: one xlsx row per VCdb row. Highest precision, largest file.
- **Option B — dedup by (Year, Make, Model)**: collapse engine variants into one row per vehicle. Loses Cylinders/Liter/CC granularity but is more compact.
- **Option C — dedup by (Year, Make, Model, SubModel)**: middle ground.

## Year representation — already partially solved by VCdb

VCdb's `Year ID` column sometimes contains a comma-list (`"1977, 1978, 1979, 1980, 1981"`) when the part fits multiple years for the same vehicle/engine combo. This is essentially a pre-baked year range.

For the Q2 template's `Year(YYYY) or Year Range (YYYY-YYYY)` requirement, we can:
- Emit comma-list as-is → invalid (template wants either single year or range)
- Convert comma-list to range `1977-1981` when contiguous → valid + compact
- Explode comma-list into multiple rows → more rows but unambiguous

**Recommendation: convert contiguous lists to `YYYY-YYYY` ranges; explode non-contiguous lists.**

## Open questions to confirm

1. **VCdb Liter column**: ship the codes, leave blank, or attempt to decode? (We don't have a VCdb decoder workbook on disk.)
2. **VCdb SubModel "20"-looking values**: trust as real submodel codes, or skip when numeric?
3. **Volume / dedup**: Option A (full explosion), B (Year/Make/Model), or C (+SubModel)?
4. **Year range encoding**: convert comma-lists to `YYYY-YYYY` ranges where contiguous?
5. **Cols 14-20 (engine/body)**: leave blank or attempt FullScrape `fitment` string parse for Aspiration/Cylinders cross-check?
