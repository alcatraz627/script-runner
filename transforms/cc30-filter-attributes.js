/**
 * transforms/cc30-filter-attributes.js
 *
 * Filters original_attributes down to final_attributes, keeping only
 * physical/technical specification keys via a blacklist approach.
 *
 * Output adds:
 *   final_attributes: [ { key: "<raw_key>", value: "<value>" } ]
 */

// Keys extracted into dedicated columns
const EXTRACTED_KEYS = new Set([
  'brand', 'line', 'mpn', 'title', 'part_type', 'fitment', 'image_url',
]);

// Metadata / non-spec keys
const METADATA_KEYS = new Set([
  'price', 'currency', 'pricecurrency', 'price_currency',
  'description', 'description_interchange',
  'part_fitment', 'part_category', 'part_number',
  'full_part_number', 'full_mpn', 'mpn_formatted',
  'base_mpn', 'secondary_mpn', 'alt_mpn', 'alternate_mpn',
  'family', 'group', 'page',
  'interchange', 'interchange_part_number',
  'shipping_weight', 'package_depth', 'package_height', 'package_width',
  'compare_to', 'note', 'application_note', 'compatibility_note',
  'replace_factory_oe_part_number', 'replace_oe_ford_part_number', 'replace_part_number',
  'oem_replacement', 'oem_capable', 'original_equipment_replacement',
]);

// Feature / descriptive keys (not specs)
const FEATURE_KEYS = new Set([
  'feature', 'feature_1', 'feature_2', 'feature_3', 'feature_4',
  'meet_or_exceed_original_equipment_manu',
  'installation',
]);

// Fitment / vehicle compatibility keys (dumped into fitment_extracted)
const FITMENT_KEYS = new Set([
  'fitment_note', 'fitment_information', 'fitment_overview', 'fitment_summary',
  'vehicle_fitment_summary', 'vehicle_make', 'vehicle_model',
  'compatible_vehicle', 'compatible_vehicle_1', 'compatible_vehicle_2',
  'make', 'model', 'engine', 'engine_compatibility', 'engine_make_size', 'engine_balance',
  'transmission', 'transmission_type', 'tran_model',
  'universal', 'universal_or_specific_fit', 'direct_fit',
  'compatibility', 'fits', 'for_use_on', 'placement', 'location',
]);

// Regulatory / condition keys
const REGULATORY_KEYS = new Set([
  'country_of_origin', 'carb_eo_number', 'sfi_approved', 'new_or_remanufactured',
]);

// Combined blacklist
const EXCLUDE = new Set([
  ...EXTRACTED_KEYS, ...METADATA_KEYS, ...FEATURE_KEYS, ...FITMENT_KEYS, ...REGULATORY_KEYS,
]);

module.exports = async function cc30FilterAttributes(rows, config = {}, { onEvent } = {}) {
  const emit = onEvent || (() => {});

  let totalKept = 0;
  let totalDropped = 0;
  const droppedKeys = {};

  const results = rows.map(product => {
    const attrs = product.original_attributes || [];
    const final = [];

    for (const attr of attrs) {
      if (EXCLUDE.has(attr.key)) {
        totalDropped++;
        droppedKeys[attr.key] = (droppedKeys[attr.key] || 0) + 1;
        continue;
      }
      final.push({
        key: attr.raw_key,
        value: attr.value,
      });
      totalKept++;
    }

    return {
      ...product,
      final_attributes: final,
    };
  });

  emit({
    type: 'info',
    message: `final_attributes: kept ${totalKept}, dropped ${totalDropped} across ${results.length} products`,
  });

  // Unique keys kept
  const keptKeys = new Set();
  for (const p of results) {
    for (const a of p.final_attributes) keptKeys.add(a.key);
  }
  emit({
    type: 'info',
    message: `Unique keys in final_attributes: ${keptKeys.size}`,
  });

  return results;
};
