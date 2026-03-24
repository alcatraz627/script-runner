# JEGS eBay Pipeline Re-Run — Full Context

## The Problem

The user needed to re-run the JEGS eBay product data pipeline for a **new input Excel file** (`JEGS_eBay_Scraped_Data_final_input.xlsx`, 602 items) that replaced the previous Mar 15 export (590 items). The new file had:

- **Updated image lists** from eBay scraping
- **Junk scraped descriptions** — eBay listing HTML boilerplate, not clean product descriptions
- **Mostly empty attributes** — only 55 of 602 items had `Item Specifics (JSON)` populated
- **No Part Types** — the `Category Hierarchy` field contained raw eBay breadcrumbs like "eBay Motors > Parts & Accessories > Car & Truck Parts > Lighting > Headlights" instead of clean part types like "Headlight Switch"

The old run (`jegs-ebay-mar-20-03`, 590 items) had **clean data** from prior Versable processing: good descriptions, features & benefits, reviewed attributes, and correct Part Types. The challenge was preserving that quality while onboarding 602 items (586 overlapping + 16 new SKUs + 4 dropped).

## The Goal

Produce a complete `jegs-ebay-final` pipeline run with all 602 items having:
- Clean descriptions and features (sideloaded from old run where possible)
- Reviewed and approved item attributes (LLM-extracted for gaps, manually reviewed)
- Selected main product images (via image selection dashboard)
- Correct Part Types (not eBay breadcrumbs)
- Generated eBay poster images (via poster API)

## Phase A: Setup & Data Preparation

### A1. Fresh Run Creation
Created `runs/jegs-ebay-final/` with `run.config.js` cloned from mar-20-03. Same 4-step pipeline: split-desc → corrections → normalize → download-posters.

### A2. Sideload Descriptions (`sideload-descriptions.js`)
**Problem**: New Excel had garbage scraped descriptions. Old run had clean ones.
**Solution**: Created script to read old run's `data/raw.json`, build `Map<SKU, {Description, "Features and Benefits"}>`, and overwrite new raw.json fields for matching SKUs.
- **586 matched** — got clean descriptions + features
- **16 unmatched** (new SKUs) — flagged with `_needs_description: true`, kept best-effort scraped text (stripped boilerplate before first `|` separator)
- **4 old-only** — dropped from new file, ignored

### A3. Image Dataset Preparation (`prepare-image-dataset.js`)
Transformed raw.json into image-selector format for the dashboard. Key challenge: **stock/storefront images**.

## Phase B: Image Selection & Stock Image Problem

### The Stock Image Crisis
**Problem**: User started reviewing images in the dashboard and noticed 7 specific SKUs all showed the same images. Investigation revealed:
- 28 shared eBay listing URLs mapped to 162 different SKUs
- The scraper captured seller storefront gallery photos, not product-specific images
- These stock photos appeared across 4+ different SKUs

**Solution (multi-layered)**:
1. **Static blacklist** — Known stock image URLs added to `BLOCKED_BASES` set
2. **Extension-agnostic matching** — `stripExt()` function strips `.webp`/`.jpg` before comparison (same image served in different formats)
3. **Frequency-based auto-detection** — Any eBay image URL appearing in 4+ different SKUs automatically classified as stock photo
4. **Two-layer filtering** — Stock images stripped in both `prepare-image-dataset.js` (data-time) and `generate-combined-dashboard.js` (display-time)

**User reaction**: Initially angry ("What the fuck dude. Now all of them have no images") when 7 specific SKUs they were looking at lost ALL images. Investigation confirmed those items genuinely only had stock photos — no real product images existed in the source data.

**Attempted fixes for missing images**:
- Tried scraping jegs.com → 403 forbidden
- Tried Google Images API → no reliable programmatic access
- Tried eBay search → impractical

**Resolution**: Created `upsert-images.js` for future manual backfill + `BACKFILL-IMAGES.md` with instructions. **127 items remain without product images** — accepted as a known gap to address later.

## Phase C: Attribute Extraction & Review

### C1. LLM Extraction (`extract-attributes.js`)
Modified existing script to handle raw.json format (not just normalize.json). Extracted attributes for **547 items** with empty `Item Specifics (JSON)` using Claude Haiku API.

### C2. Quality Review (`review-all-attributes.js`)
Collected all 602 items' attributes from two sources:
- 55 from Excel's `Item Specifics (JSON)` (source: "excel")
- 547 from LLM extraction (source: "extracted")

Applied quality flags: concatenated nonsense, too-long values, part-number values, eBay metadata fields.

### C3. Combined Review Dashboard (`generate-combined-dashboard.js`)
Self-contained HTML dashboard with:
- Image selection (gallery view, click to select main image)
- Attribute review (approve/reject, inline editing)
- Feedback notes per item
- Server-backed persistence via `review-server.js` (port 3459, saves to `changes.json`)

### C4. Bulk Attribute Cleanup
**Agent-initiated deep scan** identified problematic attributes across all items:
- **eBay metadata to remove**: ePID, Manufacturer Part Number, Prop 65, Brand, Notes with "Description--", Country of Origin, Item Width/Length/Diameter, Type, Made in USA, Dimensions
- **Fitment fields to move**: Engine Type, Transmission Type, Transmission, Axle Type, Side, Brake Type, Lug Pattern
- **Value standardization** (`cleanup-attrs.js`): capitalize first letter, strip non-ASCII, standardize units (inches→in., pounds→lb., volts→V, etc.)

User approved the bulk changes. All selections and approvals preserved throughout.

### C5. Transplant to Raw (`transplant-attributes.js`, `transplant-selections.js`)
Moved approved attributes and selected main images back into `runs/jegs-ebay-final/data/raw.json`.

## Phase D: Pipeline Execution & Part Type Fix

### D1. First Pipeline Run
Ran all 4 steps (split-desc → corrections → normalize → download-posters). Steps 1-3 completed quickly (~12ms each, 602 rows). Poster download started.

### D2. Part Type Discovery
**Problem**: After normalize completed, user noticed Part Type values were wrong — showing eBay breadcrumbs like "eBay Motors > Parts & Accessories > ..." instead of clean types like "Headlight Switch". Root cause: `jegs-export-normalize.js` maps `Category Hierarchy` directly to `Part Type`, and the new Excel had raw eBay category paths.

**Solution**: Created `sideload-part-types.js`:
1. Read old run's `normalize.json` → build `Map<SKU, Part Type>` (586 matches)
2. For 16 unmatched SKUs: derive Part Type from title heuristic (strip "JEGS {number}" prefix, remove trailing fitment/vehicle info)
3. Patch both `normalize.json` and `raw.json` in the new run

### D3. Pipeline Re-run with Corrected Part Types
Re-ran the full pipeline. Poster download job (`jegs-ebay-final-1774305334055`) was running during the UI improvement work in this session (~18 minutes for 602 posters).

## Problems & Solutions Summary

| Problem | Root Cause | Solution |
|---------|-----------|----------|
| Junk descriptions in new Excel | eBay scraper captured HTML boilerplate | Sideloaded clean descriptions from old run (586/602) |
| 547 items missing attributes | Source Excel had empty Item Specifics | LLM extraction via Claude Haiku + manual review dashboard |
| Stock/storefront images mixed in | Shared eBay listings, scraper got gallery photos | Frequency-based auto-detection (4+ SKU threshold) + static blacklist |
| 127 items with no product images | Only stock photos existed, all stripped | Accepted as gap; created upsert-images.js for future backfill |
| Wrong Part Types (eBay breadcrumbs) | normalize.js maps Category Hierarchy → Part Type | Sideloaded from old run + title heuristic for 16 new SKUs |
| 16 new SKUs missing descriptions | No prior run data available | Best-effort: stripped boilerplate from scraped text, flagged `_needs_description` |
| eBay metadata polluting attributes | Scraped Item Specifics included ePID, Prop 65, etc. | Bulk removal + fitment field moves via review dashboard |
| Attribute value quality | Inconsistent casing, non-ASCII chars, varied units | cleanup-attrs.js: capitalize, strip, standardize (in.→in., lb.→lb.) |
| `cp` command hung for 30 min | Interactive overwrite prompt without `-f` flag | TaskStop; lesson: always use `cp -f` or `yes \| cp` |
| Fork bug created empty broken runs | Server created directory before validating input file | Added input file validation BEFORE `fs.mkdirSync` |
| **[Mar 24 post-audit]** 68 items had junk eBay attrs (ePID, MPN, Sub Type, etc.) | Excel-sourced Item Specifics were never routed through the bulk cleanup pipeline — only LLM-extracted attrs went through the review dashboard | `fix-junk-attrs.js`: strips REMOVE_KEYS from Attributes Small/Full in normalize.json and Item Specifics in raw.json |
| **[Mar 24 post-audit]** 16 new SKU descriptions were scraped eBay boilerplate (<500 chars) | `fix-boilerplate-descriptions.js` prompt said "Max ~500 chars" — Haiku treated it as a cap, not a floor | Fixed prompt to "MINIMUM 500 chars"; added `--regen` flag to re-process by saved part numbers; all 16 now 656–996 chars |
| **[Mar 24 post-audit]** 92 items had stock/placeholder image URL (`DOcAAOSw8NplLtwK`) | URL was in BLOCKED_BASES in prepare-image-dataset.js but `transplant-selections.js` only writes explicit user picks — items with no valid images after filtering kept their pre-existing blocked Main Image | `fix-placeholder-images.js` clears blocked URLs from raw.json Main Image; `jegs-export-normalize.js` now rejects blocked URLs in both Main Image and extractFirstImage fallback |
| **[Mar 24 post-audit]** Re-running normalize reverted Part Types to eBay breadcrumbs | `sideload-part-types.js` patches `row['Part Type']` in raw.json but the normalize transform read `row['Category Hierarchy']` — two different fields | Fixed transform to use `row['Part Type'] \|\| row['Category Hierarchy']` so sideloaded values take priority |
| **[Mar 24 post-audit]** 23 fitment attrs (Side, Transmission Type, Engine Type, Lug Pattern) still in Attributes Small/Full | Excel-sourced Item Specifics were not routed through the review dashboard fitment-cleanup step | Stripped fitment attrs directly from normalize.json + raw.json: 46 entries removed from normalize (23 items × 2 arrays), 23 from raw |
| **[Mar 24 post-audit]** 2 items had 0 attributes (555-81500-6, 555-79600) | Item Specifics (JSON) was empty; LLM extraction was not triggered for these items | Manually authored 4 attributes each from description content; written to normalize.json and raw.json |

## Scripts Created This Project

| Script | Purpose |
|--------|---------|
| `image-selector/sideload-descriptions.js` | Copy clean descriptions from old run → new run |
| `image-selector/sideload-part-types.js` | Copy Part Types from old run + title heuristic fallback |
| `image-selector/prepare-image-dataset.js` | Transform raw.json → image-selector dataset format |
| `image-selector/review-all-attributes.js` | Collect + quality-flag all items' attributes |
| `image-selector/generate-combined-dashboard.js` | Self-contained HTML dashboard (images + attrs + feedback) |
| `image-selector/review-server.js` | Persistence backend for dashboard (port 3459) |
| `image-selector/cleanup-attrs.js` | Batch clean attribute values (casing, units, non-ASCII) |
| `image-selector/upsert-images.js` | Patch image data for specific SKUs from JSON file |
| `image-selector/transplant-selections.js` | Move image selections → raw.json |
| `image-selector/transplant-attributes.js` | Move approved attributes → raw.json |
| `image-selector/audit-normalize.js` | Comprehensive quality audit of normalize.json — field presence, image gaps, duplicates, junk attrs, description quality, Part Type health |
| `image-selector/fix-junk-attrs.js` | Strip known eBay junk attribute keys from normalize.json + raw.json |
| `image-selector/fix-boilerplate-descriptions.js` | Rewrite eBay boilerplate descriptions via Haiku; `--regen` flag re-processes by saved part numbers |
| `image-selector/fix-placeholder-images.js` | Clear known blocked/stock image URLs from raw.json Main Image field |

## Current State

- **Pipeline**: COMPLETED. Steps 1–3 (split-desc → corrections → normalize) re-run on 2026-03-24 after all data fixes. Normalize.json is authoritative.
- **Data quality (post Mar-24 full audit)**: 602 items — 0 junk attrs, 0 fitment attrs in Small/Full, 0 zero-attr items, 0 boilerplate descriptions, 0 eBay breadcrumb Part Types.
- **Image gaps**: 92 items have empty Images (cleared blocked stock URLs). Needs product photo backfill via upsert-images.js + re-run of poster download for affected items only.
- **Poster download**: Attributes capped at 5 per item in `pipeline/poster-downloader.js`. Last full poster run: 2026-03-23 (602 PNGs). Posters for the 92 image-gap items need regeneration after backfill.
- **Known remaining**: 555-81573 / 555-50084 have identical descriptions (SSR Star Wheel 15"×8", same eBay source). Manual differentiation needed.

### Mar-24 Post-Audit Fixes Applied

| Fix | Scope |
|-----|-------|
| Stripped junk eBay attrs (ePID, MPN, Sub Type, Notes, Type, Dimensions, etc.) | 68 items, 322 attr entries removed from normalize.json; 161 from raw.json |
| Rewrote 16 boilerplate "eBay ..." descriptions via Haiku (≥500 chars enforced) | 16 items, all now 656–996 chars |
| Cleared 92 blocked/stock image URLs from Main Image in raw.json | 92 items now have empty Images — need poster re-download once backfilled |
| Fixed normalize transform: `Part Type` field takes priority over `Category Hierarchy` | Bug: sideload-part-types.js patched raw.json `Part Type` but transform read `Category Hierarchy` |
| Added blocked-URL filter to normalize transform's `extractFirstImage` fallback | Prevents future stock URL leakage even without image-selector curation |
| Capped attributes at 5 in poster-downloader.js buildPayload | Prevents oversized payloads to poster API |
| Stripped 23 fitment attrs (Side, Transmission Type, Engine Type, Lug Pattern) from Attributes Small/Full | 46 entries removed from normalize.json, 23 from raw.json |
| Added 4 attributes each to 555-81500-6 and 555-79600 (previously 0 attrs) | Manually authored from description; both files updated |
| Re-ran steps 1–3 (split-desc → corrections → normalize) to produce clean authoritative normalize.json | All raw.json fixes now fully reflected in normalize output |

---

_Supplementary context for `_checkpoint.claude.md`. Generated 2026-03-24._
