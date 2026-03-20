/**
 * transforms/clean-attributes.js
 *
 * LLM-powered attribute value cleaner for vehicle part listings.
 * Trims marketing copy bleed, drops part-number-as-spec artifacts,
 * and removes truncated values from Attributes Small / Attributes Full.
 *
 * Config:
 *   {
 *     mode: 'sdk' | 'agent',   // 'sdk' requires ANTHROPIC_API_KEY; 'agent' uses sub-agents
 *     batchSize: 20,            // items per API call (sdk mode)
 *     model: 'claude-haiku-4-5-20251001'
 *   }
 *
 * Agent mode note:
 *   For agent mode, use pipeline/run.js --step clean-attributes --agent-slices <n>
 *   which splits data into n files and spawns parallel Claude sub-agents.
 *   See README for details.
 */

const SYSTEM_PROMPT = `You are cleaning product attribute data for eBay vehicle parts listings.
Each attribute is a [name, value] pair. Return only technically meaningful spec values.

TRIM values that start with a valid spec but trail into marketing copy:
  "Steel for strength and long lifeone per package" → "Steel"
  "Stainless steel for long lifeincludes" → "Stainless steel"
  "Aluminum valve cover nutsblack anodized..." → "Aluminum"
  "Steel flangeideal for racing" → "Steel"

DROP the entire [name, value] pair when:
  - Value is a part number used as a spec (e.g. "16005 volt" where digits match part number)
  - Value is a single character or empty after trimming
  - Value ends mid-word and contains marketing language
  - Value is entirely marketing/description text

For "Includes": keep only the actual item list, stop before marketing language.

KEEP unchanged any clean spec: dimensions, voltages, thread sizes, finishes, colors, quantities.
Do NOT rewrite or infer — only trim or drop.

Return ONLY a JSON array (no markdown):
[{ "partNumber": "...", "attrsSmall": [[name,value],...], "attrsFull": [[name,value],...] }, ...]`;

/** SDK mode: call Claude API directly in batches to clean attribute values.
 *  Sends batchSize items per API call to stay within token limits.
 *  Parses JSON response from the LLM and merges cleaned attrs back onto rows. */
async function cleanViaSdk(rows, config) {
  const Anthropic = require('@anthropic-ai/sdk');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set. Use mode: "agent" instead.');

  const client   = new Anthropic({ apiKey });
  const model    = config.model || 'claude-haiku-4-5-20251001';
  const batchSize = config.batchSize || 20;
  const results  = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    process.stdout.write(`  Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(rows.length/batchSize)}...`);

    const input = batch.map(r => ({
      partNumber: r['Part Number'],
      attrsSmall: r['Attributes Small'],
      attrsFull:  r['Attributes Full'],
    }));

    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Clean this data:\n\n${JSON.stringify(input, null, 2)}` }],
    });

    const text = resp.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const cleaned = JSON.parse(text);

    for (let j = 0; j < batch.length; j++) {
      results.push({ ...batch[j], 'Attributes Small': cleaned[j].attrsSmall, 'Attributes Full': cleaned[j].attrsFull });
    }
    process.stdout.write(' ✓\n');
  }

  return results;
}

module.exports = async function cleanAttributes(rows, config = {}) {
  const mode = config.mode || (process.env.ANTHROPIC_API_KEY ? 'sdk' : 'agent');

  if (mode === 'sdk') {
    return cleanViaSdk(rows, config);
  }

  // Agent mode: instructions for the orchestrator
  throw new Error(
    'clean-attributes in agent mode must be run via:\n' +
    '  node pipeline/run.js <run> --step clean-attributes --agent-slices 6\n' +
    'Or set ANTHROPIC_API_KEY and use mode: "sdk"'
  );
};

// Export prompt for agent use
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
