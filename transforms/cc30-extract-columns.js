/**
 * transforms/cc30-extract-columns.js
 *
 * Extracts specific attribute keys into dedicated top-level columns:
 *   - key: "part_type" → "Part Type" (fallback: "line")
 *   - key: "image_url" → "Image"
 *   - key: "title"     → "original_title"
 *   - key: "fitment"   → "raw_fitment" (array of all fitment values)
 *   - keys: "universal", "universal_or_specific_fit", "direct_fit" → "fit_type" (normalized)
 *   - keys: "make", "model", "engine*", "transmission*", "tran_model" → "fitment_extracted" dict
 *
 * Validation (warnings only, no data changes):
 *   - key: "brand" → check value matches product "Brand"
 *   - key: "mpn"   → check value matches product "Part Number"
 */

module.exports = async function cc30ExtractColumns(rows, config = {}, { onEvent } = {}) {
  const emit = onEvent || (() => {});
  const warnings = [];

  const results = rows.map((product, idx) => {
    const attrs = product.original_attributes || [];
    const out = { ...product };

    // Helper: find first attribute value by key
    const findValue = (key) => {
      const attr = attrs.find(a => a.key === key);
      return attr ? attr.value : null;
    };

    // Helper: find all values for a key
    const findAllValues = (key) => {
      return attrs.filter(a => a.key === key).map(a => a.value);
    };

    // ── Part Type: prefer "part_type", fallback to "line", then "part_category" ──
    out['Part Type'] = findValue('part_type') || findValue('line') || findValue('part_category') || '';

    // ── Image: prepend base URL to relative paths ──
    const rawImage = findValue('image_url') || '';
    if (rawImage && !rawImage.startsWith('http')) {
      out['Image'] = 'https://www.jegs.com' + (rawImage.startsWith('/') ? '' : '/') + rawImage;
    } else {
      out['Image'] = rawImage;
    }

    // ── Original Title ──
    out['original_title'] = findValue('title') || '';

    // ── Raw Fitment (array of all fitment entries) ──
    out['raw_fitment'] = findAllValues('fitment');

    // ── Fit Type: normalize from universal/universal_or_specific_fit/direct_fit ──
    const universalVal = findValue('universal');
    const uosfVal = findValue('universal_or_specific_fit');
    const directFitVal = findValue('direct_fit');

    if (uosfVal) {
      // Values like "Universal", "Specific Fit", etc. — use as-is, title-cased
      out['fit_type'] = uosfVal;
    } else if (universalVal) {
      // "Yes" → "Universal", anything else pass through
      const uLower = String(universalVal).toLowerCase().trim();
      out['fit_type'] = (uLower === 'yes' || uLower === 'true') ? 'Universal'
        : (uLower === 'no' || uLower === 'false') ? 'Vehicle-Specific'
        : universalVal;
    } else if (directFitVal) {
      const dLower = String(directFitVal).toLowerCase().trim();
      out['fit_type'] = (dLower === 'yes' || dLower === 'true') ? 'Direct Fit'
        : (dLower === 'no' || dLower === 'false') ? 'Universal'
        : directFitVal;
    } else {
      out['fit_type'] = '';
    }

    // ── Fitment Extracted: vehicle compatibility keys → dict ──
    const FITMENT_KEYS = new Set([
      'make', 'model', 'engine', 'engine_compatibility', 'engine_make_size',
      'engine_balance', 'transmission', 'transmission_type', 'tran_model',
    ]);
    const fitmentExtracted = {};
    for (const a of attrs) {
      if (FITMENT_KEYS.has(a.key)) {
        if (fitmentExtracted[a.key]) {
          // Multiple values for same key — collect as array
          if (!Array.isArray(fitmentExtracted[a.key])) {
            fitmentExtracted[a.key] = [fitmentExtracted[a.key]];
          }
          fitmentExtracted[a.key].push(a.value);
        } else {
          fitmentExtracted[a.key] = a.value;
        }
      }
    }
    out['fitment_extracted'] = fitmentExtracted;

    // ── Validation: brand match ──
    const brandAttr = findValue('brand');
    if (brandAttr && product['Brand'] && brandAttr !== product['Brand']) {
      warnings.push({
        partNumber: product['Part Number'],
        field: 'brand',
        expected: product['Brand'],
        actual: brandAttr,
      });
    }

    // ── Validation: mpn match ──
    const mpnAttr = findValue('mpn');
    if (mpnAttr && product['Part Number'] && mpnAttr !== product['Part Number']) {
      warnings.push({
        partNumber: product['Part Number'],
        field: 'mpn',
        expected: product['Part Number'],
        actual: mpnAttr,
      });
    }

    return out;
  });

  // Report warnings
  if (warnings.length > 0) {
    emit({
      type: 'warn',
      message: `${warnings.length} validation warning(s) found`,
    });
    for (const w of warnings) {
      emit({
        type: 'warn',
        message: `  ${w.partNumber}: ${w.field} mismatch — expected "${w.expected}", got "${w.actual}"`,
      });
    }
  } else {
    emit({ type: 'info', message: 'Validation passed: all brand/mpn values match' });
  }

  // Summary
  const withPartType = results.filter(r => r['Part Type']).length;
  const withImage = results.filter(r => r['Image']).length;
  const withTitle = results.filter(r => r['original_title']).length;
  const withFitment = results.filter(r => r['raw_fitment'].length > 0).length;
  const withFitType = results.filter(r => r['fit_type']).length;
  const withFitExtracted = results.filter(r => Object.keys(r['fitment_extracted']).length > 0).length;

  emit({
    type: 'info',
    message: `Extracted: Part Type=${withPartType}, Image=${withImage}, title=${withTitle}, fitment=${withFitment}, fit_type=${withFitType}, fitment_extracted=${withFitExtracted} / ${results.length} products`,
  });

  return results;
};
