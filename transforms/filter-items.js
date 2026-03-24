/**
 * transforms/filter-items.js
 *
 * Filters rows out of the pipeline based on configurable criteria.
 * Filtered rows are excluded from all downstream steps but not deleted
 * from the source data — they can be re-included by removing or updating config.
 *
 * Config: {
 *   urlField: 'eBay Item URL',  // field to check (default: 'eBay Item URL')
 *   excludeUrls: [...],         // exclude all rows whose urlField matches any of these
 *   deduplicateByUrl: false,    // if true, also remove rows sharing a URL (keeps first)
 * }
 */

module.exports = async function filterItems(rows, config = {}) {
  const urlField = config.urlField || 'eBay Item URL';
  const excludeUrls = new Set(config.excludeUrls || []);
  const deduplicateByUrl = config.deduplicateByUrl || false;

  const seenUrls = new Set();
  let excluded = 0;
  let deduplicated = 0;

  const result = rows.filter(row => {
    const url = row[urlField];

    if (url && excludeUrls.has(url)) {
      excluded++;
      return false;
    }

    if (deduplicateByUrl && url) {
      if (seenUrls.has(url)) {
        deduplicated++;
        return false;
      }
      seenUrls.add(url);
    }

    return true;
  });

  if (excluded > 0) console.log(`filter-items: excluded ${excluded} rows matching excludeUrls`);
  if (deduplicated > 0) console.log(`filter-items: deduplicated ${deduplicated} rows with duplicate ${urlField}`);
  console.log(`filter-items: ${result.length} rows remaining (of ${rows.length})`);

  return result;
};
