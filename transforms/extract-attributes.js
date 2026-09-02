/**
 * transforms/extract-attributes.js
 *
 * Uses Claude Haiku to extract technical [[name, value]] attributes from raw
 * eBay scraped descriptions for rows that have no real attributes yet.
 *
 * A row is processed only when ALL three conditions hold:
 *   1. Its Part Number is in the SKU filter file (targets new SKUs only)
 *   2. It has no real (non-commerce) attributes in Attributes Small
 *   3. Its raw description exists in the raw source file
 *
 * Extracted pairs are written to both Attributes Small and Attributes Full.
 * All other rows pass through unchanged.
 *
 * Config:
 *   skuFilterFile   {string}  Path to xlsx whose SKU column lists rows to consider
 *   rawFile         {string}  Path to xlsx with raw pipe-separated descriptions
 *                             (often the same file as skuFilterFile)
 *   skuField        {string}  SKU column in filter/raw xlsx — default: "SKU"
 *   descField       {string}  Description column in raw xlsx — default: "Description"
 *   partNumberField {string}  Column in pipeline rows — default: "Part Number"
 *   model           {string}  Anthropic model — default: "claude-haiku-4-5-20251001"
 *   batchSize       {number}  Rows per API call — default: 10
 */

const path = require('path');
const fs   = require('fs');
const XLSX = require('xlsx');

// ── Commerce / junk keys that do NOT count as real attributes ─────────────────
const JUNK_KEYS = new Set([
  'List price', 'Item price', 'Shipping', 'Estimated total', 'Returns',
  'Delivery', 'Import fees', 'eBay Product ID (ePID)', 'Shipping:', 'Returns:',
  'Delivery:', 'Brand', 'Sub Type', 'Part Type',
]);

function hasRealAttrs(row) {
  return (row['Attributes Small'] || []).some(([k]) => !JUNK_KEYS.has(k));
}

// ── Resolve ANTHROPIC_API_KEY from env or .env file ───────────────────────────
function resolveApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return undefined;
  const line = fs.readFileSync(envPath, 'utf8').split('\n')
    .find(l => l.startsWith('ANTHROPIC_API_KEY='));
  return line ? line.slice('ANTHROPIC_API_KEY='.length).trim() : undefined;
}

// ── Load SKU filter and raw descriptions from xlsx ────────────────────────────
function loadXlsx(filePath, runDir) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(runDir, filePath);
  const wb  = XLSX.readFile(abs);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You extract technical product attributes from eBay automotive parts listing text.

EXTRACT as [name, value] pairs:
- Dimensions with units: diameters, lengths, widths, heights (e.g. ["O.D.","3 in."])
- Materials: steel, aluminum, zinc, rubber, foam, stainless (e.g. ["Material","Die-cast zinc"])
- Finishes: chrome, black, anodized, EDP primer, polished (e.g. ["Finish","Black EDP"])
- Electrical specs: wire gauge, voltage, terminal type (e.g. ["Wire Gauge","8.5mm"])
- Capacities or quantities: gallons, piece count, sold individually
- Specific fitment specs stated as product specs (e.g. ["Hip Width","18 in."])
- Thread/port sizes: NPT, AN size (e.g. ["Inlet","1/8 in. NPT"])
- Gauge or wall thickness (e.g. ["Wall Gauge","16-gauge"])

DROP entirely:
- Prices, shipping, returns, eBay commerce data
- "Made in the USA" or country of origin
- Marketing language ("easy installation", "perfect for")
- Brand names used as spec values
- Fitment years/models — those belong in Fitment field, not attributes
- Values over 50 characters

Return ONLY a valid JSON array — no markdown fences, no explanation:
[{"partNumber":"...","attrs":[[name,value],...]},...]

Max 8 attributes per item. Attribute values max 40 characters.`;

// ── Call Claude for a batch of items ─────────────────────────────────────────
async function extractBatch(items, client, model) {
  const input = items.map(({ partNumber, partType, rawDesc }) => ({
    partNumber,
    partType,
    description: rawDesc,
  }));

  const resp = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Extract attributes:\n\n${JSON.stringify(input, null, 2)}` }],
  });

  const text = resp.content[0].text.trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '');
  return JSON.parse(text);
}

// ── Main transform ────────────────────────────────────────────────────────────
module.exports = async function extractAttributes(rows, config = {}, { runDir, onEvent } = {}) {
  const skuField        = config.skuField        || 'SKU';
  const descField       = config.descField       || 'Description';
  const partNumberField = config.partNumberField || 'Part Number';
  const model           = config.model           || 'claude-haiku-4-5-20251001';
  const batchSize       = config.batchSize       || 10;

  if (!config.skuFilterFile) throw new Error('extract-attributes: config.skuFilterFile is required');
  if (!config.rawFile)       throw new Error('extract-attributes: config.rawFile is required');

  const filterRows = loadXlsx(config.skuFilterFile, runDir);
  const rawRows    = config.rawFile === config.skuFilterFile
    ? filterRows
    : loadXlsx(config.rawFile, runDir);

  const filterSkus = new Set(filterRows.map(r => String(r[skuField] || '').trim()).filter(Boolean));

  // Build lookup: SKU → first pipe-segment of raw description (most spec-dense)
  const rawDescMap = new Map();
  for (const r of rawRows) {
    const sku  = String(r[skuField] || '').trim();
    const desc = String(r[descField] || '').trim();
    if (sku && desc) {
      rawDescMap.set(sku, desc.split('|')[0].replace(/^eBay\s+/i, '').trim());
    }
  }

  // Identify rows to process
  const toProcess = rows.filter(row => {
    const pn = String(row[partNumberField] || '').trim();
    return filterSkus.has(pn) && !hasRealAttrs(row) && rawDescMap.has(pn);
  });

  const skipped = rows.filter(r => filterSkus.has(String(r[partNumberField] || '').trim()) && !hasRealAttrs(r) && !rawDescMap.has(String(r[partNumberField] || '').trim())).length;

  onEvent && onEvent({ type: 'info', message: `extract-attributes: ${toProcess.length} rows to process, ${skipped} skipped (no raw desc), ${rows.length - toProcess.length - skipped} pass-through` });

  if (!toProcess.length) return rows;

  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error('extract-attributes: ANTHROPIC_API_KEY not found in env or .env');
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  // Build a result map; start with all rows unchanged
  const resultMap = new Map(rows.map(r => [String(r[partNumberField] || '').trim(), r]));

  let processed = 0;
  let failed    = 0;
  const total   = toProcess.length;

  for (let i = 0; i < toProcess.length; i += batchSize) {
    const batch = toProcess.slice(i, i + batchSize);
    const items = batch.map(row => {
      const pn = String(row[partNumberField] || '').trim();
      return { partNumber: pn, partType: row['Part Type'] || '', rawDesc: rawDescMap.get(pn) };
    });

    try {
      const results = await extractBatch(items, client, model);

      for (const { partNumber, attrs } of results) {
        if (!Array.isArray(attrs) || !attrs.length) continue;
        const row = resultMap.get(partNumber);
        if (!row) continue;
        resultMap.set(partNumber, {
          ...row,
          'Attributes Small': attrs,
          'Attributes Full':  attrs,
        });
        processed++;
        onEvent && onEvent({ type: 'progress', current: processed, total, message: `Extracted ${attrs.length} attrs for ${partNumber} (${processed}/${total})` });
      }
    } catch (err) {
      failed += batch.length;
      onEvent && onEvent({ type: 'warn', message: `Batch ${Math.floor(i / batchSize) + 1} failed: ${err.message}` });
    }
  }

  onEvent && onEvent({ type: 'info', message: `extract-attributes done — ${processed} succeeded, ${failed} failed` });
  return rows.map(r => resultMap.get(String(r[partNumberField] || '').trim()) || r);
};
