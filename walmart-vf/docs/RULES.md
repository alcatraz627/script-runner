# Walmart Loadsheet vf — Rules (verbatim from user, 2026-04-30)

## Scope
Generate a Walmart loadsheet (`walmart loadsheet vf`) covering **only ACDelco rows**
from the 2026-03-30 enhancement export.

## Reference data (downloaded from Google Drive → `~/Downloads/Walmart Reference/`)
1. **Brand Mapping** — `Walmart_Brand Mapping_vf.xlsx`
2. **Enhanced Content** — `Walmart_Enhanced Content_vf.xlsx`
3. **VCdb Mapping** — `Walmart_VCdb Mapping_vf.xlsx`
4. **Taxonomy Mapping** — `Walmart_Taxonomy Mapping_vf.xlsx`
5. **Full Scrape** — *not yet downloaded* (key `part_fitment` referenced in user notes)

## Hard rules per column

| Loadsheet column                    | Source                                                       | Behavior                                                                          |
| ----------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **Brand**                           | filter only                                                  | Pick rows where Brand == "ACDelco" (source) / "AC Delco" (display) — confirm form |
| **Manufacturer Part Number**        | source `Part Number`                                         | MUST be filled for every row                                                      |
| **Measure**                         | extracted attributes                                         | MUST be filled for every row                                                      |
| **Unit**                            | extracted attributes                                         | MUST be filled for every row                                                      |
| **Vehicle Category (+)**            | constant                                                     | Always `"Auto Accessories"`                                                       |
| **Vehicle Fitment Type**            | source `fitment` (a.k.a. `part_fitment` in scrape)           | "Universal" if empty/none, else "Vehicle Specific"                                |
| **AAIA Brand ID**                   | Brand Mapping lookup                                         | Only fill rows where lookup matches; drop column value otherwise                  |
| **Additional Features (+)**         | Enhanced Content `Features and Benefits`                     | Replace whatever is there now (currently messy)                                   |
| **Part Terminology ID**             | Taxonomy Mapping (PCdb sheet)                                | Look up; remove rows that don't match (per user — clarify: drop value or row?)    |
| **Everything else**                 | —                                                            | Ignore. If a column can't be filled and is non-essential, leave blank             |

## Process rules
- **No blind guesses.** Every value must trace to a source. Flag flakiness up-front.
- **No large data into Claude's context.** Probe with scripts; sample with scripts;
  validate with scripts. Excerpts only.
- **Convert Excel → JSON early.** Shard if helpful. Excel only at the final assembly.
- **Validate twice:** intermediate JSON AND final Excel readback.
- **Ask, don't assume.** Anything ambiguous → QUESTIONS.md, wait for answer.
- **Document each script** (header JSDoc) so re-runs are predictable.
