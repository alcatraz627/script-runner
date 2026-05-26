#!/usr/bin/env node
/**
 * 20-fill.js — brand-parameterized
 *   node 20-fill.js --brand <brandKey>
 *
 * Combines brand source + lookups + scrape + measure-unit proposal CSV
 * into 02-${brandKey}-filled.json with provenance per cell.
 *
 * v6: shared helpers from lib/normalize.js — including i18n color/material maps
 * and broader compatibleCars VCdb-leak filter.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BRANDS = require('./brands.config.js');
const N = require('./lib/normalize.js');

const args = process.argv.slice(2);
const brandKey = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const cfg = BRANDS[brandKey];
if (!cfg) { console.error(`Unknown --brand "${brandKey}"`); process.exit(1); }

const D = path.join(__dirname, '..', 'data');
const O = path.join(__dirname, '..', 'output');
const SCRIPTS_ROOT = path.join(__dirname, '..', '..');

const SOURCE = JSON.parse(fs.readFileSync(path.join(D, `01-${brandKey}-source.json`), 'utf8'));
const BRAND  = JSON.parse(fs.readFileSync(path.join(D, 'brand-mapping-by-mpn.json'), 'utf8'));
const ENH    = JSON.parse(fs.readFileSync(path.join(D, 'enhanced-content-by-mpn.json'), 'utf8'));
const TAX    = JSON.parse(fs.readFileSync(path.join(D, 'taxonomy-by-mpn.json'), 'utf8'));
const SCRAPE = JSON.parse(fs.readFileSync(path.join(D, `fullscrape-by-mpn-${brandKey}.json`), 'utf8'));

// v10: load user-confirmed measure/unit overrides (from interactive wizard)
const OVERRIDES_FILE = path.join(D, '_user-measure-overrides.json');
const userOverrides = fs.existsSync(OVERRIDES_FILE) ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')) : {};

const csvRows = N.parseCsv(fs.readFileSync(path.join(O, `measure-unit-proposals-${brandKey}.csv`), 'utf8'));
const csvHdr = csvRows[0]; const ix = {}; csvHdr.forEach((h, i) => ix[h] = i);
const measureMap = {};
for (const r of csvRows.slice(1)) {
  const pt = r[ix['partType']];
  measureMap[pt] = {
    key: r[ix['user_override_key']] || r[ix['proposed_key']] || '',
    source: r[ix['user_override_source']] || r[ix['proposed_source']] || '',
    forcedUnit: r[ix['forced_unit']] || '',
    skip: (r[ix['skip']] || '').toLowerCase().startsWith('y'),
  };
}

async function readV9Col48() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(SCRIPTS_ROOT, 'walmart-loadsheet-filled-v9.xlsx'));
  const ws = wb.getWorksheet('Product Content And Site Exp');
  const out = {};
  for (let r = 6; r <= ws.rowCount; r++) {
    const mpn = ws.getRow(r).getCell(27).value;
    const mpnStr = mpn == null ? '' : (mpn.text != null ? mpn.text : String(mpn));
    if (!mpnStr) continue;
    const items = ws.getRow(r).getCell(48).value;
    const itemsStr = items == null ? '' : (items.text != null ? items.text : String(items));
    if (itemsStr) out[mpnStr] = itemsStr;
  }
  return out;
}

// v8: image sideload from v10 — col 17 mainImageUrl + col 19 productSecondaryImageURL
async function readV10Images() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(SCRIPTS_ROOT, 'walmart-loadsheet-filled-v10.xlsx'));
  const ws = wb.getWorksheet('Product Content And Site Exp');
  const out = {};
  const cellStr = c => c == null ? '' : (c.text != null ? c.text : (typeof c === 'object' && c.hyperlink ? c.hyperlink : String(c)));
  for (let r = 6; r <= ws.rowCount; r++) {
    const mpn = cellStr(ws.getRow(r).getCell(27).value);
    if (!mpn) continue;
    const main  = cellStr(ws.getRow(r).getCell(17).value);
    const sec18 = cellStr(ws.getRow(r).getCell(18).value);
    const sec19 = cellStr(ws.getRow(r).getCell(19).value);
    if (main || sec18 || sec19) out[mpn] = { mainImageUrl: main, secondaryImageURL_18: sec18, secondaryImageURL_19: sec19 };
  }
  return out;
}

// v9: FAB-driven measure/unit recovery for rows the proposal CSV couldn't fill
const PART_TYPE_PREFER_UNIT = [
  [/bulb|lamp/i,                 ['W', 'V']],
  [/spark plug/i,                ['mm', 'in']],
  [/battery/i,                   ['CCA', 'Ah', 'V']],
  [/alternator|starter/i,        ['A', 'V']],
  [/filter|gasket|seal|hose|bushing|clip|bracket|pad set|hardware kit|connector|bearing|joint/i, ['in', 'mm']],
  [/rotor/i,                     ['in']],
  [/cable/i,                     ['in', 'ft']],
  [/strut|tensioner/i,           ['in']],
  [/regulator|switch|solenoid|valve|sensor/i, ['in', 'V']],
  [/belt/i,                      ['in', 'mm']],
];
const FAB_NUM_UNIT_RX = /\b(\d{1,4}(?:\.\d{1,3})?)\s*(in\.?|inches?|mm|cm|ft|lbs?|oz|kg|W|V(?:DC)?|A(?:mps?)?|CCA|Ah)\b/gi;
function fabRecover(partType, fabText) {
  if (!fabText) return null;
  let expectedSet = new Set(['in','mm','lbs','w','v','a']);
  for (const [rx, units] of PART_TYPE_PREFER_UNIT) if (rx.test(partType)) { expectedSet = new Set(units.map(u => u.toLowerCase())); break; }
  const candidates = [];
  let m; FAB_NUM_UNIT_RX.lastIndex = 0;
  while ((m = FAB_NUM_UNIT_RX.exec(fabText)) !== null) {
    let u = m[2].toLowerCase().replace(/\.$/, '');
    if (u === 'inch' || u === 'inches') u = 'in';
    if (u === 'lb') u = 'lbs';
    if (u === 'amp' || u === 'amps') u = 'a';
    if (u === 'vdc') u = 'v';
    if (expectedSet.has(u)) {
      const display = (u === 'w' ? 'W' : u === 'v' ? 'V' : u === 'a' ? 'A' : u === 'cca' ? 'CCA' : u === 'ah' ? 'Ah' : u);
      candidates.push({ measure: m[1], unit: display, position: m.index });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.position - b.position);
  return { measure: candidates[0].measure, unit: candidates[0].unit };
}

function quantityToPieceCount(qStr) {
  if (!qStr) return null;
  const s = String(qStr).trim();
  if (/sold individually/i.test(s)) return 1;
  if (/^\d+$/.test(s)) return parseInt(s);
  const m = s.match(/(\d+)\s*x\s*(\d+)\s*pack/i);
  if (m) return parseInt(m[1]);
  return null;
}

(async () => {
  const v9Items = await readV9Col48();
  const v10Images = await readV10Images();
  const out = [];

  for (const row of SOURCE) {
    const mpn = row.mpn;
    const enh = ENH[mpn], brand = BRAND[mpn], tax = TAX[mpn], scrape = SCRAPE[mpn];

    const cells = {};
    cells.sku             = { value: mpn, source: 'source.Part Number (=mpn)' };
    cells.specProductType = { value: 'Automotive Specialty Parts', source: 'constant' };
    cells.productIdType   = { value: 'Part Number', source: 'constant' };
    cells.productId       = { value: mpn, source: 'source.Part Number (=mpn)' };
    cells.brand           = { value: cfg.outputBrandString, source: 'constant' };

    // v11: Product Name (col 8) — from Enhanced Content title
    cells.productName = enh?.title
      ? { value: String(enh.title).slice(0, 199), source: 'enhanced.title' }
      : (row.title ? { value: String(row.title).slice(0, 199), source: 'source.Title' } : { value: '', source: '' });

    // v11: Site Description (col 12) — from Enhanced Content description
    cells.shortDescription = enh?.description
      ? { value: String(enh.description).slice(0, 4000), source: 'enhanced.description' }
      : { value: '', source: '' };

    // v12: Key Features (col 13 parent) and Key Feature 1/2/3 (cols 14/15/16)
    //   col 13: bulleted, all items, separated by '\n• ' prefix
    //   cols 14/15/16: first 3 items individually
    const bullets = N.splitFeaturesBullets(enh?.features || '');
    cells.keyFeatures_0 = bullets.length
      ? { value: bullets.map(b => '• ' + b).join('\n'), source: 'enhanced.features (bulleted, all items)' }
      : { value: '', source: '' };
    cells.keyFeatures_1 = bullets[0] ? { value: bullets[0], source: 'enhanced.features (item 1)' } : { value: '', source: '' };
    cells.keyFeatures_2 = bullets[1] ? { value: bullets[1], source: 'enhanced.features (item 2)' } : { value: '', source: '' };
    cells.keyFeatures_3 = bullets[2] ? { value: bullets[2], source: 'enhanced.features (item 3)' } : { value: '', source: '' };

    // v11: Total Count (col 21) — from quantity attr
    const cntHit = N.pickFirstAttr(row, scrape, ['quantity', 'pack_quantity', 'count']);
    if (cntHit) {
      const n = quantityToPieceCount(cntHit.value);
      cells.count = (n != null) ? { value: n, source: `${cntHit.source}.${cntHit.key} (parsed)` } : { value: 1, source: 'default 1' };
    } else cells.count = { value: 1, source: 'default 1' };

    // v11: Multipack Quantity (col 22) — hardcode 1 (matches prior pipeline)
    cells.multipackQuantity = { value: 1, source: 'constant (single-pack default)' };

    // v11: Automotive Specialty Part Type (col 24) — partType
    cells.automotive_specialty_part_type = row.partType
      ? { value: String(row.partType).slice(0, 250), source: 'source.Part Type' }
      : { value: '', source: '' };

    // v11: Automotive Parts Division (col 42) — derive from part type
    const div = N.derivePartsDivision(row.partType);
    cells.automotivePartsDivision = div
      ? { value: div, source: `derived from partType "${row.partType}"` }
      : { value: '', source: 'no division mapping' };

    // v8: image sideload from v10 (cols 17 + 19) — fallback to scrape image_url
    const v10img = v10Images[mpn] || {};
    const scrapeImg = scrape?.byKey?.image_url?.[0]?.value || '';
    // v10.2: only accept absolute URLs (http:// or https://). Reject relative paths like /images/mini_100/...
    const isAbsoluteUrl = (s) => /^https?:\/\//i.test(String(s || ''));
    const scrapeImg2 = scrape?.byKey?.image_url?.[1]?.value || '';   // 2nd scrape image
    cells.mainImageUrl = isAbsoluteUrl(v10img.mainImageUrl)
      ? { value: v10img.mainImageUrl, source: 'sideload v10.col17' }
      : (isAbsoluteUrl(scrapeImg) ? { value: scrapeImg, source: 'fallback scrape.image_url[0]' }
                                  : { value: '', source: v10img.mainImageUrl ? `rejected (was '${String(v10img.mainImageUrl).slice(0,40)}', not absolute URL)` : '' });
    // v11: col 18 (additional image) — pair with col 19; pull from v10.col18 or scrape.image_url[1]
    cells.productSecondaryImageURL_18 = isAbsoluteUrl(v10img.secondaryImageURL_18)
      ? { value: v10img.secondaryImageURL_18, source: 'sideload v10.col18' }
      : (isAbsoluteUrl(scrapeImg2) ? { value: scrapeImg2, source: 'fallback scrape.image_url[1]' } : { value: '', source: '' });
    cells.productSecondaryImageURL = isAbsoluteUrl(v10img.secondaryImageURL_19)
      ? { value: v10img.secondaryImageURL_19, source: 'sideload v10.col19' }
      : { value: '', source: v10img.secondaryImageURL_19 ? `rejected (was relative path)` : '' };

    const shipW = N.pickFirstAttr(row, scrape, ['weight_lb', 'weight', 'shipping_weight']);
    if (shipW) {
      const split = N.splitMeasureUnit(shipW.value, shipW.key);
      cells.ShippingWeight = { value: split.measure || '', source: `${shipW.source}.${shipW.key}` };
    } else cells.ShippingWeight = { value: '', source: '' };

    const condHit = N.pickFirstAttr(row, scrape, ['condition']);
    cells.condition = condHit
      ? (() => {
          const v = String(condHit.value).trim();
          // v6: known conditions vocabulary including Remanufactured
          if (N.KNOWN_CONDITIONS.has(v)) return { value: v, source: `${condHit.source}.condition` };
          if (/^new/i.test(v))   return { value: 'New', source: `${condHit.source}.condition (canonicalized)` };
          if (/reman/i.test(v))  return { value: 'Remanufactured', source: `${condHit.source}.condition (canonicalized)` };
          if (/refurb/i.test(v)) return { value: 'Refurbished', source: `${condHit.source}.condition (canonicalized)` };
          return { value: v, source: `${condHit.source}.condition` };
        })()
      : { value: 'New', source: 'default (no condition seen)' };

    const warrHit = N.pickFirstAttr(row, scrape, ['warranty', 'warranty_special', 'manufacturer_warranty', 'warranty_information']);
    cells.has_written_warranty = warrHit ? { value: 'Yes', source: `derived from ${warrHit.source}.${warrHit.key}` } : { value: '', source: '' };

    cells.manufacturerPartNumber = { value: mpn, source: 'source.Part Number' };

    // Primary measure / unit
    const proposal = measureMap[row.partType] || {};
    let measureVal = '', unitVal = '', measureSource = '', missingMeasure = false;
    if (proposal.skip) { missingMeasure = true; measureSource = 'skipped'; }
    else if (proposal.key) {
      let raw;
      if (proposal.source.startsWith('scrape')) {
        raw = scrape?.byKey?.[proposal.key]?.[0]?.value;
        measureSource = `scrape.${proposal.key}`;
      } else {
        raw = row.attributes[proposal.key];
        measureSource = `source.attributes.${proposal.key}`;
      }
      if (raw != null && raw !== '') {
        const split = N.splitMeasureUnit(raw, proposal.key);
        measureVal = split.measure;
        unitVal = proposal.forcedUnit || split.unit;
        if (!measureVal) missingMeasure = true;
      } else { missingMeasure = true; measureSource = `MISSING from ${proposal.source}`; }
    } else { missingMeasure = true; measureSource = 'no proposed key'; }
    // v9: FAB-recovery fallback if measure or unit is still missing
    if ((!measureVal || !unitVal) && enh?.features) {
      const rec = fabRecover(row.partType, enh.features);
      if (rec) {
        if (!measureVal) measureVal = rec.measure;
        if (!unitVal)    unitVal = rec.unit;
        measureSource = (measureSource && !measureSource.startsWith('no proposed') && !measureSource.startsWith('MISSING') && !measureSource.startsWith('skipped'))
          ? `${measureSource} + FAB-recovery` : `FAB-recovery from features`;
        if (measureVal) missingMeasure = false;
      }
    }
    // v10: user override has final say
    const overrideKey = `${brandKey}:${mpn}`;
    const userOverride = userOverrides[overrideKey];
    if (userOverride && userOverride.measure) {
      measureVal = userOverride.measure;
      unitVal = userOverride.unit;
      measureSource = `user-override:${userOverride.source}`;
      missingMeasure = false;
    }
    cells.measure = { value: measureVal, source: measureSource };
    cells.unit    = { value: unitVal, source: measureSource };

    cells.vehicleCategory = { value: 'Auto Accessories', source: 'constant' };
    const fitInfo = N.computeFitmentType(row, scrape);
    cells.vehicle_fitment_type = { value: fitInfo.value, source: fitInfo.source, raw: fitInfo.raw };
    cells.aaiaBrandID = {
      value: brand?.brandCode || '',
      source: brand ? 'brand-mapping.Brand Code' : '',
      extras: brand ? { mapped: brand.mapped, confidence: brand.confidence, parentCode: brand.parentCode } : null,
    };
    // v12: Additional Features (col 33) — multi-line points (no bullets, just \n)
    cells.features = enh?.features
      ? { value: bullets.length ? bullets.join('\n') : String(enh.features), source: 'enhanced.Features and Benefits (newline-joined, no numbering)' }
      : { value: '', source: '' };

    // v9: also try package_* fallbacks (Holley etc. use these instead of length/width/height)
    const aL = N.fillDimension(row, scrape, ['length_in', 'length', 'length_mm', 'package_depth', 'package_length', 'centerline_length_in']);
    cells.assembledLength_measure = { value: aL.measure, source: aL.source };
    cells.assembledLength_unit    = { value: aL.unit || (aL.measure ? 'in' : ''), source: aL.source };
    const aH = N.fillDimension(row, scrape, ['height_in', 'height', 'height_mm', 'package_height']);
    cells.assembledHeight_measure = { value: aH.measure, source: aH.source };
    cells.assembledHeight_unit    = { value: aH.unit || (aH.measure ? 'in' : ''), source: aH.source };
    const aWt = N.fillDimension(row, scrape, ['weight_lb', 'weight', 'shipping_weight', 'package_weight']);
    cells.assembledWeight_measure = { value: aWt.measure, source: aWt.source };
    cells.assembledWeight_unit    = { value: aWt.measure ? (aWt.unit && /lb/i.test(aWt.unit) ? 'lbs' : (aWt.unit || 'lbs')) : '', source: aWt.source };
    const aW = N.fillDimension(row, scrape, ['width_in', 'width', 'width_mm', 'package_width']);
    cells.assembledWidth_measure  = { value: aW.measure, source: aW.source };
    cells.assembledWidth_unit     = { value: aW.unit || (aW.measure ? 'in' : ''), source: aW.source };

    // (col 42 automotivePartsDivision now set above via N.derivePartsDivision)
    cells.prop65WarningText       = { value: '', source: 'skip' };

    const colorHit = N.pickFirstAttr(row, scrape, ['color', 'color_finish', 'bulb_color', 'caliper_color', 'hose_color', 'frame_color']);
    cells.color = colorHit
      ? { value: N.normalizeColor(String(colorHit.value).slice(0, 600)), source: `${colorHit.source}.${colorHit.key}` }
      : { value: '', source: '' };

    cells.compatibleCars = N.buildCompatibleVehicles(scrape);
    cells.dimensions     = N.buildDimensionsString(row, scrape);

    const finHit = N.pickFirstAttr(row, scrape, ['finish', 'finish_type', 'surface_finish', 'coating']);
    cells.finish = finHit
      ? (() => {
          const norm = N.normalizeFinish(String(finHit.value));
          return norm
            ? { value: norm, source: `${finHit.source}.${finHit.key}` }
            : { value: '', source: `dropped (was '${finHit.value}', looks like a color)` };
        })()
      : { value: '', source: '' };

    const v9Item = v9Items[mpn] || '';
    cells.items_included = (v9Item && !N.isJunkItemsIncluded(v9Item) && !N.isJunkItemsValue(v9Item))
      ? { value: v9Item, source: 'sideload v9.col48' } : { value: '', source: '' };

    cells.manufacturer = { value: cfg.outputBrandString, source: 'constant' };

    const matHit = N.pickFirstAttr(row, scrape, ['material', 'primary_material', 'body_material', 'casing_material', 'casting_material', 'outer_sleeve_material', 'frame_material']);
    cells.material = matHit
      ? { value: N.normalizeMaterial(String(matHit.value)), source: `${matHit.source}.${matHit.key}` }
      : { value: '', source: '' };

    // modelNumber — broadened filters for v6
    const isWalmartInternalId = (s) => /^1\d{8,9}$/.test(s);
    const isAcPrefixedMpn = (s) => /^AC[A-Z0-9]/i.test(s) && s.length > mpn.length;
    const isColonCatalog = (s) => /^[A-Za-z\d]+:\w+$/.test(s);
    const isMpnNoSep    = (s) => s.toLowerCase() === mpn.toLowerCase().replace(/[-_]/g, '');
    const isCleanModelNumber = (s) => {
      if (!s) return false;
      const v = String(s).trim();
      if (!v) return false;
      return !isWalmartInternalId(v) && !isAcPrefixedMpn(v) && !isColonCatalog(v) && !isMpnNoSep(v);
    };
    const pickFirstFromCommaList = (s) => {
      if (!s) return '';
      for (const p of String(s).split(/\s*,\s*/)) if (isCleanModelNumber(p)) return p;
      return '';
    };
    const oemRaw = row.attributes['oem_interchange_number'] || scrape?.byKey?.oem_interchange_number?.[0]?.value;
    const pnRaw  = row.attributes['part_number']            || scrape?.byKey?.part_number?.[0]?.value;
    const oem    = pickFirstFromCommaList(oemRaw) || (isCleanModelNumber(oemRaw) ? oemRaw : '');
    const pn     = pickFirstFromCommaList(pnRaw)  || (isCleanModelNumber(pnRaw)  ? pnRaw  : '');
    let modelVal = '', modelSrc = '';
    if (oem)     { modelVal = String(oem); modelSrc = 'source.attributes.oem_interchange_number'; }
    else if (pn) { modelVal = String(pn);  modelSrc = 'source.attributes.part_number'; }
    else         { modelVal = mpn;         modelSrc = 'fallback to MPN (no clean OE/part_number)'; }
    cells.modelNumber = { value: modelVal, source: modelSrc };

    cells.netContentStatement = { value: '', source: 'skip (data is noise)' };

    const qHit = N.pickFirstAttr(row, scrape, ['quantity', 'pack_quantity', 'piece_count', 'number_of_pieces']);
    if (qHit) {
      const num = quantityToPieceCount(qHit.value);
      cells.pieceCount = num != null ? { value: num, source: `${qHit.source}.${qHit.key} (parsed)` } : { value: '', source: '' };
    } else cells.pieceCount = { value: '', source: '' };

    cells.occasion = { value: '', source: 'skip (irrelevant)' };
    cells.partTerminologyID = { value: tax?.partTerminologyId || '', source: tax ? 'taxonomy.PartTerminologyID' : '' };

    // Vehicle Make / Model — vocab-gated derivation preferred
    const derivedMakes = N.deriveVehicleMakesFromCompatible(cells.compatibleCars.value);
    const rawMake = scrape?.byKey?.compatible_make_s?.[0]?.value || scrape?.byKey?.vehicle_make?.[0]?.value || '';
    let makeVal = '', makeSrc = '';
    if (derivedMakes) { makeVal = derivedMakes; makeSrc = 'derived from compatibleCars (vocab-gated, deduped)'; }
    else if (rawMake && !N.PARENT_CORP_RX.test(rawMake) && N.KNOWN_MAKES_LC.has(String(rawMake).toLowerCase())) {
      makeVal = [...N.KNOWN_MAKES].find(km => km.toLowerCase() === String(rawMake).toLowerCase()) || N.titleCase(rawMake);
      makeSrc = 'scrape.compatible_make_s';
    }
    cells.vehicleMake = { value: makeVal, source: makeSrc };

    const rawModel = scrape?.byKey?.compatible_model_s?.[0]?.value || scrape?.byKey?.vehicle_model?.[0]?.value || '';
    let modelV = String(rawModel).trim(), modelV_src = '';
    if (modelV && !N.isInvalidVehicleModel(modelV, mpn)) {
      modelV = /^[A-Z0-9\s\-]+$/.test(modelV) && /[A-Z]{3,}/.test(modelV) ? N.titleCase(modelV) : modelV;
      modelV_src = 'scrape.compatible_model_s|vehicle_model';
    } else if (modelV) {
      modelV = ''; modelV_src = `rejected (was '${rawModel}', looks like MPN/category)`;
    }
    cells.vehicleModel = { value: modelV, source: modelV_src };

    const vloc = scrape?.byKey?.placement_on_vehicle?.[0]?.value || row.attributes['placement_on_vehicle'];
    cells.vehicle_mount_location = vloc ? { value: String(vloc), source: 'scrape.placement_on_vehicle' } : { value: '', source: '' };

    // v11: Vehicle Year (col 66) — derive year range from compatibleCars
    const yearRange = N.deriveVehicleYearRange(cells.compatibleCars.value);
    cells.vehicleYear = yearRange ? { value: yearRange, source: 'derived from compatibleCars years' } : { value: '', source: '' };

    cells.warrantyText = warrHit ? { value: String(warrHit.value), source: `${warrHit.source}.${warrHit.key}` } : { value: '', source: '' };

    // v9: required-col completeness (per user) — Brand, MPN, Measure, Unit, Vehicle Category, Vehicle Fitment Type
    // Brand, MPN, Vehicle Category are constants/MPN, always filled. Real gates: measure + unit + vehicle_fitment_type
    const missingRequired = missingMeasure || !cells.unit.value || !cells.vehicle_fitment_type.value;
    const dropReasons = [];
    if (missingMeasure) dropReasons.push('measure');
    if (!cells.unit.value) dropReasons.push('unit');
    if (!cells.vehicle_fitment_type.value) dropReasons.push('vehicle_fitment_type');

    const flags = {
      needsReviewFitment: !fitInfo.value,
      needsReviewMeasure: missingMeasure,
      hasPartTerminology: !!tax?.partTerminologyId,
      isScrapeOnly: !!row.isScrapeOnly,
      brandMappingMapped: brand?.mapped ?? false,
      brandMappingConfidence: brand?.confidence || '',
      missingRequired, dropReasons,
    };
    out.push({ mpn, partType: row.partType, sourceTitle: row.title, isScrapeOnly: !!row.isScrapeOnly, cells, flags, missingMeasure, missingRequired, dropReasons });
  }

  const FILE = path.join(D, `02-${brandKey}-filled.json`);
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));

  const total = out.length;
  const dropped = out.filter(r => r.missingMeasure).length;
  const shipped = total - dropped;
  console.log(`Wrote → ${FILE}`);
  console.log(`Brand: ${cfg.outputBrandString}`);
  console.log(`  Total candidate rows: ${total}`);
  console.log(`  Will be shipped:      ${shipped}`);
  console.log(`  Will be dropped:      ${dropped}  (no measure/unit)`);
})().catch(e => { console.error(e); process.exit(1); });
