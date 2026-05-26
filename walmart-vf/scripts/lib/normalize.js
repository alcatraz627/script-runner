/**
 * lib/normalize.js — brand-agnostic helpers shared across pipeline scripts.
 *
 * Single source of truth for vocabulary, regex patterns, and value transforms.
 * Anything brand-specific lives in brands.config.js, not here.
 */
'use strict';

// ─── Units ──────────────────────────────────────────────────────────────────

// Scientific symbols where case carries meaning (W = watt, w ≠ watt).
// These bypass the lowercase normalization.
const CASE_SENSITIVE_UNITS = new Set([
  'W', 'V', 'A', 'Hz', 'Ω', '°C', '°F', 'kW', 'mA', 'mV',
]);

// Bare-numeric attribute values get a unit from this map keyed by attr name.
const KEY_UNIT_MAP = {
  weight: 'lbs', weight_lb: 'lbs', weight_oz: 'oz', weight_kg: 'kg',
  length: 'in', length_in: 'in', length_mm: 'mm', length_ft: 'ft',
  width: 'in', width_in: 'in', width_mm: 'mm',
  height: 'in', height_in: 'in', height_mm: 'mm',
  thickness: 'in', thickness_in: 'in', thickness_mm: 'mm',
  diameter: 'in', diameter_in: 'in', diameter_mm: 'mm',
  outer_diameter_in: 'in', inner_diameter_in: 'in',
  rotor_outside_diameter_in: 'in', center_hole_diameter_in: 'in',
  wattage: 'W', voltage: 'V', amperage: 'A',
  cca: 'CCA', capacity_ah: 'Ah',
  overall_cable_length: 'in',
  friction_material_thickness_inner_pad_in: 'in',
  friction_material_thickness_outer_pad_in: 'in',
};

// v6: alias map — common typos / spellings → canonical Walmart form
const UNIT_ALIASES = {
  vdc: 'V', vac: 'V',
  amps: 'A', amp: 'A',
  ohms: 'Ω', ohm: 'Ω',
  watts: 'W', watt: 'W',
  inch: 'in', inches: 'in',
  lb: 'lbs',
};

// v9: suffix-based unit detection (catches keys like centerline_length_in, package_depth_mm)
const KEY_SUFFIX_UNIT_RX = /_(in|inch|inches|mm|cm|ft|lb|lbs|oz|kg|g|w|v|a|amps?|hz|ohms?)$/i;
const KEY_SUFFIX_MAP = { in:'in', inch:'in', inches:'in', mm:'mm', cm:'cm', ft:'ft',
  lb:'lbs', lbs:'lbs', oz:'oz', kg:'kg', g:'g',
  w:'W', v:'V', a:'A', amp:'A', amps:'A', hz:'Hz', ohm:'Ω', ohms:'Ω' };

function normalizeUnit(unit, keyName) {
  if (!unit && keyName && KEY_UNIT_MAP[keyName]) return KEY_UNIT_MAP[keyName];
  if (!unit && keyName) {
    const m = keyName.match(KEY_SUFFIX_UNIT_RX);
    if (m) return KEY_SUFFIX_MAP[m[1].toLowerCase()];
  }
  if (!unit) return '';
  const u = unit.replace(/\.$/, '').trim();
  const alias = UNIT_ALIASES[u.toLowerCase()];
  if (alias) return alias;
  for (const csu of CASE_SENSITIVE_UNITS) {
    if (u.toLowerCase() === csu.toLowerCase()) return csu;
  }
  return u.toLowerCase();
}

function splitMeasureUnit(value, keyName) {
  if (value == null) return { measure: '', unit: '' };
  const s = String(value).trim();
  const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*([A-Za-z°%/Ω]+)?(?:[\s.].*)?$/);
  if (m) {
    const num = m[1].replace(',', '.');
    const unit = normalizeUnit(m[2] || '', keyName);
    return { measure: num, unit };
  }
  return { measure: '', unit: '' };
}

// ─── Colors ─────────────────────────────────────────────────────────────────

// v6: i18n expanded — Spanish, French, German common color names
const COLOR_TRANSLATE = {
  // Spanish
  'negro': 'Black', 'blanco': 'White', 'gris': 'Gray', 'rojo': 'Red',
  'azul': 'Blue', 'verde': 'Green', 'amarillo': 'Yellow', 'naranja': 'Orange',
  'marron': 'Brown', 'marrón': 'Brown', 'plateado': 'Silver', 'dorado': 'Gold',
  'natural': 'Natural', 'transparente': 'Clear',
  // French
  'noir': 'Black', 'blanc': 'White', 'gris fr': 'Gray',
  'rouge': 'Red', 'bleu': 'Blue', 'vert': 'Green', 'jaune': 'Yellow',
  'argent': 'Silver', 'or': 'Gold',
  // German
  'schwarz': 'Black', 'weiss': 'White', 'weiß': 'White',
  'grau': 'Gray', 'rot': 'Red', 'blau': 'Blue', 'gruen': 'Green', 'grün': 'Green',
  'silber': 'Silver', 'gold': 'Gold',
};

const NOUN_SUFFIX_RX = /\s+(Hose|Cap|Plug|Cover|Bracket|Clip|Filter|Bolt|Bushing|Frame)$/i;

// v7: detect multi-color values like "Black; Silver", "Black and Silver", "Black/Silver"
const MULTI_COLOR_RX = /\s*(;|,|\band\b|\/)\s*/i;

// v7: known-color list for finish-vs-color detection
// v8: + 'shiny','multi-color' (Holley)
const KNOWN_COLORS_LC = new Set([
  'black','white','gray','grey','red','blue','green','yellow','silver','gold',
  'clear','natural','brown','orange','multicolor','multi-color','beige','tan','pink','purple',
  'shiny',
]);

// v8: 'Multi-color' source variant → canonical 'Multicolor'
const COLOR_CANONICAL = { 'multi-color': 'Multicolor', 'multicolor': 'Multicolor', 'shiny': 'Silver' };

function normalizeColor(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.replace(NOUN_SUFFIX_RX, '').trim();
  // v7: multi-color → 'Multicolor' (Walmart vocab)
  const tokens = s.split(MULTI_COLOR_RX).map(t => t.trim()).filter(Boolean)
    .filter(t => !/^(and|;|,|\/)$/i.test(t));
  if (tokens.length >= 2) {
    const allColors = tokens.every(t => KNOWN_COLORS_LC.has(t.toLowerCase()) || COLOR_TRANSLATE[t.toLowerCase()]);
    if (allColors) return 'Multicolor';
  }
  const lc = s.toLowerCase();
  if (COLOR_CANONICAL[lc]) return COLOR_CANONICAL[lc];   // v8: canonicalize "Multi-color" etc.
  if (COLOR_TRANSLATE[lc]) return COLOR_TRANSLATE[lc];
  const parts = s.split(/\s+/);
  if (parts[0] && COLOR_TRANSLATE[parts[0].toLowerCase()]) {
    parts[0] = COLOR_TRANSLATE[parts[0].toLowerCase()];
    return parts.join(' ');
  }
  return s;
}

// v7: drop finish values that are actually colors mis-tagged at source
function normalizeFinish(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (KNOWN_COLORS_LC.has(s.toLowerCase())) return '';   // 'Silver' is a color, not a finish
  return s;
}

// ─── Materials ──────────────────────────────────────────────────────────────

// v6: NEW — material translation map for non-English + generic upmaps
// v8: + Zinc, Composite from Holley
const MATERIAL_TRANSLATE = {
  'acero': 'Steel', 'aluminio': 'Aluminum', 'hierro': 'Iron',
  'plastico': 'Plastic', 'plástico': 'Plastic',
  'caucho': 'Rubber', 'goma': 'Rubber',
  'cobre': 'Copper', 'laton': 'Brass', 'latón': 'Brass',
  // generic English upmaps
  'metal': 'Steel', // very generic — assume steel; user can override
  // v8 additions (Holley)
  'zinc': 'Zinc', 'composite': 'Composite',
};
function normalizeMaterial(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const mapped = MATERIAL_TRANSLATE[s.toLowerCase()];
  if (mapped) return mapped;
  // Title-case if all-lowercase single word
  if (/^[a-z]+$/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

// ─── Vehicle Make/Model ─────────────────────────────────────────────────────

const PARENT_CORP_RX = /^(GM|General Motors|Ford Motor Company|FCA|Stellantis|Toyota Motor|Chrysler Group)$/i;

const KNOWN_MAKES = new Set([
  'Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Eagle','Fiat','Ford',
  'GMC','Genesis','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar','Jeep','Kia','Land Rover',
  'Lexus','Lincoln','Mazda','Mercedes','Mercury','Mini','Mitsubishi','Nissan','Oldsmobile',
  'Plymouth','Pontiac','Porsche','Ram','Saab','Saturn','Scion','Smart','Subaru','Suzuki',
  'Tesla','Toyota','Volkswagen','Volvo','VW',
]);
const KNOWN_MAKES_LC = new Set([...KNOWN_MAKES].map(m => m.toLowerCase()));

const titleCase = s => s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());

function deriveVehicleMakesFromCompatible(compatibleCars) {
  if (!compatibleCars) return '';
  const seen = new Set();
  const display = [];
  for (const seg of String(compatibleCars).split(/;\s*/)) {
    let candidate = '';
    let m = seg.match(/^([A-Za-z][A-Za-z\-]{2,})\s/);
    if (m) candidate = m[1];
    else {
      m = seg.match(/^\d{4}\s+([A-Za-z][A-Za-z\-]{2,})/);
      if (m) candidate = m[1];
    }
    if (!candidate) continue;
    const lc = candidate.toLowerCase();
    if (!KNOWN_MAKES_LC.has(lc)) continue;
    if (seen.has(lc)) continue;
    seen.add(lc);
    const canonical = [...KNOWN_MAKES].find(km => km.toLowerCase() === lc) || titleCase(candidate);
    display.push(canonical);
  }
  return display.slice(0, 5).join('; ');
}

const GENERIC_VEHICLE_CATEGORY_RX = /^(TRUCK|CAR|SUV|VAN|SEDAN|COUPE|WAGON|HATCHBACK|CONVERTIBLE|PICKUP)$/i;
function isInvalidVehicleModel(value, mpn) {
  if (!value) return true;
  const v = String(value).trim();
  if (v === mpn) return true;
  if (/^[A-Z0-9]+(-[A-Z0-9]+)*$/i.test(v) && /\d/.test(v) && v.length === mpn.length) return true;
  if (GENERIC_VEHICLE_CATEGORY_RX.test(v)) return true;
  return false;
}

// ─── compatibleCars cleanup ─────────────────────────────────────────────────

// v6: catches Year | Make | Model | Trim | Engine in addition to | Liter:
// v7: also catch deeply-buried 'Sedan'/'Coupe'/'SUV' body-style tokens between pipes
// v8: also catch lines starting with "YYYY ALLCAPS_MAKE ALLCAPS_MODEL" (e.g. "2012 TOYOTA RAV4")
const VCDB_PIPE_RX = /\|\s*[A-Z][a-zA-Z]+\s*\|\s*[A-Z][a-zA-Z0-9]+|(\bSedan|\bCoupe|\bWagon|\bSUV|\bHatchback|\bConvertible|\bPickup)\s+\d-?Door/i;
const VCDB_ALLCAPS_RX = /^\d{4}\s+[A-Z]{2,}\s+[A-Z][A-Z0-9\-]+/;

function buildCompatibleVehicles(scrape) {
  const lines = scrape?.byKey?.fitment || [];
  if (!lines.length) return { value: '', source: '' };
  const seenLc = new Set();
  const out = [];
  for (const e of lines) {
    let v = String(e.value || '').trim();
    if (!v) continue;
    v = v.replace(/\s*Read more.*$/i, '').trim();
    v = v.replace(/^Guaranteed to Fit\s+/i, '').trim();
    v = v.replace(/^Fits select:\s*/i, '').trim();
    if (/, \d{4}/.test(v)) v = v.replace(/,\s*(\d{4})/g, '; $1');
    if (/Year:\s*\d{4}\s*\|\s*Make:/i.test(v)) continue;
    if (/\|\s*Liter:/i.test(v)) continue;
    if (VCDB_PIPE_RX.test(v)) continue;          // v6: catches | Trim: | Engine: structured-pipe
    if (VCDB_ALLCAPS_RX.test(v)) continue;       // v8: catches "2012 TOYOTA RAV4 | …" (allcaps make+model)
    v = v.replace(/\s*\|\s*(Quantity needed per vehicle|Notes):.*$/i, '').trim();
    if (/^(Liter|Aspiration|Engine Type|Engine Vin|CUI|SubModel):/i.test(v)) continue;
    if (!v) continue;
    const lc = v.toLowerCase();
    if (seenLc.has(lc)) continue;
    seenLc.add(lc);
    out.push(v);
  }
  let joined = out.join('; ');
  if (joined.length > 4000) {
    const trimmed = []; let len = 0;
    for (const ln of out) {
      if (len + ln.length + 2 > 3990) break;
      trimmed.push(ln); len += ln.length + 2;
    }
    joined = trimmed.join('; ') + ' …';
  }
  return { value: joined, source: 'scrape.fitment(joined)' };
}

// ─── Fitment cascade ────────────────────────────────────────────────────────

function computeFitmentType(row, scrape) {
  const partFit = scrape?.byKey?.part_fitment?.[0]?.value;
  if (partFit) return { value: /universal/i.test(partFit) ? 'Universal' : 'Specific', source: 'scrape.part_fitment', raw: partFit };
  const vft = scrape?.byKey?.vehicle_fitment_type?.[0]?.value;
  if (vft) return { value: 'Specific', source: 'scrape.vehicle_fitment_type', raw: vft };
  const sfl = scrape?.byKey?.fitment?.length || 0;
  if (sfl > 0) return { value: 'Specific', source: 'scrape.fitment', raw: `${sfl} lines` };
  if (row.fitment) return { value: 'Specific', source: 'source.fitment', raw: `${row.fitment.length} chars` };
  return { value: '', source: '', raw: '' };
}

// ─── Attribute lookup helpers ───────────────────────────────────────────────

// v10: per user rule, prefer _in keys over _mm/_cm when both available.
// This sorts the lookup-key list so 'length_in' is checked before 'length_mm'.
// NEVER converts between units — just changes search order.
function preferInchKeys(keys) {
  const inFirst = [], rest = [];
  for (const k of keys) {
    if (/_in$/i.test(k) || /^(length|width|height|diameter|thickness)$/i.test(k)) inFirst.push(k);
    else rest.push(k);
  }
  return [...inFirst, ...rest];
}

function pickFirstAttr(row, scrape, keys) {
  const ordered = preferInchKeys(keys);
  for (const k of ordered) {
    const v = row.attributes[k];
    if (v) return { value: v, key: k, source: 'source.attributes' };
  }
  for (const k of ordered) {
    const v = scrape?.byKey?.[k]?.[0]?.value;
    if (v) return { value: v, key: k, source: 'scrape' };
  }
  return null;
}

function fillDimension(row, scrape, keys) {
  const hit = pickFirstAttr(row, scrape, keys);
  if (!hit) return { measure: '', unit: '', source: '' };
  const split = splitMeasureUnit(hit.value, hit.key);
  return { measure: split.measure, unit: split.unit, source: `${hit.source}.${hit.key}` };
}

function buildDimensionsString(row, scrape) {
  const L = pickFirstAttr(row, scrape, ['length_in','length','length_mm']);
  const W = pickFirstAttr(row, scrape, ['width_in','width','width_mm']);
  const H = pickFirstAttr(row, scrape, ['height_in','height','height_mm']);
  if (!L || !W || !H) return { value: '', source: '' };
  const fmt = (hit) => {
    const split = splitMeasureUnit(hit.value, hit.key);
    if (!split.measure) return '';
    const unit = split.unit || (hit.key.endsWith('_mm') ? 'mm' : 'in');
    return `${split.measure} ${unit}`;
  };
  const Ls = fmt(L), Ws = fmt(W), Hs = fmt(H);
  if (!Ls || !Ws || !Hs) return { value: '', source: '' };
  return { value: `${Ls} x ${Ws} x ${Hs}`, source: `derived from ${L.key}+${W.key}+${H.key}` };
}

// ─── items_included sanity ──────────────────────────────────────────────────

function isJunkItemsIncluded(s) {
  return /ONLY PART REFERENCE #\d+ ON THE DIAGRAM IS INCLUDED/i.test(s) || !s.trim();
}
function isJunkItemsValue(s) {
  if (!s) return true;
  const t = String(s).trim();
  if (t.length < 3) return true;
  if (/^\d+$/.test(t)) return true;
  return false;
}

// ─── Conditions vocab (v6: Remanufactured added) ────────────────────────────

const KNOWN_CONDITIONS = new Set(['New', 'Used', 'Refurbished', 'Open Box', 'Remanufactured']);

// ─── Loadsheet text normalize (used at cell-write boundary) ─────────────────

function normalizeText(v) {
  if (typeof v !== 'string') return v;
  return v
    .replace(/‑/g, '-')
    .replace(/–/g, '-')
    .replace(/—/g, ' - ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .replace(/…/g, '...');
}

// ─── CSV parse (used by 20-fill to read measure-unit-proposals.csv) ─────────

function parseCsv(text) {
  const out = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else if (ch === '"' && cur === '') q = true;
      else cur += ch;
    }
    cells.push(cur); out.push(cells);
  }
  return out;
}

// v11: split numbered Features text "1. foo: bar 2. baz: qux …" into bullets
function splitFeaturesBullets(featuresText) {
  if (!featuresText) return [];
  // Walmart's KeyFeature cell limit is ~80 chars; we'll cap each bullet at 80.
  const parts = String(featuresText).split(/\s*\d+\.\s+/).map(s => s.trim()).filter(Boolean);
  return parts.slice(0, 5).map(p => p.length > 200 ? p.slice(0, 197) + '…' : p);
}

// v11: derive vehicle year range from compatibleCars text
//   "Buick Century (1977); Chevrolet Astro (1996-2005)" → "1977-2005"
function deriveVehicleYearRange(compatibleCarsText) {
  if (!compatibleCarsText) return '';
  const yearRx = /\b(19|20)\d{2}\b/g;
  const years = (String(compatibleCarsText).match(yearRx) || []).map(Number);
  if (!years.length) return '';
  const min = Math.min(...years), max = Math.max(...years);
  return min === max ? String(min) : `${min}-${max}`;
}

// v11: Part Type → Walmart Automotive Parts Division (high-level bucket)
//   Built from observed ACDelco/Dorman/Holley/Dayco part types.
//   Walmart's published vocabulary: Brakes, Engine, Electrical, Drivetrain,
//   Suspension, Steering, Fuel, Cooling, HVAC, Body, Exhaust, Filtration, Other.
const PARTS_DIVISION_MAP = [
  [/disc brake|drum brake|brake.*hose|brake.*pad|brake.*rotor|brake.*caliper|brake.*hardware|brake hydraulic|anti-rattle|parking brake|master cylinder|brake fluid|wheel.*hub|wheel bearing/i, 'Brakes'],
  [/spark plug|ignition coil|starter motor|alternator|battery|wiring harness|connector|bulb|lamp|light|sensor|switch|amplifier|antenna|window regulator|door lock|abs.*sensor|ignition|distributor cap|rotor kit|electric fuel pump|fuel pump|coil|reference book/i, 'Electrical'],
  [/suspension|strut|shock|stabilizer|ball joint|bushing|control arm|knuckle|tie rod|sway bar|leaf spring|coil spring|chassis/i, 'Suspension'],
  [/steering|tie rod|rack and pinion|power steering/i, 'Steering'],
  [/intake manifold|exhaust manifold|cylinder|valve|piston|crankshaft|camshaft|vvt|valve timing|engine.*air filter|air cleaner|carburetor|carb|jet|metering|throttle|drive belt|tensioner|timing belt|serpentine|accessory drive|crank.*seal|engine variable|engine timing|engine valve|engine intake|engine balanc|valve cover|hydraulic fitting|winch hydraulic/i, 'Engine'],
  [/coolant|radiator|thermostat|coolant hose|engine coolant|hvac|heater hose|cabin air filter/i, 'Cooling'],
  [/fuel hose|fuel filter|fuel tank|fuel line|gasoline|fuel pickup/i, 'Fuel'],
  [/exhaust|muffler|catalytic|tail pipe|egr/i, 'Exhaust'],
  [/oil filter|air filter|cabin filter|filter housing/i, 'Filtration'],
  [/hose merchandiser|hose|hose fitting|connector|seal|gasket|o-ring|grommet|vacuum/i, 'Engine'],   // generic hoses/seals → Engine bucket
  [/body|door|window|hood|fender|bumper|mirror|trim|latch|lock|cable|bracket|kit/i, 'Body'],
  [/differential|universal joint|transmission|driveshaft|axle|cv joint|pinion|drivetrain/i, 'Drivetrain'],
  [/belt|tensioner|pulley|idler/i, 'Engine'],
];
function derivePartsDivision(partType) {
  if (!partType) return '';
  for (const [rx, division] of PARTS_DIVISION_MAP) {
    if (rx.test(partType)) return division;
  }
  return '';   // no fabrication — empty if unmatched
}

module.exports = {
  splitFeaturesBullets, deriveVehicleYearRange, derivePartsDivision,
  CASE_SENSITIVE_UNITS, KEY_UNIT_MAP, UNIT_ALIASES, COLOR_TRANSLATE, MATERIAL_TRANSLATE,
  KNOWN_MAKES, KNOWN_MAKES_LC, KNOWN_CONDITIONS, KNOWN_COLORS_LC,
  PARENT_CORP_RX, GENERIC_VEHICLE_CATEGORY_RX,
  splitMeasureUnit, normalizeUnit, normalizeColor, normalizeFinish, normalizeMaterial, titleCase,
  deriveVehicleMakesFromCompatible, isInvalidVehicleModel,
  computeFitmentType, buildCompatibleVehicles, buildDimensionsString,
  pickFirstAttr, fillDimension,
  isJunkItemsIncluded, isJunkItemsValue,
  normalizeText, parseCsv,
};
