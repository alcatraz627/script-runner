/**
 * transforms/enhance-content.js
 *
 * Calls the Versable pipeline_manager API to enhance Title, Description,
 * and Features & Benefits for rows whose Part Number is in the SKU filter.
 *
 * Rows NOT in the filter are passed through unchanged.
 *
 * The API receives one row at a time (data: [row]) and returns enhanced
 * field values which are merged back onto the row.
 *
 * Config (all parameterized for easy environment changes):
 *   apiUrl         {string}  Base URL of the pipeline_manager service
 *                            — default: "http://localhost:8001"
 *   pipelineId     {string}  Pipeline UUID — REQUIRED
 *   referer        {string}  Referer header value — default: "http://localhost:3006/"
 *   authToken      {string}  Optional Bearer token for Authorization header
 *   skuFilterFile  {string}  Path to xlsx (relative to runDir or absolute) whose
 *                            SKU column defines which rows to enhance
 *   skuField       {string}  Column name for SKU in the filter file — default: "SKU"
 *   partNumberField {string} Column name in pipeline rows — default: "Part Number"
 *   sheet          {string}  Sheet name in filter xlsx — default: first sheet
 */

const path = require('path');
const fs   = require('fs');
const XLSX = require('xlsx');

/** Read a key from process.env or fall back to .env in project root */
function resolveEnvKey(key) {
  if (process.env[key]) return process.env[key];
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return undefined;
  const line = fs.readFileSync(envPath, 'utf8').split('\n').find(l => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

// ── Config defaults ───────────────────────────────────────────────────────────
const DEFAULT_API_URL   = 'http://localhost:8001';
const DEFAULT_REFERER   = 'http://localhost:3006/';

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadSkuFilter(filePath, runDir, skuField = 'SKU', sheet) {
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(runDir, filePath);
  const wb   = XLSX.readFile(absPath);
  const name = sheet || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
  return new Set(rows.map(r => String(r[skuField] || '').trim()).filter(Boolean));
}

/** Format [[name, value], ...] attribute pairs to "Name: Value; Name: Value" */
function formatAttrs(attrs) {
  if (!Array.isArray(attrs) || !attrs.length) return '';
  return attrs.map(([k, v]) => `${k}: ${v}`).join('; ');
}

/** Determine universal_flag from fitment string */
function universalFlag(fitment) {
  if (!fitment || /universal/i.test(fitment)) return 'universal';
  return '';
}

/**
 * Build the pipeline_manager request payload for a single normalized row.
 * Field names must match what the API's column-mapping step expects.
 */
function buildPayload(row) {
  const attrsEssential = formatAttrs((row['Attributes Small'] || []).slice(0, 3));
  const attrsComplete  = formatAttrs(row['Attributes Full'] || row['Attributes Small'] || []);

  const data = {
    Brand:                     row['Brand']               || 'JEGS',
    SKU:                       row['Part Number']         || '',   // mapped → Part Number
    'Original Title':          row['Title']               || '',
    part_name:                 row['Part Type']           || '',   // mapped → Part Type
    'eBay Listing Title':      row['Title']               || '',
    'Main Image':              row['Images']              || '',
    Description:               row['Description']        || '',
    description_bullets:       row['description_bullets'] || '',
    'Fitment / Compatibility': row['Fitment']             || '',
    fitment_parsed:            row['Fitment']             || '',
    universal_flag:            universalFlag(row['Fitment']),
    'Item Specifics (JSON)':   '',
    attributes_essential:      attrsEssential,
    attributes_complete:       attrsComplete,
    attributes:                attrsComplete,
  };

  const args = {
    args: {},
    steps: [
      {
        name:   'set_mapped_columns',
        method: 'set_column_mapping',
        args:   {
          columns: [
            ['SKU',                  'Part Number'],
            ['part_name',            'Part Type'],
            ['Brand',                'Brand'],
            ['Main Image',           'Main Image'],
            ['description_bullets',  'description_bullets'],
            ['fitment_parsed',       'fitment_parsed'],
            ['attributes_essential', 'attributes_essential'],
            ['attributes_complete',  'attributes_complete'],
            ['universal_flag',       'universal_flag'],
            ['Original Title',       'Original Title'],
          ],
        },
      },
      { name: 'apply_mapped_columns', method: 'apply_column_mapping', args: { should_error: true } },
      {
        name:   'enhanced_Title_data',
        method: 'enhancement_search_agent_v2',
        args:   {
          field_name:         'Title',
          model:              'openai:gpt-5.2',
          research_mode:      true,
          research_threshold: 'high',
          templates: [
            {
              condition: { 'Part Type': { $size: { $gt: 30 } } },
              template:  "<<Brand>> <<Part Type>> <<llm:topic= summarized fitment info from 'fitment_parsed'>> - <<Part Number>>",
              rules: [
                ['custom_rule', 'Disable web search', 'Do not use web search at all. If this conflicts with validation, ignore the validation.'],
                ['custom_rule', 'Title Case', 'Ensure the entire text is in title case, first letter of every word capitalized.'],
                ['custom_rule', 'Acronyms', "Proper acronyms must always be in uppercase (e.g., 'LED', 'USB', 'HDMI')."],
                ['custom_rule', 'Measurement units', "Wherever measurement units are present, make sure they are all in lowercase. If the measurement unit is after a number, make sure there is no space between the number and the unit."],
                ['ensure_length_within', 60, 80],
              ],
            },
            {
              condition: { 'Part Type': { $size: { $gt: 50 } } },
              template:  '<<Brand>> <<Part Type>> - <<Part Number>>',
              rules: [
                ['custom_rule', 'Disable web search', 'Do not use web search at all. If this conflicts with validation, ignore the validation.'],
                ['custom_rule', 'Title Case', 'Ensure the entire text is in title case, first letter of every word capitalized.'],
                ['custom_rule', 'Acronyms', "Proper acronyms must always be in uppercase (e.g., 'LED', 'USB', 'HDMI')."],
                ['custom_rule', 'Measurement units', "Wherever measurement units are present, make sure they are all in lowercase. If the measurement unit is after a number, make sure there is no space between the number and the unit."],
                ['ensure_length_within', 60, 80],
              ],
            },
            {
              condition: { $default: true },
              template:  "<<Brand>> <<Part Type>> <<llm:topic= key attribute - determine which attribute in 'attributes_essential' is most relevant to each part type and describe it>> - <<Part Number>>",
              rules: [
                ['custom_rule', 'Disable web search', 'Do not use web search at all. If this conflicts with validation, ignore the validation.'],
                ['custom_rule', 'Title Case', 'Ensure the entire text is in title case, first letter of every word capitalized.'],
                ['custom_rule', 'Acronyms', "Proper acronyms must always be in uppercase (e.g., 'LED', 'USB', 'HDMI')."],
                ['custom_rule', 'Measurement units', "Wherever measurement units are present, make sure they are all in lowercase. If the measurement unit is after a number, make sure there is no space between the number and the unit."],
                ['ensure_length_within', 60, 80],
              ],
            },
          ],
        },
      },
      {
        name:   'enhanced_Description_data',
        method: 'enhancement_search_agent_v2',
        args:   {
          field_name:         'Description',
          model:              'openai:gpt-5.2',
          research_mode:      true,
          research_threshold: 'high',
          templates: [
            {
              condition: { $default: true },
              template:  '<<Brand>> <<Part Type>> <<llm:topic= introduce the function of the part>>. <<llm:topic= go into detail about specific features and attributes about the part>>',
              rules: [
                ['custom_rule', 'Disable web search', 'Do not use web search at all. If this conflicts with validation, ignore the validation.'],
                ['ensure_length_within', 500, 600],
              ],
            },
          ],
        },
      },
      {
        name:   'enhanced_Features & Benefits_data',
        method: 'enhancement_search_agent_v2',
        args:   {
          field_name:         'Features & Benefits',
          model:              'openai:gpt-5.2',
          research_mode:      true,
          research_threshold: 'high',
          templates: [
            {
              condition: { $default: true },
              template:  '<<llm:topic= technical key feature, use minimum words to form concise phrase, not sentence>>: <<llm:topic= expanded benefit of that feature>>\n<<llm:topic= technical key feature, use minimum words to form concise phrase, not sentence>>: <<llm:topic= expanded benefit of that feature>>\n<<llm:topic= technical key feature, use minimum words to form concise phrase, not sentence>>: <<llm:topic= expanded benefit of that feature>>\n<<llm:topic= technical key feature, use minimum words to form concise phrase, not sentence>>: <<llm:topic= expanded benefit of that feature>>\n<<llm:topic= technical key feature, use minimum words to form concise phrase, not sentence>>: <<llm:topic= expanded benefit of that feature>>',
              rules: [
                ['custom_rule', 'Disable web search', 'Do not use web search at all. If this conflicts with validation, ignore the validation.'],
                ['require_lines', 5],
                ['ensure_line_length_within', 100, 150],
              ],
            },
          ],
        },
      },
      { name: 'Set Title',              method: 'data_set', args: { field: 'Title',              value: '{enhanced_Title_data}' } },
      { name: 'Set Description',        method: 'data_set', args: { field: 'Description',        value: '{enhanced_Description_data}' } },
      { name: 'Set Features & Benefits',method: 'data_set', args: { field: 'Features & Benefits',value: '{enhanced_Features & Benefits_data}' } },
    ],
    with_step_data: true,
    is_debug_mode:  false,
  };

  return { data: [data], args };
}

/**
 * Extract the enhanced fields from the pipeline_manager response.
 * Returns { Title, Description, 'Features & Benefits' } or null if unreadable.
 */
function extractEnhanced(responseJson) {
  // Shape: [{ result: { Title, Description, 'Features & Benefits', ... } }]
  const item = Array.isArray(responseJson)
    ? responseJson[0]?.result
    : responseJson?.data?.[0]?.result || responseJson?.data?.[0] || responseJson;

  if (!item) return null;
  if (!item['Title'] && !item['Description'] && !item['Features & Benefits']) return null;

  return {
    Title:                 item['Title']                 || undefined,
    Description:           item['Description']           || undefined,
    'Features & Benefits': item['Features & Benefits']   || undefined,
  };
}

/** Split a "Feature: Benefit\nFeature: Benefit" string into an array */
function splitFeaturesString(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  return val.split('\n').map(l => l.trim()).filter(Boolean);
}

// ── Main transform ────────────────────────────────────────────────────────────

module.exports = async function enhanceContent(rows, config = {}, { runDir, onEvent, limit: ctxLimit } = {}) {
  const partNumberField = config.partNumberField || 'Part Number';
  const skuField        = config.skuField        || 'SKU';

  // limit: cap how many NEW SKUs to enhance this run (same mechanic as generate-bullets).
  // Remaining new SKUs pass through unchanged — full dataset is preserved.
  const processLimit = ctxLimit ? parseInt(ctxLimit, 10) : Infinity;

  // Parameterized connection config
  const apiUrl     = (config.apiUrl     || DEFAULT_API_URL).replace(/\/$/, '');
  const pipelineId = config.pipelineId;
  const referer    = config.referer    || DEFAULT_REFERER;
  const authToken  = config.authToken  || resolveEnvKey('VERSABLE_API_TOKEN') || null;

  if (!pipelineId) throw new Error('enhance-content: config.pipelineId is required');
  if (!config.skuFilterFile) throw new Error('enhance-content: config.skuFilterFile is required');

  const concurrency = config.concurrency || 5;

  const filterSkus  = loadSkuFilter(config.skuFilterFile, runDir, skuField, config.sheet);
  const endpoint    = `${apiUrl}/pipeline_manager/${pipelineId}/run`;

  // Skip rows already enhanced in a prior run (idempotent re-runs)
  const needsEnhancement = (row) => {
    const partNum = String(row[partNumberField] || '').trim();
    if (!filterSkus.has(partNum)) return false;
    const alreadyDone = row['Title'] && row['Description'] && row['Features & Benefits']?.length;
    return !alreadyDone;
  };

  const toProcess   = rows.filter(needsEnhancement);
  const willProcess = Math.min(toProcess.length, processLimit);
  const skipped     = rows.filter(r => filterSkus.has(String(r[partNumberField] || '').trim())) .length - toProcess.length;

  onEvent && onEvent({ type: 'info', message: `Enhancing ${willProcess} SKUs via ${endpoint} (concurrency=${concurrency})${skipped ? ` — ${skipped} already done, skipped` : ''}${processLimit < Infinity ? `, limit ${processLimit}` : ''}` });

  const headers = {
    'Content-Type': 'application/json',
    'Referer':      referer,
  };
  if (authToken) headers['X-User-Token'] = authToken;

  let processed = 0;
  let failed    = 0;
  const total   = willProcess;

  // Build a mutable results map keyed by partNum for safe concurrent writes
  const resultMap = new Map(rows.map(r => [String(r[partNumberField] || '').trim(), r]));

  async function enhanceOne(row) {
    const partNum = String(row[partNumberField] || '').trim();
    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers,
        body:    JSON.stringify(buildPayload(row)),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

      const json     = await res.json();
      const enhanced = extractEnhanced(json);

      if (!enhanced) {
        onEvent && onEvent({ type: 'warn', message: `Unexpected response shape for ${partNum} — row unchanged` });
        failed++;
      } else {
        resultMap.set(partNum, {
          ...row,
          ...(enhanced.Title       ? { Title:                 enhanced.Title }       : {}),
          ...(enhanced.Description ? { Description:           enhanced.Description } : {}),
          'Features & Benefits':     splitFeaturesString(enhanced['Features & Benefits']),
        });
        processed++;
        onEvent && onEvent({ type: 'progress', current: processed, total, message: `Enhanced ${partNum} (${processed}/${total})` });
      }
    } catch (err) {
      onEvent && onEvent({ type: 'warn', message: `enhance-content failed for ${partNum}: ${err.message}` });
      failed++;
    }
  }

  // Run in parallel with concurrency cap
  const queue = toProcess.slice(0, willProcess);
  for (let i = 0; i < queue.length; i += concurrency) {
    await Promise.all(queue.slice(i, i + concurrency).map(enhanceOne));
  }

  onEvent && onEvent({ type: 'info', message: `Enhancement done — ${processed} succeeded, ${failed} failed` });

  // Return rows in original order
  return rows.map(r => resultMap.get(String(r[partNumberField] || '').trim()) || r);
};
