#!/usr/bin/env node
/**
 * pipeline/run.js — Pipeline CLI orchestrator
 *
 * Usage:
 *   node pipeline/run.js <run-folder> [options]
 *
 * Options:
 *   --step <id>          Run only this one step
 *   --from <id>          Resume from this step (loads previous step's output as input)
 *   --limit <n>          Cap rows processed
 *   --slice <start,end>  Process only rows start..end (inclusive)
 *   --preview            Open dashboard after run completes
 *   --dry                Print steps without executing
 *   --agent-slices <n>   For LLM steps in agent mode: split into n parallel slice files
 *
 * Run config shape (run.config.js):
 *   module.exports = {
 *     name: 'My Run',
 *     input: { file: './raw/data.xlsx', sheet: 'Sheet1' },
 *     steps: [
 *       { id: 'normalize', fn: 'jegs-normalize', config: { brand: 'JEGS' } },
 *       { id: 'clean-attributes', fn: 'clean-attributes', config: { mode: 'sdk' } },
 *     ],
 *     preview: { port: 3457, fields: { sku: 'Part Number', title: 'Title', image: 'Images' } },
 *     output: './output/final.xlsx',
 *   }
 *
 * Step input/output files (in <run>/data/):
 *   raw.json              → after reading input file
 *   <step-id>.json        → after each transform step
 *   final.json            → alias of last step's output
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const io   = require('./io');
const { execute } = require('./engine');

// ── Load .env from project root (no dotenv dependency needed) ─────────────────
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const get     = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has     = flag => args.includes(flag);

const runFolder    = args.find(a => !a.startsWith('--'));
const onlyStep     = get('--step');
const fromStep     = get('--from');
const limit        = get('--limit');
const slice        = get('--slice');
const preview      = has('--preview');
const dry          = has('--dry');
const agentSlices  = get('--agent-slices') ? parseInt(get('--agent-slices')) : null;

if (!runFolder) {
  console.error('Usage: node pipeline/run.js <run-folder> [--step <id>] [--from <id>] [--limit <n>] [--preview] [--dry]');
  process.exit(1);
}

const runDir    = path.resolve(runFolder);
const configPath = path.join(runDir, 'run.config.js');

if (!fs.existsSync(configPath)) {
  console.error(`No run.config.js found at: ${configPath}`);
  process.exit(1);
}

const config  = require(configPath);

// ── Print plan ────────────────────────────────────────────────────────────────
const allSteps = config.steps || [];
let stepsToRun = allSteps;

if (onlyStep) {
  const s = allSteps.find(s => s.id === onlyStep);
  if (!s) { console.error(`Step "${onlyStep}" not found. Available: ${allSteps.map(s=>s.id).join(', ')}`); process.exit(1); }
  stepsToRun = [s];
} else if (fromStep) {
  const idx = allSteps.findIndex(s => s.id === fromStep);
  if (idx < 0) { console.error(`Step "${fromStep}" not found.`); process.exit(1); }
  stepsToRun = allSteps.slice(idx);
}

const needsInput = !onlyStep && !fromStep;

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${config.name || runFolder}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if (needsInput) console.log(`  Input  : ${config.input?.file || '(none)'}`);
console.log(`  Steps  : ${stepsToRun.map(s => s.id).join(' → ')}`);
if (limit) console.log(`  Limit  : ${limit} rows`);
if (slice) console.log(`  Slice  : rows ${slice}`);
if (dry)   { console.log(`  [DRY RUN — not executing]\n`); process.exit(0); }
console.log('');

// ── Agent-slice mode (handled directly, not via engine) ───────────────────────
if (agentSlices && onlyStep) {
  const step = allSteps.find(s => s.id === onlyStep);
  if (step && step.config?.mode === 'agent') {
    const dataDir = path.join(runDir, 'data');
    const idx = allSteps.indexOf(step);
    const inputId = idx === 0 ? 'raw' : allSteps[idx - 1].id;
    const rows = io.readFile(path.join(dataDir, `${inputId}.json`));

    console.log(`  Agent mode: splitting into ${agentSlices} slices...`);
    const size = Math.ceil(rows.length / agentSlices);
    const sliceFiles = [];
    for (let i = 0; i < agentSlices; i++) {
      const sliceRows  = rows.slice(i * size, (i + 1) * size);
      const sliceFile  = `/tmp/${step.id}-slice-${i * size}.json`;
      const outputFile = `/tmp/${step.id}-slice-${i * size}-cleaned.json`;
      io.writeFile(sliceRows, sliceFile);
      sliceFiles.push({ sliceFile, outputFile, start: i * size, count: sliceRows.length });
      console.log(`  → ${sliceFile} (${sliceRows.length} rows)`);
    }
    const transformPath = path.resolve(__dirname, `../transforms/${step.fn}.js`);
    const transform = require(transformPath);
    const promptExport = transform.SYSTEM_PROMPT;
    if (promptExport) {
      const promptFile = `/tmp/${step.id}-system-prompt.txt`;
      fs.writeFileSync(promptFile, promptExport);
      console.log(`  → ${promptFile} (system prompt)`);
    }
    console.log(`\n  For each slice, run a Claude agent with:`);
    console.log(`  "Read <slice-file>, clean attributes using the system prompt at ${`/tmp/${step.id}-system-prompt.txt`},`);
    console.log(`   write cleaned JSON to <slice-file-cleaned>."\n`);
    console.log(`  Expected output files:`);
    sliceFiles.forEach(f => console.log(`    ${f.outputFile}`));
    console.log(`\n  Then merge results:`);
    console.log(`  node pipeline/merge-slices.js ${runFolder} ${step.id}\n`);
    process.exit(0);
  }
}

// ── Execute via engine ────────────────────────────────────────────────────────
async function main() {
  await execute({
    runDir,
    step: onlyStep,
    fromStep,
    limit,
    slice,
    onEvent: (event) => {
      switch (event.type) {
        case 'import':
          console.log(`[import] ${event.message}`);
          break;
        case 'step-start':
          console.log(`[${event.stepId}] ${event.message}`);
          break;
        case 'step-complete':
          console.log(`  ✓ ${event.message} (${event.rowCount} rows, ${event.durationMs}ms)`);
          break;
        case 'step-error':
          console.error(`  ✗ ${event.message}`);
          break;
        case 'done':
          console.log(`\n✓ ${event.message}`);
          break;
        default:
          console.log(`  ${event.message}`);
      }
    },
  });

  // Preview
  if (preview) {
    const port = config.preview?.port || 3458;
    console.log(`\n✓ Opening preview on port ${port}...`);
    const previewScript = path.resolve(__dirname, 'preview.js');
    const dataPath = path.join(runDir, 'data', 'final.json');
    execSync(`node ${previewScript} --data ${dataPath} --port ${port} &`);
    setTimeout(() => execSync(`open http://localhost:${port}`), 1000);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => { console.error('\n✗ Error:', e.message); process.exit(1); });
