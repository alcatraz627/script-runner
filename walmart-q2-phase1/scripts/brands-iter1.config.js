/**
 * brands.config.js — Q2 Phase 1
 *
 * Single source of truth for brand-specific knobs in this run.
 *
 * Conventions:
 *   - brandKey: lowercase canonical name used in file paths (acdelco, dorman, holley, dayco)
 *   - sourceBrandRegex: case-insensitive regex matching the source export's Brand value
 *   - outputBrandString: human label (kept for parity with vf; Phase 1 xlsx doesn't write it)
 *
 * Note: vf had a `scrapeOnlyMpns` field for MPNs present in Full Scrape but
 * absent from the source export. Q2 Phase 1 v1 SKIPS scrape-only (fitment-only
 * shipment means scrape-only MPNs without VCdb fitment would be dropped
 * anyway). To re-enable in v2, restore the field + re-derive fullscrape index.
 */
'use strict';
module.exports = {
  acdelco: { sourceBrandRegex: /^acdelco$/i, outputBrandString: 'ACDelco' },
  dorman:  { sourceBrandRegex: /^dorman$/i,  outputBrandString: 'Dorman'  },
  holley:  { sourceBrandRegex: /^holley$/i,  outputBrandString: 'Holley'  },
  dayco:   { sourceBrandRegex: /^dayco$/i,   outputBrandString: 'Dayco'   },
};
