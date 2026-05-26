/**
 * brands.config.js — single source of truth for brand-specific knobs.
 *
 * To add a new brand: append an entry. Pipeline scripts read this via
 *   require('./brands.config.js')[brandKey]
 *
 * Conventions:
 *   - brandKey: lowercase canonical name used in file paths (acdelco, dorman, holley)
 *   - sourceBrandRegex: case-insensitive regex matching the source export's Brand value
 *   - outputBrandString: exact value written to the loadsheet brand cell
 *   - scrapeOnlyMpns: MPNs in Full Scrape but not in source export — appended with isScrapeOnly flag
 */
'use strict';
module.exports = {
  acdelco: {
    sourceBrandRegex: /^acdelco$/i,
    outputBrandString: 'ACDelco',
    scrapeOnlyMpns: ['45G8101', '36-369540', '27239X', '26519X', 'MU1861'],
  },
  dorman: {
    sourceBrandRegex: /^dorman$/i,
    outputBrandString: 'Dorman',
    scrapeOnlyMpns: ['615-104', '618-013', '917-549'],
  },
  holley: {
    sourceBrandRegex: /^holley$/i,
    outputBrandString: 'Holley',
    scrapeOnlyMpns: [],   // Holley source and scrape are perfectly aligned (119/119)
  },
  dayco: {
    sourceBrandRegex: /^dayco$/i,
    outputBrandString: 'Dayco',
    scrapeOnlyMpns: [],   // 97/97 perfect alignment
  },
  // Future brands plug in here. Until added, --brand <name> errors with a clear message.
};
