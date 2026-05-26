# Walmart Loadsheet vf — Future Upgrades

Queued enhancements not yet built. Listed in priority order.

## 1. VCdb Mapping integration (deferred 2026-05-01)

**Source:** `~/Downloads/Walmart Reference/Walmart_VCdb Mapping_vf.xlsx` (35 MB)

**Why deferred:** Current vehicle data (vehicleMake, vehicleModel, vehicleYear,
compatibleCars) is derived from `scrape.fitment` text. It works but introduces
formatting noise (Liter:/SubModel:/Trim: leaks, allcaps make-model strings) that
we hunted with regex filters across multiple versions. VCdb is the AAIA-canonical
fitment dataset — same data, but structured as discrete columns per row.

**What it would improve:**
- `compatibleCars` — single canonical format vs current 4 leaky variants
- `vehicleMake` / `vehicleModel` — read from columns instead of regex-parsing text
- `vehicleYear` — exact min/max from numeric `Year ID` column instead of text regex
- Eliminates entire class of VCdb-leak bugs (~17 historical findings)

**What it would NOT add:**
- No new Walmart loadsheet column coverage (template has no submodel/engine column)
- No additional MPN coverage (VCdb has same MPN universe as scrape)

**Estimated work:**
- ~30-45 min to write `build-vcdb-by-mpn.js` (streaming reader, group by Part Number)
- ~15 min refactor in `20-fill.js` to prefer VCdb-derived values when available
- Spot-check pass to surface any VCdb-specific edge cases

**Architecture sketch:**
```
scripts/build-vcdb-by-mpn.js     ← stream reader, output one row per MPN keyed by:
                                    { mpn, fitments: [{makeName, modelName, subModelName,
                                      yearId, liter, cc, cylinders, blockType, engineBaseId}] }
                                    Output: data/vcdb-by-mpn.json (~5-10 MB)

scripts/20-fill.js (refactor)
  Replace:
    cells.compatibleCars = N.buildCompatibleVehicles(scrape)   // from scrape.fitment text
  With (when VCdb present for the MPN):
    cells.compatibleCars = N.buildCompatibleFromVcdb(vcdbEntry) // structured
  Fallback to scrape.fitment when VCdb has no entry.

scripts/lib/normalize.js
  Add buildCompatibleFromVcdb(vcdbEntry) — concat distinct
    "Make Model SubModel (YYYY-YYYY)" lines from grouped fitment rows.
```

**When to do this:** Before adding more brands, if we hit VCdb-leak issues again
that the regex filters can't catch, OR if Walmart's matcher rejects current
vehicle data shape.

---

## 2. Re-evaluate the 26 user picks against VCdb

Some user picks were title-extraction (e.g., "21.50 in Effective Length" for the
Dayco 15215 anomaly). With VCdb integrated, similar title-vs-attribute discrepancies
might become detectable across more rows.

---

## 3. Image-quality grading

Currently we accept any `http(s)://` URL as a valid image. Could add:
- HEAD request validation (still 200 OK?)
- Domain ranking (Walmart > eBay > Summit > others)
- Resolution detection (prefer s-l1600 over s-l500 from eBay CDN)

---

## 4. Walmart spec-vocab validation

The template's `Data Definitions` sheet has examples for each column. We don't
currently validate values against those examples. Could add a vocab-check pass
that flags values outside the example set (e.g., `material='Composite'` is fine
but flags `material='Multi'` for review).

---

## 5. Brand auto-detection from source

Currently `brands.config.js` requires manual entry per brand. Could add a script
that scans the source export, reports all distinct Brand values + row counts,
and offers to register each as a new pipeline target.

---

## 6. UPC pulling (Tier B from coverage gaps)

Cols 90/91 (External Product ID Type / External Product ID) have ~93% coverage
via `source.attributes.upc`. Skipped per current Q4 scope but easy to add when
Walmart matching priority changes.
