/**
 * transforms/filter-items.js
 *
 * Filters rows out of the pipeline based on configurable criteria.
 * Filtered rows are excluded from all downstream steps but not deleted
 * from the source data — they can be re-included by removing or updating config.
 *
 * Config: {
 *   urlField:          'eBay Item URL',    // field containing the listing URL
 *   skuField:          'SKU',              // field containing the SKU
 *   skuPrefix:         '555-',             // prefix to strip before matching SKU# in title
 *   listingTitleField: 'eBay Listing Title', // field containing the eBay listing title
 *
 *   excludeUrls: [...],   // exclude ALL rows whose urlField matches any of these URLs
 *                         // use for large corruption groups (>=4 SKUs sharing a URL)
 *
 *   dedupeUrls: [...],    // for each URL, keep the row whose SKU# appears in the listing
 *                         // title; exclude the rest. If no row matches, exclude all.
 *                         // use for small duplicate groups (<4 SKUs sharing a URL)
 * }
 */

module.exports = async function filterItems(rows, config = {}) {
  const urlField          = config.urlField          || 'eBay Item URL';
  const skuField          = config.skuField          || 'SKU';
  const skuPrefix         = config.skuPrefix         || '555-';
  const listingTitleField = config.listingTitleField || 'eBay Listing Title';
  const excludeUrls       = new Set(config.excludeUrls || []);
  const dedupeUrls        = new Set(config.dedupeUrls  || []);

  // Pre-pass: for each dedupeUrl, determine which SKU wins (first whose number
  // appears in the eBay listing title). If none wins, all are excluded.
  const dedupeKeep = new Set(); // Set of row references to keep
  if (dedupeUrls.size > 0) {
    const groups = {};
    for (const row of rows) {
      const url = row[urlField];
      if (url && dedupeUrls.has(url)) {
        if (!groups[url]) groups[url] = [];
        groups[url].push(row);
      }
    }
    for (const [url, group] of Object.entries(groups)) {
      const winner = group.find(row => {
        const skuNum = (row[skuField] || '').replace(skuPrefix, '');
        const title  = row[listingTitleField] || '';
        return skuNum && title.includes(skuNum);
      });
      if (winner) {
        dedupeKeep.add(winner);
      }
      // If no winner found, all are excluded (dedupeKeep stays empty for this group)
    }
  }

  let excluded    = 0;
  let deduped     = 0;
  let dedupeKept  = 0;

  const result = rows.filter(row => {
    const url = row[urlField];

    if (url && excludeUrls.has(url)) {
      excluded++;
      return false;
    }

    if (url && dedupeUrls.has(url)) {
      if (dedupeKeep.has(row)) {
        dedupeKept++;
        return true;
      }
      deduped++;
      return false;
    }

    return true;
  });

  if (excluded   > 0) console.log(`filter-items: excluded ${excluded} rows (excludeUrls)`);
  if (deduped    > 0) console.log(`filter-items: deduped ${deduped} rows, kept ${dedupeKept} originals (dedupeUrls)`);
  console.log(`filter-items: ${result.length} rows remaining (of ${rows.length})`);

  return result;
};
