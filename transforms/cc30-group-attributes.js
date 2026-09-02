/**
 * transforms/cc30-group-attributes.js
 *
 * Reshapes flat attribute rows (one row per product×key) into grouped products.
 *
 * Input:  24K+ rows like { "Input Row", productbrand, mpn, site, key, raw_key, value, ... }
 * Output: ~556 products like:
 *   {
 *     "Input Row": 5,
 *     "Brand": "JEGS",
 *     "Part Number": "555-11140",
 *     "brand_site": "JEGS",
 *     "url": "https://...",
 *     "original_attributes": [ { key, raw_key, value, source, explanation, evidence_text } ],
 *     "raw_attributes": [ { key: "<raw_key>", value: "<value>" } ]
 *   }
 *
 * Config:
 *   columnMap       {Object}   Renames to apply: { from: to }
 *   discardColumns  {string[]} Columns to drop from attribute rows
 *   groupBy         {string}   Column to group on (default: "Input Row")
 */

module.exports = async function cc30GroupAttributes(rows, config = {}, { onEvent } = {}) {
  const {
    columnMap = {},
    discardColumns = [],
    groupBy = 'Input Row',
  } = config;

  const discardSet = new Set(discardColumns);
  const emit = onEvent || (() => {});

  // Fields that become top-level product columns (not part of original_attributes)
  const topLevelFields = new Set([groupBy, 'productbrand', 'mpn', 'site', 'url']);
  // Also include renamed versions
  for (const from of topLevelFields) {
    if (columnMap[from]) topLevelFields.add(columnMap[from]);
  }
  // Always top-level after rename
  topLevelFields.add('Brand');
  topLevelFields.add('Part Number');
  topLevelFields.add('brand_site');

  // Group rows by the groupBy column
  const groups = new Map(); // groupKey → { product, attrs[] }

  let discarded = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const groupKey = row[groupBy];

    if (groupKey == null || groupKey === '') {
      discarded++;
      continue;
    }

    if (!groups.has(groupKey)) {
      // Build top-level product fields
      const product = { [groupBy]: groupKey };

      // Apply column map to top-level fields
      for (const [from, to] of Object.entries(columnMap)) {
        if (row[from] !== undefined) {
          product[to] = row[from];
        }
      }

      // Copy remaining top-level fields that weren't renamed
      if (!product['Brand'] && row['productbrand'] !== undefined) product['Brand'] = row['productbrand'];
      if (!product['Part Number'] && row['mpn'] !== undefined) product['Part Number'] = row['mpn'];
      if (!product['brand_site'] && row['site'] !== undefined) product['brand_site'] = row['site'];
      if (row['url'] !== undefined) product['url'] = row['url'];

      groups.set(groupKey, { product, attrs: [] });
    }

    // Build attribute entry — keep only the attribute-specific fields
    const key = row['key'];
    const raw_key = row['raw_key'];
    const value = row['value'];
    const source = row['source'];
    const explanation = row['explanation'];
    const evidence_text = row['evidence_text'];

    // Skip rows missing a key
    if (key == null || key === '') {
      discarded++;
      continue;
    }

    groups.get(groupKey).attrs.push({
      key,
      raw_key,
      value,
      source,
      explanation,
      evidence_text,
    });
  }

  // Build final output
  const products = [];
  for (const [, { product, attrs }] of groups) {
    product.original_attributes = attrs;
    product.raw_attributes = attrs.map(a => ({
      key: a.raw_key,
      value: a.value,
    }));
    products.push(product);
  }

  emit({
    type: 'info',
    message: `Grouped ${rows.length} flat rows → ${products.length} products (${discarded} rows discarded)`,
  });

  // Summary stats
  const attrCounts = products.map(p => p.original_attributes.length);
  const avg = (attrCounts.reduce((a, b) => a + b, 0) / attrCounts.length).toFixed(1);
  const min = Math.min(...attrCounts);
  const max = Math.max(...attrCounts);

  emit({
    type: 'info',
    message: `Attributes per product: avg=${avg}, min=${min}, max=${max}`,
  });

  return products;
};
