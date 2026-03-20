/**
 * transforms/jegs-normalize.js
 *
 * Normalizes raw JEGS eBay product rows into the standard pipeline shape.
 * Handles two attribute formats automatically:
 *   - JSON array: '[{"name":"Voltage","value":"12","uom":"volt"}]'
 *   - Semicolon-separated: "Voltage: 12 volt; Amperage: 15 amp"
 *
 * Config:
 *   { brand: 'JEGS' }  — brand name to substitute for {{brand}} in titles
 */

/** Parse attribute strings into [[name, value], ...] pairs.
 *  Handles two formats from eBay exports:
 *  - JSON array: '[{"name":"Voltage","value":"12","uom":"volt"}]'
 *  - Semicolon-separated: "Voltage: 12 volt; Amperage: 15 amp" */
function transformAttributes(attrString) {
  if (!attrString) return [];

  // JSON array format
  if (String(attrString).trimStart()[0] === '[') {
    try {
      const parsed = JSON.parse(attrString);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(a => [a.name, a.value]);
    } catch { return []; }
  }

  // Semicolon-separated "Key: Value" format
  return String(attrString)
    .split(';')
    .map(pair => pair.trim())
    .filter(pair => pair.includes(':'))
    .map(pair => {
      const idx = pair.indexOf(':');
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
    });
}

/** Parse newline-separated feature list, stripping leading numbers and bullets. */
function transformFeatures(featureString) {
  if (!featureString) return [];
  return String(featureString)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => l.replace(/^\d+\.\s*\*?\s*/, '').trim())
    .filter(l => l.length > 0);
}

/** Extract the first usable image URL from a pipe-separated list, filtering
 *  out known placeholder images and thumbnail URLs. */
function extractFirstImage(imageString) {
  if (!imageString) return '';
  const blocked = new Set([
    'https://i.ebayimg.com/00/s/MTIzM1gxNjAw/z/l94AAeSwhLdo2FOA/$_1.JPG?set_id=2',
    'https://i.ebayimg.com/images/g/1VEAAOSwBahVcLz8/s-l1600.jpg',
    'pics.ebaystatic.com/aw/pics/nextGenVit/imgNoImg.gif',
  ]);
  const images = String(imageString)
    .split('|')
    .map(u => u.trim())
    .filter(u => u && !blocked.has(u) && !u.includes('/thumbs/'));
  return images[0] || '';
}

/** Transform a single raw JEGS export row into the standard pipeline schema. */
function transformRow(row, config = {}) {
  const brand = config.brand || row['Brand'] || 'JEGS';
  return {
    'Part Number':        row['Part Number'] || '',
    'Part Type':          row['Part Type'] || '',
    'Description':        row['Description'] || '',
    'Title':              (row['Title'] || '').replace(/\{\{brand\}\}/gi, brand),
    'Attributes Small':   transformAttributes(row['attributes_essential']),
    'Attributes Full':    transformAttributes(row['attributes_complete']),
    'Features & Benefits': transformFeatures(row['Features & Benefits']),
    'Images':             row['Main Image'] || extractFirstImage(row['Images (pipe-separated)']) || '',
    'Brand':              brand,
  };
}

module.exports = async function jegsNormalize(rows, config = {}) {
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      results.push(transformRow(rows[i], config));
    } catch (e) {
      console.error(`  ✗ Row ${i + 1} (${rows[i]?.['Part Number'] || '?'}): ${e.message}`);
    }
  }
  return results;
};

// Also export helpers for reuse in one-off scripts
module.exports.transformAttributes = transformAttributes;
module.exports.transformFeatures   = transformFeatures;
module.exports.extractFirstImage   = extractFirstImage;
module.exports.transformRow        = transformRow;
