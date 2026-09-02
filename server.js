#!/usr/bin/env node
/**
 * server.js — Express API server for the Pipeline Management UI
 * Port: 5033
 */

// Load .env before anything else so API keys are available to transforms
(function loadEnv() {
  const fs = require('fs'), path = require('path');
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
})();

const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const { execSync } = require('child_process');

const { apiReference } = require('@scalar/express-api-reference');

const io       = require('./pipeline/io');
const manifest = require('./pipeline/manifest');
const queue    = require('./pipeline/job-queue');

const app  = express();
const PORT = process.env.PORT || 5033;

const RUNS_DIR       = path.resolve(__dirname, 'runs');
const TRANSFORMS_DIR = path.resolve(__dirname, 'transforms');

app.use(express.json({ limit: '50mb' }));

// ── Upload config ────────────────────────────────────────────────────────────
const upload = multer({
  dest: '/tmp/pipeline-uploads/',
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ── Helper: list run directories ──────────────────────────────────────────────
// A valid run directory must contain run.config.js. Directories without
// this file are ignored (e.g. zip files, temp folders in runs/).
function listRunDirs() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR)
    .filter(name => {
      const full = path.join(RUNS_DIR, name);
      return fs.statSync(full).isDirectory() &&
        fs.existsSync(path.join(full, 'run.config.js'));
    })
    .map(name => path.join(RUNS_DIR, name));
}

// ── Helper: resolve run dir by id ─────────────────────────────────────────────
function resolveRunDir(id) {
  const runDir = path.join(RUNS_DIR, id);
  if (!fs.existsSync(runDir) || !fs.existsSync(path.join(runDir, 'run.config.js'))) {
    return null;
  }
  return runDir;
}

// ── Helper: load config from run dir ──────────────────────────────────────────
function loadConfig(runDir) {
  const configPath = path.join(runDir, 'run.config.js');
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

// ── Helper: generate a RunSummary from a manifest ─────────────────────────────
// RunSummary is a lightweight projection used by the runs list page.
// It avoids sending full step details for every run in the list.
function toRunSummary(mf) {
  const completedSteps = mf.steps.filter(s => s.status === 'completed').length;
  return {
    runId:          mf.runId,
    configName:     mf.configName,
    description:    mf.description,
    status:         mf.status,
    starred:        mf.starred || false,
    archived:       mf.archived || false,
    stepsCompleted: completedSteps,
    stepsTotal:     mf.steps.length,
    lastExecutedAt: mf.lastExecutedAt,
    createdAt:      mf.createdAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RUNS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/runs — list all runs with summary info
app.get('/api/runs', (req, res) => {
  try {
    const dirs = listRunDirs();
    const summaries = dirs.map(runDir => {
      try {
        const mf = manifest.getOrCreate(runDir);
        return toRunSummary(mf);
      } catch (err) {
        return {
          runId: path.basename(runDir),
          configName: path.basename(runDir),
          description: '',
          status: 'error',
          stepsCompleted: 0,
          stepsTotal: 0,
          lastExecutedAt: null,
          createdAt: null,
          error: err.message,
        };
      }
    });
    // Most recent first (by lastExecutedAt, then createdAt, then dir mtime)
    summaries.sort((a, b) => {
      const ta = a.lastExecutedAt || a.createdAt || '';
      const tb = b.lastExecutedAt || b.createdAt || '';
      return tb.localeCompare(ta);
    });
    res.json(summaries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runs — create a new run
app.post('/api/runs', (req, res) => {
  try {
    const { runId, name, description } = req.body;
    if (!runId || !name) {
      return res.status(400).json({ error: 'runId and name are required' });
    }

    const runDir = path.join(RUNS_DIR, runId);
    if (fs.existsSync(runDir)) {
      return res.status(409).json({ error: `Run "${runId}" already exists` });
    }

    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'raw'),  { recursive: true });
    fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });

    const configContent = `/**\n * ${name}\n */\nmodule.exports = {\n  name: ${JSON.stringify(name)},\n  description: ${JSON.stringify(description || '')},\n\n  input: {\n    file: null,\n    sheet: null,\n  },\n\n  steps: [],\n\n  output: null,\n};\n`;
    fs.writeFileSync(path.join(runDir, 'run.config.js'), configContent, 'utf8');

    const mf = manifest.getOrCreate(runDir);
    res.status(201).json(mf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/runs/:id — full manifest
app.get('/api/runs/:id', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });
    const mf = manifest.getOrCreate(runDir);
    res.json(mf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/runs/:id — delete a run (refuse if running)
app.delete('/api/runs/:id', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const mf = manifest.getOrCreate(runDir);
    if (mf.status === 'running') {
      return res.status(409).json({ error: 'Cannot delete a running pipeline' });
    }

    fs.rmSync(runDir, { recursive: true, force: true });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runs/:id/fork — clone a run with optional data copy
// Creates a new run directory with the same config and raw files (symlinked).
// Optionally copies step output data up to a specified step, allowing users
// to branch from a known-good intermediate state without re-running transforms.
app.post('/api/runs/:id/fork', (req, res) => {
  try {
    const srcDir = resolveRunDir(req.params.id);
    if (!srcDir) return res.status(404).json({ error: 'Run not found' });

    const { newRunId, copyDataThrough } = req.body || {};
    if (!newRunId) return res.status(400).json({ error: 'newRunId is required' });

    const destDir = path.join(RUNS_DIR, newRunId);
    if (fs.existsSync(destDir)) {
      return res.status(409).json({ error: `Run "${newRunId}" already exists` });
    }

    // Validate source config input file resolves before creating anything
    const srcConfig = path.join(srcDir, 'run.config.js');
    delete require.cache[require.resolve(srcConfig)];
    const srcCfg = require(srcConfig);
    if (copyDataThrough || !srcCfg.input?.file) {
      // Copying data or no input file — fine
    } else {
      // Config-only fork: verify the input file can be resolved from source
      // (it will be symlinked, so it just needs to exist in source raw/)
      const inputFile = srcCfg.input.file;
      const inputAbs = path.isAbsolute(inputFile)
        ? inputFile
        : path.resolve(srcDir, inputFile);
      const resolved = inputAbs.startsWith('~')
        ? inputAbs.replace('~', process.env.HOME)
        : inputAbs;
      if (!fs.existsSync(resolved)) {
        return res.status(400).json({
          error: `Input file not found: ${inputFile}. The source run's config references a file that doesn't exist. Fork with data copy, or fix the config first.`
        });
      }
    }

    // Create directories
    fs.mkdirSync(destDir, { recursive: true });
    fs.mkdirSync(path.join(destDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(destDir, 'raw'), { recursive: true });
    fs.mkdirSync(path.join(destDir, 'output'), { recursive: true });

    // Copy config
    fs.copyFileSync(srcConfig, path.join(destDir, 'run.config.js'));

    // Copy raw/ symlinks/files
    const srcRaw = path.join(srcDir, 'raw');
    if (fs.existsSync(srcRaw)) {
      for (const f of fs.readdirSync(srcRaw)) {
        const srcFile = path.join(srcRaw, f);
        const destFile = path.join(destDir, 'raw', f);
        const stat = fs.lstatSync(srcFile);
        if (stat.isSymbolicLink()) {
          fs.symlinkSync(fs.realpathSync(srcFile), destFile);
        } else {
          fs.copyFileSync(srcFile, destFile);
        }
      }
    }

    // Always copy raw.json if it exists in the source
    const rawData = path.join(srcDir, 'data', 'raw.json');
    if (fs.existsSync(rawData)) {
      fs.copyFileSync(rawData, path.join(destDir, 'data', 'raw.json'));
    }

    // Copy step data files up to a step if requested
    if (copyDataThrough) {
      const srcMf = manifest.getOrCreate(srcDir);
      for (const step of srcMf.steps) {
        const stepFile = path.join(srcDir, 'data', `${step.id}.json`);
        if (fs.existsSync(stepFile)) {
          fs.copyFileSync(stepFile, path.join(destDir, 'data', `${step.id}.json`));
        }
        if (step.id === copyDataThrough) break;
      }
    }

    // Bootstrap manifest for the forked run
    const mf = manifest.getOrCreate(destDir);
    res.status(201).json(mf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/runs/:id/config — return run.config.js as JSON
app.get('/api/runs/:id/config', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });
    const config = loadConfig(runDir);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/runs/:id/config — update run.config.js, cascade stale
// Merges partial updates into the config, rewrites the file, and marks all
// manifest steps as stale if input or steps changed (so the UI shows they
// need re-execution).
app.patch('/api/runs/:id/config', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const config = loadConfig(runDir);
    const updates = req.body;

    // Merge updates
    if (updates.input) config.input = { ...config.input, ...updates.input };
    if (updates.steps) config.steps = updates.steps;
    if (updates.name)  config.name = updates.name;
    if (updates.description !== undefined) config.description = updates.description;
    if (updates.output !== undefined) config.output = updates.output;
    if (updates.preview) config.preview = { ...config.preview, ...updates.preview };

    // Write as CommonJS module
    const configStr = `/**\n * ${config.name || ''}\n */\nmodule.exports = ${JSON.stringify(config, null, 2)};\n`;
    fs.writeFileSync(path.join(runDir, 'run.config.js'), configStr, 'utf8');

    // Cascade stale in manifest
    const mf = manifest.getOrCreate(runDir);
    if (updates.steps || updates.input) {
      // Mark all steps stale if input or steps changed
      if (mf.steps.length > 0) {
        manifest.markStepStale(mf, mf.steps[0].id);
      }
      manifest.save(mf, runDir);
    }

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runs/:id/star — toggle starred status
app.post('/api/runs/:id/star', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const mf = manifest.getOrCreate(runDir);
    mf.starred = !mf.starred;
    manifest.save(mf, runDir);
    res.json({ starred: mf.starred });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runs/:id/archive — toggle archived status
app.post('/api/runs/:id/archive', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const mf = manifest.getOrCreate(runDir);
    mf.archived = !mf.archived;
    manifest.save(mf, runDir);
    res.json({ archived: mf.archived });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/runs/:id/execute — enqueue a job
// Adds a pipeline execution to the job queue. Returns immediately with a jobId.
// The actual execution happens asynchronously; monitor via SSE or active-job endpoint.
app.post('/api/runs/:id/execute', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const { step, fromStep, limit, slice } = req.body || {};
    const jobId = `${req.params.id}-${Date.now()}`;

    const job = queue.enqueue({
      jobId,
      runDir,
      executeOptions: { step, fromStep, limit, slice },
    });

    res.json({ jobId: job.jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/runs/:id/events — SSE stream
// Opens a Server-Sent Events connection for real-time pipeline execution updates.
// Replays buffered events from the job queue on connect, then streams live events.
// This eliminates the race condition where early events were lost before SSE connected.
app.get('/api/runs/:id/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  const runId = req.params.id;

  // Replay buffered events from the active job (fixes SSE race condition)
  const activeJob = queue.listJobs().find(j =>
    path.basename(j.runDir) === runId &&
    (j.status === 'running' || j.status === 'queued')
  );
  if (activeJob) {
    for (const event of activeJob.events) {
      res.write(`data: ${JSON.stringify({ jobId: activeJob.jobId, ...event })}\n\n`);
    }
  }

  const handler = ({ jobId, runDir, event }) => {
    if (path.basename(runDir) === runId) {
      res.write(`data: ${JSON.stringify({ jobId, ...event })}\n\n`);

      if (event.type === 'done' || event.type === 'step-error' || event.type === 'interrupted') {
        // Give client time to receive, then close
        setTimeout(() => {
          res.write('data: {"type":"stream-end"}\n\n');
          res.end();
        }, 500);
      }
    }
  };

  queue.on('event', handler);

  req.on('close', () => {
    queue.removeListener('event', handler);
  });
});

// GET /api/runs/:id/active-job — check if a job is currently running for this run
app.get('/api/runs/:id/active-job', (req, res) => {
  const runId = req.params.id;
  const jobs = queue.listJobs();
  const active = jobs.find(j =>
    path.basename(j.runDir) === runId &&
    (j.status === 'running' || j.status === 'queued')
  );

  if (!active) {
    return res.json({ active: false });
  }

  res.json({
    active: true,
    jobId: active.jobId,
    status: active.status,
    events: active.events || [],
  });
});

// GET /api/runs/:id/logs/:stepId — persisted step log events
app.get('/api/runs/:id/logs/:stepId', (req, res) => {
  const runDir = resolveRunDir(req.params.id);
  if (!runDir) return res.status(404).json({ error: 'Run not found' });

  const logFile = path.join(runDir, 'logs', `${req.params.stepId}.jsonl`);
  if (!fs.existsSync(logFile)) {
    return res.json({ events: [] });
  }

  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  res.json({ events });
});

// GET /api/jobs — list all jobs
app.get('/api/jobs', (req, res) => {
  res.json(queue.listJobs());
});

// DELETE /api/jobs/:jobId — cancel a job
app.delete('/api/jobs/:jobId', (req, res) => {
  const cancelled = queue.cancelJob(req.params.jobId);
  if (cancelled) {
    res.json({ cancelled: true });
  } else {
    res.status(400).json({ error: 'Cannot cancel: job not found or already finished' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DATA
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/runs/:id/data/:fileId — paginated data access
app.get('/api/runs/:id/data/:fileId', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const fileId = req.params.fileId;
    const dataFile = path.join(runDir, 'data', `${fileId}.json`);

    if (!fs.existsSync(dataFile)) {
      return res.status(404).json({ error: `Data file not found: ${fileId}` });
    }

    const allRows = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const total = allRows.length;
    const limitVal = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const rows = allRows.slice(offset, offset + limitVal);
    const columns = total > 0 ? Object.keys(allRows[0]) : [];

    res.json({ rows, total, columns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/runs/:id/data/:fileId/download — download file in given format
app.get('/api/runs/:id/data/:fileId/download', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const fileId = req.params.fileId;
    const format = req.query.format || 'json';
    const dataFile = path.join(runDir, 'data', `${fileId}.json`);

    if (!fs.existsSync(dataFile)) {
      return res.status(404).json({ error: `Data file not found: ${fileId}` });
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${fileId}.json"`);
      fs.createReadStream(dataFile).pipe(res);
      return;
    }

    // For xlsx/csv, read and convert
    const rows = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const tmpFile = path.join('/tmp', `download-${fileId}-${Date.now()}.${format}`);
    io.writeFile(rows, tmpFile);

    const ext = format === 'xlsx' ? 'xlsx' : 'csv';
    res.setHeader('Content-Type', format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileId}.${ext}"`);
    fs.createReadStream(tmpFile).pipe(res).on('finish', () => {
      fs.unlink(tmpFile, () => {});
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runs/:id/data/:fileId/open — open file in macOS
app.post('/api/runs/:id/data/:fileId/open', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const fileId = req.params.fileId;
    const dataFile = path.join(runDir, 'data', `${fileId}.json`);

    if (!fs.existsSync(dataFile)) {
      return res.status(404).json({ error: `Data file not found: ${fileId}` });
    }

    execSync(`open "${dataFile}"`);
    res.json({ opened: dataFile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/runs/:id/posters/:filename — serve poster images
app.get('/api/runs/:id/posters/:filename', (req, res) => {
  const runDir = resolveRunDir(req.params.id);
  if (!runDir) return res.status(404).json({ error: 'Run not found' });
  const filePath = path.join(runDir, 'posters', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Poster not found' });
  res.sendFile(filePath);
});

// POST /api/runs/:id/open-posters — reveal posters folder in Finder (macOS only)
app.post('/api/runs/:id/open-posters', (req, res) => {
  const runDir = resolveRunDir(req.params.id);
  if (!runDir) return res.status(404).json({ error: 'Run not found' });
  const postersDir = path.join(runDir, 'posters');
  if (!fs.existsSync(postersDir)) return res.status(404).json({ error: 'No posters directory found' });
  require('child_process').exec(`open "${postersDir}"`);
  res.json({ ok: true });
});

// GET /api/runs/:id/images/zip — zip all images (posters/ dir) and download
app.get('/api/runs/:id/images/zip', (req, res) => {
  const runDir = resolveRunDir(req.params.id);
  if (!runDir) return res.status(404).json({ error: 'Run not found' });
  const postersDir = path.join(runDir, 'posters');
  if (!fs.existsSync(postersDir)) return res.status(404).json({ error: 'No posters directory found' });

  const files = fs.readdirSync(postersDir).filter(f => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f));
  if (files.length === 0) return res.status(404).json({ error: 'No image files found' });

  const zipName = `${req.params.id}-images.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const { execSync } = require('child_process');
  const tmpZip = path.join(require('os').tmpdir(), `${req.params.id}-${Date.now()}.zip`);
  try {
    execSync(`cd "${postersDir}" && zip -j "${tmpZip}" ${files.map(f => `"${f}"`).join(' ')}`, { stdio: 'pipe' });
    const zipBuf = fs.readFileSync(tmpZip);
    res.send(zipBuf);
    fs.unlinkSync(tmpZip);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create zip: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FILES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/runs/:id/upload — upload file to run's raw/ dir
app.post('/api/runs/:id/upload', upload.single('file'), (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const rawDir = path.join(runDir, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });

    const dest = path.join(rawDir, req.file.originalname);
    fs.renameSync(req.file.path, dest);

    // Try to list sheets if xlsx
    let sheets = [];
    const ext = path.extname(dest).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) {
      try { sheets = io.listSheets(dest); } catch { /* ignore */ }
    }

    res.json({
      filename: req.file.originalname,
      path: `./raw/${req.file.originalname}`,
      sheets,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files — list all uploaded files across runs
app.get('/api/files', (req, res) => {
  try {
    const files = [];
    const runDirs = listRunDirs();
    for (const runDir of runDirs) {
      const runId = path.basename(runDir);
      const rawDir = path.join(runDir, 'raw');
      if (!fs.existsSync(rawDir)) continue;
      const entries = fs.readdirSync(rawDir);
      for (const entry of entries) {
        const fullPath = path.join(rawDir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile() && !stat.isSymbolicLink()) continue;
          const isSymlink = fs.lstatSync(fullPath).isSymbolicLink();
          let linkedFrom = null;
          if (isSymlink) {
            try { linkedFrom = fs.readlinkSync(fullPath); } catch { /* ignore */ }
          }
          files.push({
            filename: entry,
            runId,
            path: `./raw/${entry}`,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            ext: path.extname(entry).toLowerCase(),
            isSymlink,
            linkedFrom,
          });
        } catch { /* skip unreadable files */ }
      }
    }
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runs/:id/link-file — symlink an existing file from another run
app.post('/api/runs/:id/link-file', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const { sourceRunId, filename } = req.body;
    if (!sourceRunId || !filename) {
      return res.status(400).json({ error: 'sourceRunId and filename required' });
    }

    const sourceDir = resolveRunDir(sourceRunId);
    if (!sourceDir) return res.status(404).json({ error: 'Source run not found' });

    const sourceFile = path.join(sourceDir, 'raw', filename);
    if (!fs.existsSync(sourceFile)) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    const rawDir = path.join(runDir, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const dest = path.join(rawDir, filename);

    if (fs.existsSync(dest)) {
      return res.status(409).json({ error: 'File already exists in this run' });
    }

    // Symlink to the real file (resolve through any existing symlinks)
    const realSource = fs.realpathSync(sourceFile);
    fs.symlinkSync(realSource, dest);

    // Try to list sheets if xlsx
    let sheets = [];
    const ext = path.extname(dest).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) {
      try { sheets = io.listSheets(dest); } catch { /* ignore */ }
    }

    res.json({
      filename,
      path: `./raw/${filename}`,
      sheets,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/preview — preview raw file contents (first N rows)
app.get('/api/files/preview', (req, res) => {
  try {
    const runId = req.query.runId;
    const filename = req.query.filename;
    const sheet = req.query.sheet || null;
    const limit = parseInt(req.query.limit || '50', 10);

    if (!runId || !filename) {
      return res.status(400).json({ error: 'runId and filename query params required' });
    }

    const runDir = resolveRunDir(runId);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });

    const filePath = path.join(runDir, 'raw', filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(filename).toLowerCase();

    // JSON files
    if (ext === '.json') {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const rows = Array.isArray(raw) ? raw : [raw];
      const total = rows.length;
      const sliced = rows.slice(0, limit);
      const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];
      return res.json({ rows: sliced, total, columns, format: 'json' });
    }

    // Excel / CSV files
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      const rows = io.readFile(filePath, { sheet, limit: limit + 1 });
      const total = rows.length > limit ? rows.length : rows.length; // estimate
      const sliced = rows.slice(0, limit);
      const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];
      // For full count, read without limit
      let fullCount = total;
      try {
        const allRows = io.readFile(filePath, { sheet });
        fullCount = allRows.length;
      } catch { /* use estimate */ }
      return res.json({ rows: sliced, total: fullCount, columns, format: ext.replace('.', '') });
    }

    // Unsupported format — return file info only
    const stat = fs.statSync(filePath);
    res.json({ rows: [], total: 0, columns: [], format: ext.replace('.', ''), sizeBytes: stat.size, message: 'Preview not available for this file type' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/sheets — list sheet names for a file
app.get('/api/files/sheets', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });

    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(RUNS_DIR, filePath);

    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const sheets = io.listSheets(abs);
    res.json({ sheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TRANSFORMS
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: parse JSDoc-style header comment from a JS file.
// Transforms use a structured header comment to declare their description,
// config schema, and input/output contract. This parser extracts those fields
// so the UI can display transform metadata without executing the module.
function parseTransformHeader(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const match = src.match(/^\/\*\*\s*\n([\s\S]*?)\*\//);
  if (!match) return { description: '', config: '', inputOutput: '' };

  const block = match[1]
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();

  // Extract description: everything before "Config:" or "@param"
  const configIdx = block.search(/\n\s*(Config:|@param)/);
  const description = configIdx >= 0
    ? block.slice(0, configIdx).trim()
    : block;

  // Extract Config block
  const configMatch = block.match(/Config:\s*\n([\s\S]*?)(?=\n\s*(?:Agent|Input|Output|\*|@)|$)/i);
  const config = configMatch ? configMatch[1].trim() : '';

  // Extract Input/Output lines
  const ioLines = [];
  const inputMatch = block.match(/Input:\s*(.+)/i);
  const outputMatch = block.match(/Output:\s*(.+)/i);
  if (inputMatch) ioLines.push('Input: ' + inputMatch[1].trim());
  if (outputMatch) ioLines.push('Output: ' + outputMatch[1].trim());

  return {
    description: description.replace(/^transforms\/\S+\s*\n*/, '').replace(/^[\s—\-]+/, '').trim(),
    config,
    inputOutput: ioLines.join('\n'),
  };
}

// GET /api/transforms — list available transforms
app.get('/api/transforms', (req, res) => {
  try {
    if (!fs.existsSync(TRANSFORMS_DIR)) {
      return res.json([]);
    }

    const files = fs.readdirSync(TRANSFORMS_DIR)
      .filter(f => f.endsWith('.js'))
      .sort((a, b) => {
        // Most recently modified first
        const ma = fs.statSync(path.join(TRANSFORMS_DIR, a)).mtimeMs;
        const mb = fs.statSync(path.join(TRANSFORMS_DIR, b)).mtimeMs;
        return mb - ma;
      });
    const transforms = files.map(file => {
      const name = file.replace(/\.js$/, '');
      const fullPath = path.join(TRANSFORMS_DIR, file);
      let hasSystemPrompt = false;
      let exportedHelpers = [];

      try {
        delete require.cache[require.resolve(fullPath)];
        const mod = require(fullPath);

        hasSystemPrompt = !!mod.SYSTEM_PROMPT;

        // Collect named exports (excluding default function)
        exportedHelpers = Object.keys(mod).filter(k =>
          k !== 'SYSTEM_PROMPT' &&
          typeof mod[k] === 'function' &&
          k !== 'default'
        );
      } catch { /* ignore require errors */ }

      const header = parseTransformHeader(fullPath);

      return {
        name,
        hasSystemPrompt,
        exportedHelpers,
        description: header.description,
        config: header.config,
        inputOutput: header.inputOutput,
      };
    });

    res.json(transforms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transforms/:name/source — read transform source code
app.get('/api/transforms/:name/source', (req, res) => {
  try {
    const name = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    const filePath = path.join(TRANSFORMS_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Transform not found: ${name}` });
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const stat = fs.statSync(filePath);
    res.json({
      name,
      source,
      lines: source.split('\n').length,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transforms/:name/helpers — get helper function details
app.get('/api/transforms/:name/helpers', (req, res) => {
  try {
    const name = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    const filePath = path.join(TRANSFORMS_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Transform not found: ${name}` });
    }

    const source = fs.readFileSync(filePath, 'utf8');

    // Clear require cache and load module
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);

    const helpers = Object.keys(mod)
      .filter(k => k !== 'SYSTEM_PROMPT' && typeof mod[k] === 'function' && k !== 'default')
      .map(k => {
        const fn = mod[k];
        const fnStr = fn.toString();

        // Extract parameter list
        const paramMatch = fnStr.match(/^(?:function\s+\w*|(?:async\s+)?function\s*|\(?)?\s*\(([^)]*)\)/);
        const params = paramMatch ? paramMatch[1].split(',').map(p => p.trim()).filter(Boolean) : [];

        // Extract function body from source for the actual source code
        // Look for: function name( or const name = or exports.name =
        const fnRegex = new RegExp(
          `(?:function\\s+${k}\\s*\\([\\s\\S]*?\\}(?=\\s*\\n)|` +
          `(?:const|let|var)\\s+${k}\\s*=\\s*(?:function|\\([^)]*\\)\\s*=>)[\\s\\S]*?(?:\\};|\\}\\s*\\n))`,
          'g'
        );
        const srcMatch = source.match(fnRegex);
        const fnSource = srcMatch ? srcMatch[0] : fnStr.slice(0, 500);

        // Try to extract a JSDoc comment above the function
        const docRegex = new RegExp(`\\/\\*\\*[\\s\\S]*?\\*\\/\\s*\\n\\s*(?:function\\s+${k}|(?:const|let|var)\\s+${k})`);
        const docMatch = source.match(docRegex);
        let description = '';
        if (docMatch) {
          description = docMatch[0]
            .match(/\/\*\*([\s\S]*?)\*\//)?.[1]
            ?.split('\n')
            .map(l => l.replace(/^\s*\*\s?/, ''))
            .join(' ')
            .trim() || '';
        }

        return { name: k, params, description, source: fnSource };
      });

    res.json({ name, helpers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transforms/:name/defaults — get default config values
app.get('/api/transforms/:name/defaults', (req, res) => {
  try {
    const name = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    const filePath = path.join(TRANSFORMS_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Transform not found: ${name}` });
    }

    const header = parseTransformHeader(filePath);
    let defaults = {};

    // Try to parse the config block as JSON-like
    if (header.config) {
      try {
        // The config block is often like: key: value\n key2: value2
        // Try JSON parse first
        defaults = JSON.parse(header.config);
      } catch {
        // Parse key: value format
        const lines = header.config.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*(\w+)\s*[:=]\s*(.+)/);
          if (match) {
            const val = match[2].trim().replace(/,?\s*$/, '');
            try { defaults[match[1]] = JSON.parse(val); }
            catch { defaults[match[1]] = val; }
          }
        }
      }
    }

    res.json({ name, config: header.config, defaults, inputOutput: header.inputOutput, description: header.description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/transforms/:name/source — save transform source code
app.put('/api/transforms/:name/source', (req, res) => {
  try {
    const name = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    const filePath = path.join(TRANSFORMS_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Transform not found: ${name}` });
    }
    const { source } = req.body;
    if (typeof source !== 'string') {
      return res.status(400).json({ error: 'source field is required' });
    }
    fs.writeFileSync(filePath, source, 'utf8');
    const stat = fs.statSync(filePath);
    res.json({
      name,
      lines: source.split('\n').length,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runs/:id/report — generate a markdown summary report for a run
app.post('/api/runs/:id/report', (req, res) => {
  try {
    const runDir = resolveRunDir(req.params.id);
    if (!runDir) return res.status(404).json({ error: 'Run not found' });
    const m = manifest.getOrCreate(runDir);

    const { instructions } = req.body || {};
    const lines = [];

    lines.push(`# Run Report: ${m.configName}`);
    lines.push('');
    lines.push(`**Run ID:** \`${m.runId}\``);
    lines.push(`**Status:** ${m.status}`);
    lines.push(`**Created:** ${m.createdAt || 'N/A'}`);
    lines.push(`**Last Executed:** ${m.lastExecutedAt || 'Never'}`);
    if (m.description) lines.push(`**Description:** ${m.description}`);
    lines.push('');

    if (instructions) {
      lines.push('## Instructions');
      lines.push('');
      lines.push(instructions);
      lines.push('');
    }

    // Input section
    lines.push('## Input');
    lines.push('');
    if (m.input && m.input.file) {
      lines.push(`- **File:** ${m.input.file}`);
      if (m.input.sheet) lines.push(`- **Sheet:** ${m.input.sheet}`);
      if (m.input.rowCount != null) lines.push(`- **Rows:** ${m.input.rowCount.toLocaleString()}`);
      if (m.input.sizeBytes != null) lines.push(`- **Size:** ${(m.input.sizeBytes / 1024).toFixed(1)} KB`);
    } else {
      lines.push('No input file configured.');
    }
    lines.push('');

    // Steps section
    lines.push('## Pipeline Steps');
    lines.push('');
    lines.push('| # | Step | Transform | Status | Input Rows | Output Rows | Duration |');
    lines.push('|---|------|-----------|--------|------------|-------------|----------|');
    (m.steps || []).forEach((step, i) => {
      const dur = step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : '--';
      const inR = step.inputRowCount != null ? step.inputRowCount.toLocaleString() : '--';
      const outR = step.outputRowCount != null ? step.outputRowCount.toLocaleString() : '--';
      lines.push(`| ${i + 1} | ${step.name || step.id} | ${step.fn} | ${step.status} | ${inR} | ${outR} | ${dur} |`);
    });
    lines.push('');

    // Errors section
    const errorSteps = (m.steps || []).filter(s => s.error);
    if (errorSteps.length > 0) {
      lines.push('## Errors');
      lines.push('');
      errorSteps.forEach(s => {
        lines.push(`### ${s.name || s.id}`);
        lines.push('```');
        lines.push(s.error);
        lines.push('```');
        lines.push('');
      });
    }

    // Summary
    const completed = (m.steps || []).filter(s => s.status === 'completed').length;
    const total = (m.steps || []).length;
    const totalDuration = (m.steps || []).reduce((sum, s) => sum + (s.durationMs || 0), 0);
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Steps completed:** ${completed}/${total}`);
    lines.push(`- **Total duration:** ${(totalDuration / 1000).toFixed(1)}s`);
    lines.push(`- **Generated:** ${new Date().toISOString()}`);

    const markdown = lines.join('\n');

    // Write to file
    const reportPath = path.join(runDir, 'report.md');
    fs.writeFileSync(reportPath, markdown, 'utf-8');

    res.json({
      markdown,
      path: reportPath,
      filename: 'report.md',
      message: `Report generated. Use /create-report ${reportPath} to convert to HTML.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  META
// ═══════════════════════════════════════════════════════════════════════════════

// ── Shared doc registry (single source of truth) ─────────────────────────────
const DOC_FILES = [
  { id: 'system-design', label: 'System Design', path: 'SYSTEM-DESIGN.md', description: 'Architecture, API design, and data flow' },
  { id: 'tech-stack', label: 'Tech Stack', path: 'TECH-STACK.md', description: 'Technical specs, dependencies, and setup' },
  { id: 'changelog', label: 'Changelog', path: 'ui/CHANGELOG.md', description: 'Feature history and release notes' },
  { id: 'scripts-readme', label: 'Scripts README', path: 'README.md', description: 'Pipeline scripts overview' },
  { id: 'deploy', label: 'Deployment', path: 'DEPLOY.md', description: 'Preview dashboard deployment (Vercel)' },
  { id: 'deploy-strategy', label: 'Deployment Strategy', path: 'DEPLOYMENT-STRATEGY.md', description: 'Full app deployment options and checklist' },
  { id: 'sse-race-condition', label: 'SSE Race Condition', path: 'sse-event-race-condition.md', description: 'Known SSE bug writeup and fix plan' },
  { id: 'ui-readme', label: 'UI README', path: 'ui/README.md', description: 'SvelteKit frontend setup' },
  { id: 'parse-excel-readme', label: 'Parse Excel', path: 'parse-excel/README.md', description: 'Excel parsing module docs' },
];
const DOC_MAP = Object.fromEntries(DOC_FILES.map(f => [f.id, f.path]));

function resolveDocPath(id) {
  const relPath = DOC_MAP[id];
  if (!relPath) return null;
  const fullPath = path.join(path.resolve(__dirname), relPath);
  return fs.existsSync(fullPath) ? { relPath, fullPath } : null;
}

// GET /api/docs/files — list available markdown documentation files
app.get('/api/docs/files', (req, res) => {
  const baseDir = path.resolve(__dirname);
  const result = DOC_FILES.map(f => {
    const fullPath = path.join(baseDir, f.path);
    const exists = fs.existsSync(fullPath);
    let sizeBytes = 0;
    let modifiedAt = null;
    if (exists) {
      const stat = fs.statSync(fullPath);
      sizeBytes = stat.size;
      modifiedAt = stat.mtime.toISOString();
    }
    return { ...f, exists, sizeBytes, modifiedAt };
  });
  res.json(result);
});

// GET /api/docs/files/:id — read a specific markdown file
app.get('/api/docs/files/:id', (req, res) => {
  const doc = resolveDocPath(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const content = fs.readFileSync(doc.fullPath, 'utf-8');
  res.json({ id: req.params.id, path: doc.relPath, content });
});

// GET /api/docs/files/:id/raw — serve raw markdown as text/plain (for "open in new tab")
app.get('/api/docs/files/:id/raw', (req, res) => {
  const doc = resolveDocPath(req.params.id);
  if (!doc) return res.status(404).send('Document not found');
  res.type('text/plain; charset=utf-8').sendFile(doc.fullPath);
});

app.get('/api/schema', (req, res) => {
  res.json({
    name: 'Pipeline Management API',
    version: '1.0.0',
    endpoints: [
      { method: 'GET',    path: '/api/runs',                          description: 'List all runs' },
      { method: 'POST',   path: '/api/runs',                          description: 'Create a new run' },
      { method: 'GET',    path: '/api/runs/:id',                      description: 'Get full run manifest' },
      { method: 'DELETE', path: '/api/runs/:id',                      description: 'Delete a run' },
      { method: 'GET',    path: '/api/runs/:id/config',               description: 'Get run config' },
      { method: 'PATCH',  path: '/api/runs/:id/config',               description: 'Update run config' },
      { method: 'POST',   path: '/api/runs/:id/execute',              description: 'Execute pipeline' },
      { method: 'GET',    path: '/api/runs/:id/events',               description: 'SSE event stream' },
      { method: 'GET',    path: '/api/jobs',                           description: 'List all jobs' },
      { method: 'DELETE', path: '/api/jobs/:jobId',                    description: 'Cancel a job' },
      { method: 'GET',    path: '/api/runs/:id/data/:fileId',         description: 'Get paginated data' },
      { method: 'GET',    path: '/api/runs/:id/data/:fileId/download', description: 'Download data file' },
      { method: 'POST',   path: '/api/runs/:id/data/:fileId/open',    description: 'Open file in OS' },
      { method: 'POST',   path: '/api/runs/:id/upload',               description: 'Upload file to run' },
      { method: 'GET',    path: '/api/files',                            description: 'List all files across runs' },
      { method: 'GET',    path: '/api/files/preview',                  description: 'Preview raw file contents' },
      { method: 'GET',    path: '/api/files/sheets',                   description: 'List sheets in file' },
      { method: 'POST',   path: '/api/runs/:id/link-file',             description: 'Link file from another run' },
      { method: 'GET',    path: '/api/transforms',                     description: 'List transforms' },
      { method: 'GET',    path: '/api/transforms/:name/helpers',       description: 'Get helper function details' },
      { method: 'GET',    path: '/api/transforms/:name/defaults',      description: 'Get default config values' },
      { method: 'GET',    path: '/api/schema',                         description: 'API schema' },
      { method: 'GET',    path: '/api/openapi.json',                   description: 'OpenAPI 3.1 spec' },
      { method: 'GET',    path: '/api/docs',                           description: 'Interactive API docs (Scalar)' },
      { method: 'GET',    path: '/api/docs/files',                     description: 'List documentation files' },
      { method: 'GET',    path: '/api/docs/files/:id',                 description: 'Read a documentation file' },
    ],
  });
});

// GET /api/openapi.json — OpenAPI 3.1 spec (generated from /api/schema metadata)
app.get('/api/openapi.json', (req, res) => {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Pipeline Management API',
      version: '1.0.0',
      description: 'Express API server for the Pipeline Management UI. Manages pipeline runs, transforms, jobs, file uploads, and data access.',
    },
    servers: [{ url: `http://localhost:${PORT}`, description: 'Local dev server' }],
    paths: {},
  };

  // ── Reusable schema fragments ──
  const idParam = (name, description) => ({
    name, in: 'path', required: true, schema: { type: 'string' }, description,
  });
  const queryParam = (name, description, required = false) => ({
    name, in: 'query', required, schema: { type: 'string' }, description,
  });
  const jsonBody = (description, example) => ({
    required: true,
    content: { 'application/json': { schema: { type: 'object' }, ...(example ? { example } : {}) } },
    description,
  });
  const jsonResponse = (description) => ({
    200: { description, content: { 'application/json': { schema: { type: 'object' } } } },
  });
  const errorResponses = {
    400: { description: 'Bad request' },
    404: { description: 'Not found' },
    409: { description: 'Conflict' },
    500: { description: 'Internal server error' },
  };

  // ── Runs ──
  spec.paths['/api/runs'] = {
    get:  { summary: 'List all runs', tags: ['Runs'], responses: jsonResponse('Array of run summaries') },
    post: { summary: 'Create a new run', tags: ['Runs'],
      requestBody: jsonBody('Run creation payload', { runId: 'my-run', name: 'My Run', description: 'Optional description' }),
      responses: { 201: { description: 'Created run manifest' }, ...errorResponses },
    },
  };
  spec.paths['/api/runs/{id}'] = {
    get:    { summary: 'Get full run manifest', tags: ['Runs'], parameters: [idParam('id', 'Run ID')], responses: { ...jsonResponse('Full manifest'), ...errorResponses } },
    delete: { summary: 'Delete a run', tags: ['Runs'], parameters: [idParam('id', 'Run ID')], responses: { ...jsonResponse('Deletion confirmation'), ...errorResponses } },
  };
  spec.paths['/api/runs/{id}/fork'] = {
    post: { summary: 'Fork (clone) a run', tags: ['Runs'],
      parameters: [idParam('id', 'Source run ID')],
      requestBody: jsonBody('Fork options', { newRunId: 'forked-run', copyDataThrough: 'step-id' }),
      responses: { 201: { description: 'Forked run manifest' }, ...errorResponses },
    },
  };

  // ── Config ──
  spec.paths['/api/runs/{id}/config'] = {
    get:   { summary: 'Get run config', tags: ['Config'], parameters: [idParam('id', 'Run ID')], responses: { ...jsonResponse('Run config object'), ...errorResponses } },
    patch: { summary: 'Update run config', tags: ['Config'],
      parameters: [idParam('id', 'Run ID')],
      requestBody: jsonBody('Partial config update', { name: 'New Name', steps: [] }),
      responses: { ...jsonResponse('Updated config'), ...errorResponses },
    },
  };

  // ── Execution ──
  spec.paths['/api/runs/{id}/execute'] = {
    post: { summary: 'Execute pipeline', tags: ['Execution'],
      parameters: [idParam('id', 'Run ID')],
      requestBody: jsonBody('Execution options', { step: 'step-id', fromStep: null, limit: 10, slice: null }),
      responses: { ...jsonResponse('Job ID'), ...errorResponses },
    },
  };
  spec.paths['/api/runs/{id}/events'] = {
    get: { summary: 'SSE event stream for run execution', tags: ['Execution'],
      parameters: [idParam('id', 'Run ID')],
      responses: { 200: { description: 'Server-Sent Events stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } },
    },
  };
  spec.paths['/api/jobs'] = {
    get: { summary: 'List all jobs', tags: ['Execution'], responses: jsonResponse('Array of jobs') },
  };
  spec.paths['/api/jobs/{jobId}'] = {
    delete: { summary: 'Cancel a job', tags: ['Execution'], parameters: [idParam('jobId', 'Job ID')], responses: { ...jsonResponse('Cancellation result'), ...errorResponses } },
  };

  // ── Data ──
  spec.paths['/api/runs/{id}/data/{fileId}'] = {
    get: { summary: 'Get paginated data', tags: ['Data'],
      parameters: [idParam('id', 'Run ID'), idParam('fileId', 'Data file ID'), queryParam('limit', 'Rows per page (default 50)'), queryParam('offset', 'Row offset (default 0)')],
      responses: { ...jsonResponse('Paginated rows with columns and total'), ...errorResponses },
    },
  };
  spec.paths['/api/runs/{id}/data/{fileId}/download'] = {
    get: { summary: 'Download data file', tags: ['Data'],
      parameters: [idParam('id', 'Run ID'), idParam('fileId', 'Data file ID'), queryParam('format', 'File format: json, csv, or xlsx (default json)')],
      responses: { 200: { description: 'File download' }, ...errorResponses },
    },
  };
  spec.paths['/api/runs/{id}/data/{fileId}/open'] = {
    post: { summary: 'Open data file in macOS', tags: ['Data'],
      parameters: [idParam('id', 'Run ID'), idParam('fileId', 'Data file ID')],
      responses: { ...jsonResponse('Opened file path'), ...errorResponses },
    },
  };

  // ── Files ──
  spec.paths['/api/runs/{id}/upload'] = {
    post: { summary: 'Upload file to run', tags: ['Files'],
      parameters: [idParam('id', 'Run ID')],
      requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
      responses: { ...jsonResponse('Upload result with filename, path, and sheets'), ...errorResponses },
    },
  };
  spec.paths['/api/files'] = {
    get: { summary: 'List all files across runs', tags: ['Files'], responses: jsonResponse('Array of file metadata') },
  };
  spec.paths['/api/files/preview'] = {
    get: { summary: 'Preview raw file contents', tags: ['Files'],
      parameters: [queryParam('runId', 'Run ID', true), queryParam('filename', 'File name', true), queryParam('sheet', 'Sheet name'), queryParam('limit', 'Row limit (default 50)')],
      responses: { ...jsonResponse('Preview rows, total, columns, format'), ...errorResponses },
    },
  };
  spec.paths['/api/files/sheets'] = {
    get: { summary: 'List sheets in a file', tags: ['Files'],
      parameters: [queryParam('path', 'File path', true)],
      responses: { ...jsonResponse('Array of sheet names'), ...errorResponses },
    },
  };
  spec.paths['/api/runs/{id}/link-file'] = {
    post: { summary: 'Symlink file from another run', tags: ['Files'],
      parameters: [idParam('id', 'Run ID')],
      requestBody: jsonBody('Link options', { sourceRunId: 'other-run', filename: 'data.xlsx' }),
      responses: { ...jsonResponse('Link result'), ...errorResponses },
    },
  };

  // ── Transforms ──
  spec.paths['/api/transforms'] = {
    get: { summary: 'List available transforms', tags: ['Transforms'], responses: jsonResponse('Array of transform metadata') },
  };
  spec.paths['/api/transforms/{name}/source'] = {
    get: { summary: 'Read transform source code', tags: ['Transforms'], parameters: [idParam('name', 'Transform name')], responses: { ...jsonResponse('Source code and metadata'), ...errorResponses } },
    put: { summary: 'Save transform source code', tags: ['Transforms'],
      parameters: [idParam('name', 'Transform name')],
      requestBody: jsonBody('Source update', { source: '// transform code...' }),
      responses: { ...jsonResponse('Updated file metadata'), ...errorResponses },
    },
  };
  spec.paths['/api/transforms/{name}/helpers'] = {
    get: { summary: 'Get helper function details', tags: ['Transforms'], parameters: [idParam('name', 'Transform name')], responses: { ...jsonResponse('Helper functions'), ...errorResponses } },
  };
  spec.paths['/api/transforms/{name}/defaults'] = {
    get: { summary: 'Get default config values', tags: ['Transforms'], parameters: [idParam('name', 'Transform name')], responses: { ...jsonResponse('Default config'), ...errorResponses } },
  };

  // ── Meta ──
  spec.paths['/api/schema'] = {
    get: { summary: 'API schema (endpoint list)', tags: ['Meta'], responses: jsonResponse('Endpoint metadata') },
  };
  spec.paths['/api/openapi.json'] = {
    get: { summary: 'OpenAPI 3.1 specification', tags: ['Meta'], responses: jsonResponse('OpenAPI spec document') },
  };
  spec.paths['/api/docs'] = {
    get: { summary: 'Interactive API documentation (Scalar)', tags: ['Meta'], responses: { 200: { description: 'HTML documentation page' } } },
  };

  res.json(spec);
});

// GET /api/docs — Scalar API reference browser
app.get(
  '/api/docs',
  apiReference({
    pageTitle: 'Pipeline Management API',
    spec: { url: '/api/openapi.json' },
    theme: 'default',
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
//  MANUAL STEP APPROVAL
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/runs/:id/approve — resume a pipeline suspended at a manual step.
// Body: { stepId: string }
app.post('/api/runs/:id/approve', (req, res) => {
  const runDir = resolveRunDir(req.params.id);
  if (!runDir) return res.status(404).json({ error: 'Run not found' });
  const { stepId } = req.body;
  if (!stepId) return res.status(400).json({ error: 'stepId required' });

  // Find the active job for this run
  const job = queue.listJobs().find(j =>
    j.runDir === runDir && j.status === 'awaiting'
  );
  if (!job) return res.status(409).json({ error: 'No awaiting job for this run' });

  const ok = queue.approve(job.jobId, stepId);
  if (!ok) return res.status(409).json({ error: `Job not awaiting step "${stepId}"` });

  res.json({ ok: true, jobId: job.jobId });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD PLUGIN API
// ═══════════════════════════════════════════════════════════════════════════════

const DASHBOARDS_DIR = path.join(__dirname, 'dashboards');

// Serve dashboard static files (HTML, JS, assets) under /dashboards/*
app.use('/dashboards', express.static(DASHBOARDS_DIR));

// GET /api/dashboards — list all registered dashboard plugins.
// A dashboard plugin is any subdirectory in dashboards/ that contains a manifest.json.
app.get('/api/dashboards', (req, res) => {
  if (!fs.existsSync(DASHBOARDS_DIR)) return res.json([]);
  const entries = fs.readdirSync(DASHBOARDS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => {
      const manifestPath = path.join(DASHBOARDS_DIR, e.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return null;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return { id: e.name, ...manifest };
      } catch { return null; }
    })
    .filter(Boolean);
  res.json(entries);
});

// GET /api/dashboards/:id — single dashboard manifest.
app.get('/api/dashboards/:id', (req, res) => {
  const manifestPath = path.join(DASHBOARDS_DIR, req.params.id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: 'Dashboard not found' });
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json({ id: req.params.id, ...manifest });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/runs/:runId/dashboard-selections/:dashboardId — load saved selections.
app.get('/api/runs/:runId/dashboard-selections/:dashboardId', (req, res) => {
  const runDir = resolveRunDir(req.params.runId);
  if (!runDir) return res.status(404).json({ error: 'Run not found' });
  const filePath = path.join(runDir, 'data', `_selections-${req.params.dashboardId}.json`);
  if (!fs.existsSync(filePath)) return res.json({});
  try { res.json(JSON.parse(fs.readFileSync(filePath, 'utf8'))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/runs/:runId/dashboard-selections/:dashboardId — save selections.
app.post('/api/runs/:runId/dashboard-selections/:dashboardId', (req, res) => {
  const runDir = resolveRunDir(req.params.runId);
  if (!runDir) return res.status(404).json({ error: 'Run not found' });
  const filePath = path.join(runDir, 'data', `_selections-${req.params.dashboardId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LEGACY DASHBOARD COMPAT APIS
//  These support old standalone dashboards (preview-dashboard, image-selector)
//  that have been moved into dashboards/ and now run through this server.
// ═══════════════════════════════════════════════════════════════════════════════

// GET/POST /api/selections — preview-dashboard selections compat
// (preview-dashboard/index.html fetches /api/selections)
const PREVIEW_SELECTIONS_FILE = path.join(__dirname, 'preview-dashboard', 'selections.json');
app.get('/api/selections', (req, res) => {
  try {
    const data = fs.existsSync(PREVIEW_SELECTIONS_FILE)
      ? JSON.parse(fs.readFileSync(PREVIEW_SELECTIONS_FILE, 'utf8'))
      : {};
    res.json(data);
  } catch { res.json({}); }
});
app.post('/api/selections', (req, res) => {
  try {
    fs.writeFileSync(PREVIEW_SELECTIONS_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/datasets — list image-selector datasets
// GET /api/datasets/:id/data — dataset items
// GET/POST /api/datasets/:id/selections — dataset selections
const IMAGE_SELECTOR_DATASETS_DIR = path.join(__dirname, 'image-selector', 'datasets');
app.get('/api/datasets', (req, res) => {
  if (!fs.existsSync(IMAGE_SELECTOR_DATASETS_DIR)) return res.json([]);
  const datasets = fs.readdirSync(IMAGE_SELECTOR_DATASETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dataFile = path.join(IMAGE_SELECTOR_DATASETS_DIR, d.name, 'data.json');
      let itemCount = 0;
      try { const data = JSON.parse(fs.readFileSync(dataFile, 'utf8')); itemCount = Array.isArray(data) ? data.length : 0; } catch {}
      return { id: d.name, name: d.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), itemCount };
    })
    .filter(d => d.itemCount > 0);
  res.json(datasets);
});
app.get('/api/datasets/:id/data', (req, res) => {
  const file = path.join(IMAGE_SELECTOR_DATASETS_DIR, req.params.id, 'data.json');
  if (!file.startsWith(IMAGE_SELECTOR_DATASETS_DIR) || !fs.existsSync(file))
    return res.status(404).json({ error: 'Dataset not found' });
  res.sendFile(file);
});
app.get('/api/datasets/:id/selections', (req, res) => {
  const file = path.join(IMAGE_SELECTOR_DATASETS_DIR, req.params.id, 'selections.json');
  if (!file.startsWith(IMAGE_SELECTOR_DATASETS_DIR)) return res.status(404).json({ error: 'Not found' });
  try {
    res.json(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  } catch { res.json({}); }
});
app.post('/api/datasets/:id/selections', (req, res) => {
  const file = path.join(IMAGE_SELECTOR_DATASETS_DIR, req.params.id, 'selections.json');
  if (!file.startsWith(IMAGE_SELECTOR_DATASETS_DIR)) return res.status(403).json({ error: 'Forbidden' });
  try {
    fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  STATIC / SPA FALLBACK
// ═══════════════════════════════════════════════════════════════════════════════

// Dev redirect: send browser requests to Vite dev server (port 5173)
// Falls through to static build serving if Vite isn't running
const VITE_DEV_PORT = 3033;
const uiBuildDir = path.join(__dirname, 'ui', 'build');
const hasUIBuild = fs.existsSync(path.join(uiBuildDir, 'index.html'));

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  const accept = req.headers.accept || '';
  if (!accept.includes('text/html')) return next();
  // If no production build, always redirect to Vite
  // If there IS a build, prefer it (production mode)
  if (hasUIBuild) return next();
  res.redirect(307, `http://localhost:${VITE_DEV_PORT}${req.originalUrl}`);
});

if (hasUIBuild) {
  app.use(express.static(uiBuildDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(uiBuildDir, 'index.html'));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════════════════════

// ── Startup: recover interrupted runs ────────────────────────────────────────
// On server boot, scan all runs for "running" status left over from a crash
// or forced shutdown. Reset these to "interrupted" so the UI shows an accurate
// state instead of a perpetually-running phantom job.
function recoverInterruptedRuns() {
  let recovered = 0;
  for (const runDir of listRunDirs()) {
    try {
      const m = manifest.getOrCreate(runDir);
      let changed = false;

      // Mark any "running" steps as "interrupted"
      for (const step of m.steps) {
        if (step.status === 'running') {
          step.status = 'interrupted';
          changed = true;
        }
      }

      // Update overall status if needed
      if (m.status === 'running') {
        const hasInterrupted = m.steps.some(s => s.status === 'interrupted');
        const hasError = m.steps.some(s => s.status === 'error');
        m.status = hasError ? 'error' : hasInterrupted ? 'interrupted' : 'partial';
        changed = true;
      }

      if (changed) {
        manifest.save(m, runDir);
        recovered++;
      }
    } catch { /* skip bad manifests */ }
  }
  return recovered;
}

const interruptedCount = recoverInterruptedRuns();

app.listen(PORT, () => {
  console.log(`\n  Pipeline Management API`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → ${listRunDirs().length} runs found`);
  if (interruptedCount > 0) console.log(`  → ${interruptedCount} interrupted run(s) recovered`);
  console.log(`  → Endpoints: GET /api/runs, GET /api/transforms, GET /api/schema`);
  console.log(`  → API Docs: http://localhost:${PORT}/api/docs\n`);
});
