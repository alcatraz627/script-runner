# Open Questions — please answer before I write transforms

Numbered so you can reply with "Q1: …, Q2: …" in any order.

---

## Q1. Brand spelling

Source has `Brand = "ACDelco"` (no space). The loadsheet column "Brand" — should I
write **"ACDelco"** (verbatim) or **"AC Delco"** (your note's spelling) into the
output cell?

## Answer 1: Go with `ACDelco`, the value in the sheet

---

## Q2. Measure / Unit — which attribute keys?

The "extracted attributes" field for the sample bulb has many candidates:
`diameter`, `width_in`, `weight_lb`, `wattage`, `voltage`, `length_mm`,
`length_in`, `height_in`, `diameter_in`, `width`, `weight_lb`, `upc`, etc.

Walmart's "Measure" / "Unit" pair is usually a **single primary dimension**
(e.g. `1.0` + `quart` for a fluid). The right key is part-type-dependent.

How do you want this resolved?

(a) **Per-part-type rule table** I build from your input (e.g. light bulb →
wattage, oil filter → length, etc.) — most reliable, slow.
(b) **First-non-empty from a fixed priority list** (`length_in` → `width_in` →
`weight_lb` → …) — fast, but produces "1.4 in" for a bulb when "9 W" was
the right answer.
(c) **Something else** — please specify.

If (a) or (c), I'll list ACDelco's 64 rows' Part Types and we map together.

## Answer 2: Let's go with Per-part-type rule table. Give me an easy way to bulk enter / verify your default select from the list of available options

## Note: Correctness for ALL the parts is important. You will give me the available options + your best pick, have me verify / modify each, and then for each row, you will then check my input and flag the ones you think are still wrong / are missing any suitable attributes to put for measure + unit

---

## Q3. AAIA Brand ID — which column from Brand Mapping?

Brand Mapping has both `Parent Company Code` and `Brand Code`. AAIA Brand ID
is normally the **brand-level** code (3-letter). My default would be `Brand Code`.
Confirm? Also: should I require `Mapped? == true` AND `Match Confidence == "high"`,
or accept any matched row?

## Answer 3: Go with `Brand Code`.

## Explain: What is `Mapped? == true` AND `Match Confidence == "high"`? Show me the values for both of these for each row

---

## Q4. Enhanced Content vs source — overwrite or fallback?

Both files have Title / Description / Features. Enhanced Content is the newer
curated version (1,252 rows, brand-keyed). For ACDelco rows, do I:

(a) **Always use Enhanced Content's** Title/Desc/Features, ignoring source — OR
(b) Use Enhanced Content where present, fall back to source where missing.

Your note says "Additional Features (+) … from 2. Enhanced Content" but is
silent on Title/Description. I assume (a) for all three, but please confirm.

## Answer 4: Fill only from Enhanced Content -> The Features only, no title. Don't use the source since it is not Features & Benefits copy but just a raw dump of the attributes

## Also show: Show me how many are missing in Enhanced Content.

---

## Q5. Vehicle Fitment Type — exact rule

You said: "Universal / vehicle specific, mostly vehicle specific, depending on
(5. Full Scrape → key: `part_fitment`)".

The source already has a `fitment` column (newline-separated fitment lines).
The sample ACDelco row has a long fitment list → **Vehicle Specific**.

(a) Is it sufficient to use the source's `fitment` column? Logic:
empty → Universal, non-empty → Vehicle Specific. ✅ simple, works today.
(b) Or do you want me to wait for the Full Scrape `part_fitment` field
because it's more authoritative?

If (b), please drop the file in `~/Downloads/Walmart Reference/` and I'll proceed.

## Answer 5: `fitment` is different from `part_fitment`, `part_fitment` will have the value we need to decide between "Universal" and "Part" specific

## Notes: The file should be available now. Parse it into a readable format via reusable scripts you write (or co-opt an existing one), check the headers, sample 50 random rows, build a basic understanding, write a script to extract and group all pairs of "key" and "value" (indexed by excel row index, also have "mpn" as a "part number")

---

## Q6. Full Scrape — file name?

I don't see a "Full Scrape" file in `~/Downloads/Walmart Reference/`. Existing
files there are: `Walmart_Brand Mapping_vf.xlsx`, `Walmart_Enhanced Content_vf.xlsx`,
`Walmart_Taxonomy Mapping_vf.xlsx`, `Walmart_VCdb Mapping_vf.xlsx`. Is the source
enhancement export (`~/Downloads/export_Walmart Scrape Organized v3 3 30 26 …`)
the "Full Scrape"? Or a separate file pending download?

## Answer 6: It should be available now in that folder in `~/Downloads/Walmart Reference/`

---

## Q7. Part Terminology ID miss — drop row or drop value?

Your note: "Part Terminology ID: look up (4. Taxonomy) and remove the ones that
don't match". Two readings:

(a) **Drop the row entirely** from the loadsheet (ACDelco rows whose Part
Number isn't in Taxonomy → not exported).
(b) Keep the row but **leave Part Terminology ID blank** (only the column
value is removed).

Which one?

## Answer 7: Add a column that flags if it's present or not, so we can filter out later. Also show me stats on how many are available

---

## Q8. Loadsheet template

Should I use the same template as the prior runs
(`~/Downloads/Walmart Loadhseet Mar 30.xlsx` → "Product Content And Site Exp"
sheet, 94 columns, header rows 1-5, data starts row 6), or is there a newer
"vf" template? The Google Drive folder contained reference data only — no
template.

## Answer 8: Yes, we need to use the same loadsheet template. But there is still stuff in the newer v9 file I shared as reference (~/Downloads/walmart-loadsheet-filled-v9.xlsx) that we need to consider for sideloading at the end.

## Notes: Also show me what is newer in the v10 file you mentioned

---

## Q9. Output file naming

Proposed: `walmart-vf/output/walmart-loadsheet-acdelco-vf-v1.xlsx`,
auto-incrementing the `vN`. Acceptable, or different convention preferred?

## Answer 9: Yes, looks good. I think we'll have to do multiple iterations so.

---

## Q10. Scope confirmation

ACDelco only for this entire run? (64 rows out of 1,252.) After ACDelco lands,
do we extend the same vf rules to the other top brands (Holley, Dayco, Purolator,
…), or is ACDelco the whole job?

## Answer 10: Only ACDelco, so we at least have proper data for at one brand. Next up, will also try for "Dorman", but that's a later todo

---

# Round 2 — questions surfaced from Full Scrape probe + coverage stats

## Q11. `part_fitment` is almost completely empty

Full Scrape coverage for ACDelco:

- key=`part_fitment` → **1 of 64 MPNs** (only `41-993` = "Direct Fit")
- key=`vehicle_fitment_type` → **10 of 64 MPNs** (all value "Specific")
- key=`fitment` (long list) → **35 of 64 MPNs**
- source's `fitment` column → **35 of 64 MPNs** (likely same set as above)
- **29 MPNs have NO fitment signal anywhere**

Distinct `part_fitment` values across the entire scrape (all 506K rows):
`Semi Universal` (96 rows), `Direct Fit` (96 rows), `Universal` (29 rows). Only 221 rows total.

**Decision needed.** Three options:

(a) **Cascade**: `part_fitment` (Direct Fit / Universal / Semi Universal) →
else `vehicle_fitment_type` (Specific) → else if any `fitment` rows exist →
"Vehicle Specific" → else default "Universal".
(b) Treat `part_fitment` as canonical; for the 63 missing MPNs leave the
Vehicle Fitment Type column blank and flag them.
(c) Use source.fitment column only (35/64 → Vehicle Specific, 29/64 → Universal).

Also: how should "Direct Fit" and "Semi Universal" map to the loadsheet's
required values (likely just `Universal` / `Vehicle Specific`)?

## Answer 11: Let's go with option A.

## Notes: The final value should be either `Universal` , else `Specific`. Also do add a another column that keeps the actual source and the value

---

## Q12. AAIA Brand ID — single constant for ACDelco

All 64 ACDelco MPNs in Brand Mapping resolve to the same **Brand Code = "BCVC"**
(Parent Company Code = "BDDM"), 100% Mapped, 100% high confidence, all via
`heuristic_brand_family`. Effectively a constant for this brand.

(a) Write `BCVC` for all 64 rows.
(b) Still do per-row lookup so the script generalizes to Dorman next.

I plan to do (b) — same code, just guaranteed to converge to BCVC for ACDelco —
unless you want a hard-coded constant.

About `Mapped?` and `Match Confidence`: these are columns in the Brand Mapping
sheet. `Mapped? = true` means the matcher confirmed Input Brand → AAIA codes.
`Match Confidence ∈ {high, medium, low}` is the matcher's self-assessment.
For ACDelco all 64 are `true` + `high`, so the gating doesn't change anything
here — but for future brands (Dorman) it will matter. Confirm I should keep
`Mapped? == true` AND `Confidence ∈ {high, medium}` as the lookup gate (or
high-only)?

## Answer 12: Don't filter them out based on this, just add these values to the output for next iteration filtering

---

## Q13. The 29 ACDelco MPNs with no fitment data

These have nothing in source.fitment, nothing in scrape.fitment, no
part_fitment, no vehicle_fitment_type. Sample MPNs:
`H5054` (Headlight Bulb), `47G` (Battery), `PT515` (Connector Seal),
`38299` (Belt Tensioner), `334-2313` (Alternator), …

Default to "Universal"? Or flag as "needs review" and skip them?

## Answer 13: "needs review". We'll iterate on this further

---

## Q14. Sideloading from v9/v10 — which columns?

**v9 vs v10 diff** (only 2 columns differ across all 1,252 rows × 94 columns):

| Col | Name                       | +Added | ~Changed |
| --- | -------------------------- | ------ | -------- |
| 17  | `mainImageUrl`             | 113    | 647      |
| 19  | `productSecondaryImageURL` | 715    | 0        |

So v10 _only_ improves images vs v9. You said "stuff in v9 we need to consider
for sideloading at the end" — please confirm which columns:

(a) Just **image URLs** (cols 17, 19) from v10.
(b) **All filled cells** from v9/v10 that we don't otherwise compute.
(c) Specific column list (please name them).

## Answer 14: We can keep images for a later iteration, but let's get the images from v10. Also do show me how are the image values different between v9 and v10, with a few sample comparisons and counts on same and different

---

## Q15. 5 ACDelco MPNs are in Full Scrape but NOT in source

`45G8101, 36-369540, 27239X, 26519X, MU1861` — present in the scrape, absent
from the source enhancement export.

(a) Skip them (we filter from source = 64 rows).
(b) Add them to the loadsheet using scrape data only (no enhancement,
no Title/Desc/Features from Enhanced Content unless they're there too).

## Answer 15: Add these, but add a column marking this specific flag about how this is "new" and present in scrape but absent in source. Mark these for review later.

---

## Q16. Measure/Unit — proposal format for your bulk verification

Per Answer 2: per-part-type rule table, you verify each.

Plan:

1. I generate `walmart-vf/output/measure-unit-proposals.csv` with columns:
   `partType | mpn | available_attribute_keys | proposed_measure_key | proposed_unit_key | sample_value`
2. **One row per part type** (54 part types). For each, I list the attribute
   keys present across all MPNs of that part type and propose the best pair.
3. You edit the CSV to confirm/override `proposed_measure_key` /
   `proposed_unit_key` (or write `SKIP` to opt out).
4. I re-read the CSV, apply, then run a per-row check that flags any row
   where the chosen attribute key is missing or the value isn't numeric/parseable.

Sound good? (Alternative: HTML form, Markdown table, Excel — say which.)

## Answer 16: Sounds good to me, yes let's do csv

---

## Q17. Output naming for sideload step

If we sideload images from v10, do we:
(a) Sideload from `~/Code/Versable/scripts/walmart-loadsheet-filled-v10.xlsx`
(the one with images).
(b) Or from a specific reference file you'll point me at.

## Answer 17: This file only, but let's keep it as a last todo

---

# Round 3 — surfaced after measure/unit proposal generation

## Q18. 22 part types have NO dimensional key in either source OR scrape

After pulling dimensional keys from BOTH the source `attributes` field AND the
Full Scrape (using a permissive regex matching length/width/diameter/wattage/
voltage/amperage/cca/capacity/etc), this many part types have nothing usable:

  source.attributes only: 27 part types covered
  scrape extra:            5 more covered
  **NEITHER:               22 part types still uncovered**

Examples of the 22 with no measure key anywhere:
- Air Brake Hose (`18J1197`) — scrape has only brand/desc/image/price/title
- Air Filter Housing (`25691083`) — only inventory/availability metadata
- Alternator Rotor (`88972426`) — manufacturer info only
- Differential Pinion Bearing (`S1297`) — basic listing data
- Disc Brake Anti-Rattle Clip (`18K1577`) — barebones
- Disc Brake Hardware Kit (`18K861X`) — no dimensions
- Drum Brake Hardware Kit (`18K1484`) — wait, this DOES have width_in/length_in in source — so the count may shift after your CSV pass
- … (the CSV has the full list)

Walmart's loadsheet says Measure / Unit MUST be filled. These 22 parts have no
reliable source. Options:

  (a) **Manual entry**: leave proposals blank in the CSV, you fill them in via
      research / spec sheets, I pick them up.
  (b) **Skip Measure/Unit for these rows** and flag them — accepts violation
      of "MUST fill" rule but produces an exportable file.
  (c) **External lookup**: scrape AAIA PIES feed or similar, but that's a
      separate engineering project — out of scope for this iteration.
  (d) Use a fallback like `package weight (oz)` from `weight_lb` if present
      — but that's not the part's primary measure either.

Recommendation: (a) for the first iteration, (b) as backstop with a "needs
review" flag column. Confirm?

---

## Q19. CSV review workflow

The CSV is at `walmart-vf/output/measure-unit-proposals.csv` (54 rows, ~12
columns). Suggested pass-back loop:

  1. You open in Excel/Numbers/text editor
  2. For each row, EITHER accept my `proposed_key` (do nothing) OR set
     `user_override_key` and `user_override_source` (`source.attributes` |
     `scrape` | `manual`)
  3. If unit can't be derived from value (e.g. you typed a manual measure),
     set `forced_unit`
  4. Save as `measure-unit-proposals.user.csv` (or overwrite — your choice)
  5. I read it back, build the per-row Measure/Unit, run validation,
     report flags

Confirm this flow?
