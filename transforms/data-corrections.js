/**
 * transforms/data-corrections.js
 *
 * Applies manual corrections to specific rows by SKU.
 * Corrections are provided in config.corrections as an object keyed by SKU.
 *
 * Config: {
 *   skuField: 'SKU',            // column name for SKU lookup (default: 'SKU')
 *   corrections: {
 *     '555-10377': {             // SKU to patch
 *       'Description': 'new desc',
 *       'Main Image': 'https://...',
 *       ...
 *     }
 *   }
 * }
 */

module.exports = async function dataCorrections(rows, config = {}) {
  const skuField = config.skuField || 'SKU';
  const corrections = config.corrections || {};
  const skus = Object.keys(corrections);

  if (skus.length === 0) return rows;

  let applied = 0;
  const result = rows.map(row => {
    const sku = row[skuField];
    if (sku && corrections[sku]) {
      applied++;
      return { ...row, ...corrections[sku] };
    }
    return row;
  });

  console.log(`  ✓ Applied ${applied} correction(s) for SKU(s): ${skus.join(', ')}`);
  return result;
};
