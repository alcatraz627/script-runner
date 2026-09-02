/**
 * transforms/generate-description-bullets.js
 *
 * Uses Claude (Opus) to generate concise `description_bullets` for rows
 * whose Part Number is in the SKU filter file.
 *
 * Rows NOT in the filter are passed through unchanged — use this to target
 * only the new/upserted rows without re-processing the full dataset.
 *
 * Output format (5 bullet points):
 *   * Concise product spec or feature
 *   * ...
 *
 * Config:
 *   skuFilterFile  {string}  Path to xlsx (relative to runDir or absolute) whose
 *                            SKU column defines which rows to process
 *   skuField       {string}  Column name for SKU in the filter file — default: "SKU"
 *   partNumberField {string} Column name in the pipeline rows — default: "Part Number"
 *   model          {string}  Anthropic model ID — default: "claude-opus-4-6"
 *   sheet          {string}  Sheet name in filter xlsx — default: first sheet
 */

const path      = require('path');
const fs        = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const XLSX      = require('xlsx');

/** Read ANTHROPIC_API_KEY from process.env or fall back to .env in project root */
function resolveApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return undefined;
  const line = fs.readFileSync(envPath, 'utf8').split('\n')
    .find(l => l.startsWith('ANTHROPIC_API_KEY='));
  return line ? line.slice('ANTHROPIC_API_KEY='.length).trim() : undefined;
}

function loadSkuFilter(filePath, runDir, skuField = 'SKU', sheet) {
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(runDir, filePath);
  const wb   = XLSX.readFile(absPath);
  const name = sheet || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
  return new Set(rows.map(r => String(r[skuField] || '').trim()).filter(Boolean));
}

function formatAttrs(attrs) {
  if (!Array.isArray(attrs) || !attrs.length) return '';
  return attrs.map(([k, v]) => `${k}: ${v}`).join('; ');
}

function buildPrompt(row) {
  const partType = row['Part Type'] || '';
  const brand    = row['Brand'] || 'JEGS';
  const attrs    = formatAttrs(row['Attributes Full'] || row['Attributes Small'] || []);
  const fitment  = row['Fitment'] || '';

  // Trim the raw scraped description — it's often very long with repeated boilerplate
  const rawDesc = (row['Description'] || '')
    .replace(/PAYMENT[\s\S]*$/i, '')   // strip payment/shipping/return boilerplate
    .replace(/From the iconic mail order[\s\S]*$/i, '')  // strip JEGS brand copy
    .slice(0, 1500)
    .trim();

  return `You are writing product bullet points for an eBay listing.

Product: ${brand} ${partType}
Part Number: ${row['Part Number'] || ''}${fitment ? `\nFitment: ${fitment}` : ''}${attrs ? `\nAttributes: ${attrs}` : ''}

Raw description (scraped, may contain noise):
${rawDesc}

Write exactly 5 concise bullet points that highlight the key technical features and specs of this product.

Rules:
- Each bullet starts with "* "
- Each bullet is one line, no sub-bullets
- Be specific and technical — include numbers, units, specs where available
- Do not include fitment/compatibility info (that is handled separately)
- Do not include shipping, payment, return policy, or brand history
- Do not use marketing fluff — focus on what the product IS and DOES

Output ONLY the 5 bullet points, nothing else.`;
}

/**
 * Post-process a bullet string to remove boilerplate phrases.
 * - Bullets that are *only* a part number reference or "Made in USA" → dropped
 * - Bullets that *start* with "Made in USA" → prefix stripped, remainder kept
 * - Bullets that *end* with "Made in USA" → suffix stripped, remainder kept
 */
function cleanBullets(bulletsText, partNumber) {
  const lines = bulletsText.split('\n').map(l => l.trim()).filter(Boolean);

  // Part-number patterns: drop the whole bullet if it's purely a PN reference
  const pnPatterns = [
    /^[*\-]\s*(jegs\s+)?part\s+number[:\s]/i,
    /^[*\-]\s*(jegs\s+)?\d{3}-[\w-]+\b.*identification/i,
  ];
  // "Made in the USA" variants at start or end of a bullet
  const madeInUsaPrefix = /^(made in (the\s+)?(usa|u\.s\.a\.)[,.\s-]*)/i;
  const madeInUsaSuffix = /([,.\s-]*(and\s+)?made in (the\s+)?(usa|u\.s\.a\.)\.?)$/i;

  const cleaned = lines
    .map(line => {
      const text = line.replace(/^[*\-]\s*/, '').trim();

      // Drop pure part-number bullets
      if (pnPatterns.some(p => p.test(line))) return null;

      // Strip "Made in the USA" prefix → capitalise remainder
      if (madeInUsaPrefix.test(text)) {
        const rest = text.replace(madeInUsaPrefix, '').trim();
        if (!rest || rest.length < 10) return null;           // nothing left worth keeping
        return '* ' + rest.charAt(0).toUpperCase() + rest.slice(1);
      }

      // Strip "Made in the USA" suffix
      if (madeInUsaSuffix.test(text)) {
        const rest = text.replace(madeInUsaSuffix, '').trim().replace(/[,.]$/, '');
        if (!rest || rest.length < 10) return null;
        return '* ' + rest;
      }

      return line.startsWith('*') ? line : '* ' + line;
    })
    .filter(Boolean);

  return cleaned.join('\n');
}

module.exports = async function generateDescriptionBullets(rows, config = {}, { runDir, onEvent, limit: ctxLimit } = {}) {
  const skuField         = config.skuField        || 'SKU';
  const partNumberField  = config.partNumberField || 'Part Number';
  const model            = config.model           || 'claude-opus-4-6';

  // limit: cap how many NEW SKUs to process this run.
  // Passed via execute body: POST /execute { "step": "...", "limit": 5 }
  // Remaining new SKUs pass through unchanged — no data lost for the full run.
  const processLimit = ctxLimit ? parseInt(ctxLimit, 10) : Infinity;

  if (!config.skuFilterFile) throw new Error('generate-description-bullets: config.skuFilterFile is required');

  const filterSkus = loadSkuFilter(config.skuFilterFile, runDir, skuField, config.sheet);
  const totalNew   = rows.filter(r => filterSkus.has(String(r[partNumberField] || '').trim())).length;
  const willProcess = Math.min(totalNew, processLimit);

  onEvent && onEvent({ type: 'info', message: `SKU filter: ${filterSkus.size} new SKUs — processing ${willProcess}${processLimit < Infinity ? ` (limit ${processLimit})` : ''}` });

  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error('generate-description-bullets: ANTHROPIC_API_KEY not found in env or .env file');
  const client = new Anthropic({ apiKey });
  let processed = 0;
  let skipped   = 0;
  const total   = willProcess;

  const results = [];
  for (const row of rows) {
    const partNum = String(row[partNumberField] || '').trim();

    if (!filterSkus.has(partNum) || processed >= processLimit) {
      results.push(row);
      if (filterSkus.has(partNum)) skipped++;
      continue;
    }

    try {
      const message = await client.messages.create({
        model,
        max_tokens: 512,
        messages: [{ role: 'user', content: buildPrompt(row) }],
      });

      const raw     = message.content[0]?.text?.trim() || '';
      const bullets = cleanBullets(raw, partNum);
      results.push({ ...row, description_bullets: bullets });
      processed++;
      onEvent && onEvent({ type: 'progress', current: processed, total, message: `Bullets generated for ${partNum} (${processed}/${total})` });
    } catch (err) {
      onEvent && onEvent({ type: 'warn', message: `Failed to generate bullets for ${partNum}: ${err.message}` });
      results.push({ ...row, description_bullets: '' });
      processed++;
    }
  }

  onEvent && onEvent({ type: 'info', message: `Done — ${processed} generated, ${skipped} new SKUs deferred (no limit set = full run)` });
  return results;
};
