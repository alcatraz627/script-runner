#!/usr/bin/env node
/**
 * schema.js — the one place the output shape is declared.
 *
 * The builder, both verifiers and the ingest probe all read from here. When the
 * column list lived in four hand-kept copies, renaming a column turned a
 * verifier green and meaningless instead of red and correct.
 */

'use strict';

const SECTION_MARKER = '— section —';
const GROUP_COL = 'OEM GROUP';
const JOIN_KEY = 'ITEM';
const NOT_FOUND_OUT_COL = 'Not Found Reason';
const FITMENT_JSON_COL = 'Fitment';
const FITMENT_COUNT_COL = 'Fitment Count';
const FITMENT_NOTE_COL = 'Fitment Note';
const EXCEL_CELL_LIMIT = 32767;
const OUT_SHEET_NAME = 'Catalog';

/** Output columns in order. `width` is only for the xlsx write. */
const COLUMNS = [
  { key: GROUP_COL, width: 18 },
  { key: 'ENGINE FAMILY', width: 22 },
  { key: 'PART CATEGORY', width: 24 },
  { key: JOIN_KEY, width: 22 },
  { key: 'DESCRIPTION', width: 50 },
  { key: 'PURCHASE DESCRIPTION', width: 50 },
  { key: 'FEATURES AND BENEFITS', width: 50 },
  { key: 'NOTES', width: 28 },
  { key: 'ALTERNATE REFERENCE', width: 22 },
  { key: 'PRIMARY COO', width: 14 },
  { key: 'Status', width: 12 },
  { key: NOT_FOUND_OUT_COL, width: 50 },
  { key: 'Searched As', width: 20 },
  { key: 'Search Column', width: 20 },
  { key: 'Source Site', width: 22 },
  { key: 'Part Number (site)', width: 20 },
  { key: 'Product Title', width: 40 },
  { key: 'Source URL', width: 55 },
  { key: 'Year Range', width: 12 },
  { key: 'Vehicles', width: 10 },
  { key: FITMENT_COUNT_COL, width: 14 },
  { key: FITMENT_NOTE_COL, width: 40 },
  { key: FITMENT_JSON_COL, width: 80 },
];

const HEADERS = COLUMNS.map((c) => c.key);

/** Copied verbatim from Catalog, in output order. */
const PASSTHROUGH = [
  'ENGINE FAMILY', 'PART CATEGORY', 'ITEM', 'DESCRIPTION', 'PURCHASE DESCRIPTION',
  'FEATURES AND BENEFITS', 'NOTES', 'ALTERNATE REFERENCE', 'PRIMARY COO', 'Status',
  'Searched As', 'Search Column', 'Source Site', 'Part Number (site)',
  'Product Title', 'Source URL', 'Year Range',
];

/** Fitment source column -> JSON dict key. Order here is the key order emitted. */
const FITMENT_FIELDS = [
  ['Years', 'years'],
  ['Make', 'make'],
  ['Model', 'model'],
  ['Trim / Body', 'trim'],
  ['Engine', 'engine'],
  ['Options', 'options'],
];
const FITMENT_KEYS = FITMENT_FIELDS.map(([, k]) => k);

/** A Fitment row blank in all of these names no vehicle; its Options text is a note. */
const VEHICLE_FIELDS = ['Years', 'Make', 'Model', 'Trim / Body', 'Engine'];

/**
 * Every source column, and where it goes. A source header in none of these
 * buckets is a new column nobody has decided about, which is how a future drop
 * loses data quietly.
 */
const SOURCE_COLUMN_FATE = {
  Catalog: {
    copied: PASSTHROUGH,
    transformed: ['Vehicles'],
    consumedAsBand: [],
  },
  Fitment: {
    joinKey: ['ITEM'],
    becomesDictKey: FITMENT_FIELDS.map(([c]) => c),
    // Proven identical to the named Catalog column on every row, so kept once
    // on the catalog row rather than repeated inside every dict. 04-validate
    // re-proves this each run instead of trusting it.
    redundantWithCatalog: {
      Reference: 'ALTERNATE REFERENCE',
      'Searched As': 'Searched As',
      'Source Site': 'Source Site',
      'Part Number (site)': 'Part Number (site)',
      'Product Title': 'Product Title',
      'Source URL': 'Source URL',
    },
  },
  'Not Found': {
    foldedIn: { Reason: NOT_FOUND_OUT_COL },
    redundantWithCatalog: ['ENGINE FAMILY', 'PART CATEGORY', 'ITEM', 'DESCRIPTION',
      'PURCHASE DESCRIPTION', 'FEATURES AND BENEFITS', 'NOTES', 'ALTERNATE REFERENCE', 'PRIMARY COO'],
  },
};

module.exports = {
  COLUMNS, HEADERS, PASSTHROUGH, FITMENT_FIELDS, FITMENT_KEYS, VEHICLE_FIELDS,
  SOURCE_COLUMN_FATE, SECTION_MARKER, GROUP_COL, JOIN_KEY, NOT_FOUND_OUT_COL,
  FITMENT_JSON_COL, FITMENT_COUNT_COL, FITMENT_NOTE_COL, EXCEL_CELL_LIMIT, OUT_SHEET_NAME,
};
