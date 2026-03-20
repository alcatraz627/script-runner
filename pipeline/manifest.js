/**
 * pipeline/manifest.js — Manages run.manifest.json sidecar files
 *
 * The manifest is the UI-facing view of a run's execution state. It is derived
 * from run.config.js (source of truth for pipeline definition) and enriched with
 * runtime metadata: row counts, durations, file sizes, timestamps, and statuses.
 *
 * The manifest can always be rebuilt from config + data file timestamps, so it is
 * safe to delete — getOrCreate() will bootstrap it fresh.
 *
 * RunManifest shape:
 * @typedef {Object} RunManifest
 * @property {string} runId
 * @property {string} configName
 * @property {string} description
 * @property {string} createdAt - ISO string
 * @property {string|null} lastExecutedAt - ISO string
 * @property {'draft'|'running'|'completed'|'partial'|'error'|'interrupted'} status
 * @property {Object} input
 * @property {string} input.file
 * @property {string} input.sheet
 * @property {number|null} input.rowCount
 * @property {number|null} input.sizeBytes
 * @property {string|null} input.importedAt
 * @property {StepManifest[]} steps
 *
 * @typedef {Object} StepManifest
 * @property {string} id
 * @property {string} fn
 * @property {string} name
 * @property {string} description
 * @property {'pending'|'running'|'completed'|'error'|'skipped'|'interrupted'} status
 * @property {boolean} stale
 * @property {number|null} inputRowCount
 * @property {number|null} outputRowCount
 * @property {number|null} durationMs
 * @property {number|null} outputSizeBytes
 * @property {string|null} startedAt
 * @property {string|null} completedAt
 * @property {string|null} error
 * @property {string|null} outputFile - relative path e.g. "data/normalize.json"
 * @property {Object} params
 * @property {number|null} params.limit
 * @property {string|null} params.slice
 * @property {Object|null} params.columnMap
 * @property {string|null} params.outputFilename
 */

const fs   = require('fs');
const path = require('path');

/**
 * Get or create a manifest for a run directory.
 * Reads existing manifest or bootstraps from run.config.js + data/ files.
 * @param {string} runDir - absolute path to the run directory
 * @returns {RunManifest}
 */
function getOrCreate(runDir) {
  const manifestPath = path.join(runDir, 'run.manifest.json');

  // If manifest already exists, read and return it
  if (fs.existsSync(manifestPath)) {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
  }

  // Bootstrap from run.config.js
  const configPath = path.join(runDir, 'run.config.js');
  if (!fs.existsSync(configPath)) {
    throw new Error(`No run.config.js found at: ${configPath}`);
  }

  // Clear require cache so we always get fresh config
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);
  const runId  = path.basename(runDir);
  const dataDir = path.join(runDir, 'data');

  // Check for existing data files to determine status
  const rawFile = path.join(dataDir, 'raw.json');
  let inputRowCount = null;
  let inputSizeBytes = null;
  let importedAt = null;

  if (fs.existsSync(rawFile)) {
    const stat = fs.statSync(rawFile);
    inputSizeBytes = stat.size;
    importedAt = stat.mtime.toISOString();
    try {
      const rawData = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
      inputRowCount = Array.isArray(rawData) ? rawData.length : null;
    } catch { /* ignore */ }
  }

  // Check input file size
  let inputFileSizeBytes = null;
  if (config.input?.file) {
    const inputAbs = path.isAbsolute(config.input.file)
      ? config.input.file
      : path.resolve(runDir, config.input.file);
    const resolved = inputAbs.startsWith('~')
      ? inputAbs.replace('~', process.env.HOME)
      : inputAbs;
    if (fs.existsSync(resolved)) {
      inputFileSizeBytes = fs.statSync(resolved).size;
    }
  }

  // Build steps from config
  const steps = (config.steps || []).map(step => {
    const stepDataFile = path.join(dataDir, `${step.id}.json`);
    let outputRowCount = null;
    let outputSizeBytes = null;
    let completedAt = null;
    let status = 'pending';

    if (fs.existsSync(stepDataFile)) {
      const stat = fs.statSync(stepDataFile);
      outputSizeBytes = stat.size;
      completedAt = stat.mtime.toISOString();
      status = 'completed';
      try {
        const stepData = JSON.parse(fs.readFileSync(stepDataFile, 'utf8'));
        outputRowCount = Array.isArray(stepData) ? stepData.length : null;
      } catch { /* ignore */ }
    }

    return {
      id:             step.id,
      fn:             step.fn,
      name:           step.name || step.id,
      description:    step.description || '',
      status,
      stale:          false,
      inputRowCount:  null,
      outputRowCount,
      durationMs:     null,
      outputSizeBytes,
      startedAt:      null,
      completedAt,
      error:          null,
      outputFile:     `data/${step.id}.json`,
      params: {
        limit:          step.limit || null,
        slice:          step.slice || null,
        columnMap:      step.columnMap || null,
        outputFilename: step.outputFilename || null,
      },
    };
  });

  // Determine overall status
  const completedCount = steps.filter(s => s.status === 'completed').length;
  let overallStatus = 'draft';
  if (completedCount === steps.length && steps.length > 0) {
    overallStatus = 'completed';
  } else if (completedCount > 0) {
    overallStatus = 'partial';
  }

  const manifest = {
    runId,
    configName:     config.name || runId,
    description:    config.description || '',
    createdAt:      new Date().toISOString(),
    lastExecutedAt: completedAt(steps),
    status:         overallStatus,
    input: {
      file:       config.input?.file || null,
      sheet:      config.input?.sheet || null,
      rowCount:   inputRowCount,
      sizeBytes:  inputFileSizeBytes,
      importedAt,
    },
    steps,
  };

  // Save the bootstrapped manifest
  save(manifest, runDir);
  return manifest;
}

/**
 * Find the latest completedAt among steps
 */
function completedAt(steps) {
  const dates = steps
    .map(s => s.completedAt)
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/**
 * Save manifest to disk.
 * @param {RunManifest} manifest
 * @param {string} runDir
 */
function save(manifest, runDir) {
  const manifestPath = path.join(runDir, 'run.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Mark a step and all downstream steps as stale.
 * @param {RunManifest} manifest
 * @param {string} stepId
 * @returns {RunManifest} - mutated manifest
 */
function markStepStale(manifest, stepId) {
  const idx = manifest.steps.findIndex(s => s.id === stepId);
  if (idx < 0) return manifest;

  for (let i = idx; i < manifest.steps.length; i++) {
    manifest.steps[i].stale = true;
  }
  return manifest;
}

/**
 * Partial update a step manifest entry.
 * @param {RunManifest} manifest
 * @param {string} stepId
 * @param {Partial<StepManifest>} fields
 * @returns {RunManifest} - mutated manifest
 */
function updateStep(manifest, stepId, fields) {
  const step = manifest.steps.find(s => s.id === stepId);
  if (!step) return manifest;
  Object.assign(step, fields);
  return manifest;
}

module.exports = { getOrCreate, save, markStepStale, updateStep };
