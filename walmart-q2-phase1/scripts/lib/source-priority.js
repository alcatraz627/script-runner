/**
 * Source-priority resolver for Q2 Phase 1 cell-fill decisions.
 *
 * Given a Q2 template field name and a VCdb row's structured columns +
 * parsed Raw Content, returns { value, source } per R1.4 provenance.
 *
 * Priority rules (locked 2026-05-11, R1.5):
 *   - Year, Make, Model    → vcdb.col wins (structured, normalized)
 *   - Liter, CC, Cylinders,
 *     BlockType, SubModel,
 *     Aspiration           → vcdb.rawContent wins (vcdb.col Liter is FK-encoded)
 *   - BodyType, BodyNumDoors,
 *     FuelType, Position   → vcdb.rawContent ONLY (vcdb.col has no such cols)
 *
 * SubModel-from-Trim heuristic gets a distinct source label
 * (vcdb.rawContent.<format>.submodelFromTrim) so consumers can filter.
 */
'use strict';

const PRIORITY_VERSION = '1.0.0';

// Which VCdb column name supplies which Q2 field. null means no col source —
// rawContent is the only candidate.
const VCDB_COL_MAP = {
  Year:        'Year ID',
  Make:        'Make Name',
  Model:       'Model Name',
  SubModel:    'SubModel Name',  // we still record it but rawContent wins
  Liter:       null,             // ⚠ vcdb.col.Liter is encoded — never use
  CC:          'CC',             // rawContent wins; col is fallback
  Cylinders:   'Cylinders',      // rawContent wins
  BlockType:   'Block Type',     // rawContent wins
  Aspiration:  null,             // not in vcdb.col
  BodyType:    null,
  BodyNumDoors:null,
  FuelType:    null,
  Position:    null,
  BedLength:   null,
  DriveType:   null,
};

// Which Q2 field prefers vcdb.col vs vcdb.rawContent.
// 'col'    → use vcdb.col if non-empty, else fall back to rawContent
// 'raw'    → use vcdb.rawContent if non-empty, else fall back to vcdb.col
// 'rawOnly'→ only vcdb.rawContent (vcdb.col is structurally absent or wrong)
const PRIORITY = {
  Year:        'col',
  Make:        'col',
  Model:       'col',
  SubModel:    'raw',
  Liter:       'rawOnly',   // never trust vcdb.col Liter (encoded codes)
  CC:          'raw',
  Cylinders:   'raw',
  BlockType:   'raw',
  Aspiration:  'rawOnly',
  BodyType:    'rawOnly',
  BodyNumDoors:'rawOnly',
  FuelType:    'rawOnly',
  Position:    'rawOnly',
  BedLength:   'rawOnly',
  DriveType:   'rawOnly',
};

// Which rawContent key (output of parseRawContent) backs each Q2 field.
const RAW_FIELD_MAP = {
  Year:        'year',
  Make:        'make',
  Model:       'model',
  SubModel:    'submodel',
  Liter:       'liter',
  CC:          'cc',
  Cylinders:   'cylinders',
  BlockType:   'blockType',
  Aspiration:  'aspiration',
  BodyType:    'bodyType',
  BodyNumDoors:'bodyNumDoors',
  FuelType:    'fuelType',
  Position:    'position',
  BedLength:   null,   // no source; always blank
  DriveType:   null,   // no source; always blank
};

/**
 * Resolve one Q2 field for one VCdb row.
 *
 * @param {string} q2Field       e.g. "Year", "Liter", "BodyType"
 * @param {object} vcdbCol       VCdb structured columns for the row, keyed by header name
 * @param {object} rawContent    parseRawContent() output for the row
 * @returns {{ value: string, source: string } | null}  null when no source available
 */
function resolveField(q2Field, vcdbCol, rawContent) {
  const priority = PRIORITY[q2Field];
  if (!priority) return null;

  const rawKey = RAW_FIELD_MAP[q2Field];
  const colKey = VCDB_COL_MAP[q2Field];

  const rawVal = rawKey ? rawContent?.[rawKey] : null;
  const colVal = colKey ? vcdbCol?.[colKey] : null;

  // Empty / placeholder values count as missing.
  const isMissing = v => v == null || v === '' || v === '-' || v === '--';

  // Source-label construction
  const labelCol = colKey ? `vcdb.col.${colKey}` : null;
  const fmt = rawContent?.format || 'unknown';
  let labelRaw = rawKey ? `vcdb.rawContent.format${fmt}.${rawKey}` : null;
  // Special case: SubModel-from-trim heuristic gets a distinct label.
  if (q2Field === 'SubModel' && rawContent?.submodelDerivation === 'fromTrim') {
    labelRaw = `vcdb.rawContent.format${fmt}.submodelFromTrim`;
  }

  if (priority === 'rawOnly') {
    return isMissing(rawVal) ? null : { value: String(rawVal), source: labelRaw };
  }
  if (priority === 'col') {
    if (!isMissing(colVal)) return { value: String(colVal), source: labelCol };
    if (!isMissing(rawVal)) return { value: String(rawVal), source: labelRaw };
    return null;
  }
  if (priority === 'raw') {
    if (!isMissing(rawVal)) return { value: String(rawVal), source: labelRaw };
    if (!isMissing(colVal)) return { value: String(colVal), source: labelCol };
    return null;
  }
  return null;
}

/**
 * Convenience: resolve every Q2 field for a row.
 * Returns { Year: {value, source}, Make: {value, source}, ..., BedLength: null }.
 */
function resolveAllFields(vcdbCol, rawContent) {
  const out = {};
  for (const field of Object.keys(PRIORITY)) {
    out[field] = resolveField(field, vcdbCol, rawContent);
  }
  return out;
}

// ────────────────────── Tests ──────────────────────

const TESTS = [
  {
    label: 'Year/Make/Model → vcdb.col wins',
    vcdbCol: { 'Year ID': '1977', 'Make Name': 'Buick', 'Model Name': 'Century' },
    rawContent: { format: 'A', make: 'Buick', model: 'Century' },
    expect: {
      Year: { value: '1977', source: 'vcdb.col.Year ID' },
      Make: { value: 'Buick', source: 'vcdb.col.Make Name' },
      Model: { value: 'Century', source: 'vcdb.col.Model Name' },
    },
  },
  {
    label: 'Liter → rawOnly (vcdb.col Liter ignored even when set)',
    vcdbCol: { Liter: '20' },  // encoded code; must NOT appear
    rawContent: { format: 'B', liter: '3.5' },
    expect: {
      Liter: { value: '3.5', source: 'vcdb.rawContent.formatB.liter' },
    },
  },
  {
    label: 'Liter → null when neither has it',
    vcdbCol: {},
    rawContent: { format: 'A' },
    expect: { Liter: null },
  },
  {
    label: 'SubModel-from-Trim heuristic gets distinct label',
    vcdbCol: { 'SubModel Name': '20' },  // structured col, but raw wins
    rawContent: { format: 'C', submodel: 'Base', submodelDerivation: 'fromTrim' },
    expect: {
      SubModel: { value: 'Base', source: 'vcdb.rawContent.formatC.submodelFromTrim' },
    },
  },
  {
    label: 'BodyType, BodyNumDoors → rawOnly',
    vcdbCol: {},
    rawContent: { format: 'C', bodyType: 'Sedan', bodyNumDoors: '4' },
    expect: {
      BodyType: { value: 'Sedan', source: 'vcdb.rawContent.formatC.bodyType' },
      BodyNumDoors: { value: '4', source: 'vcdb.rawContent.formatC.bodyNumDoors' },
    },
  },
  {
    label: 'Placeholder "-" is treated as missing',
    vcdbCol: { 'Block Type': '-' },
    rawContent: { format: 'B', blockType: 'V' },
    expect: {
      BlockType: { value: 'V', source: 'vcdb.rawContent.formatB.blockType' },
    },
  },
  {
    label: 'BedLength / DriveType always null (no source)',
    vcdbCol: { },
    rawContent: { format: 'C', bodyType: 'Pickup' },
    expect: { BedLength: null, DriveType: null },
  },
];

function runTests() {
  let pass = 0, fail = 0;
  for (const t of TESTS) {
    let ok = true;
    for (const [field, expected] of Object.entries(t.expect)) {
      const got = resolveField(field, t.vcdbCol, t.rawContent);
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        ok = false;
        console.log(`  ✗ ${t.label} · ${field}\n      got:      ${JSON.stringify(got)}\n      expected: ${JSON.stringify(expected)}`);
        break;
      }
    }
    if (ok) { console.log(`  ✓ ${t.label}`); pass++; } else { fail++; }
  }
  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module && process.argv.includes('--test')) runTests();

module.exports = { resolveField, resolveAllFields, PRIORITY_VERSION, PRIORITY, VCDB_COL_MAP, RAW_FIELD_MAP };
