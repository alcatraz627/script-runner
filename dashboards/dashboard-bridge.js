/**
 * dashboard-bridge.js — Shared JS client for pipeline-connected dashboards
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OVERVIEW
 * ─────────────────────────────────────────────────────────────────────────────
 * Every dashboard plugin includes this script. It provides a unified interface
 * for:
 *
 *   1. Loading item data from the pipeline step that preceded this manual gate
 *   2. Persisting user selections back to the run's data directory (auto-saved)
 *   3. Signalling pipeline approval so execution continues after this step
 *   4. Broadcasting status changes to the UI (saving, saved, error, done)
 *
 * The bridge reads its context from URL query parameters that the Script Runner
 * injects when it opens the dashboard:
 *
 *   runId      — the run this dashboard is connected to (e.g. "jegs-ebay-final")
 *   stepId     — the manual step currently awaiting approval
 *   dataStep   — the step whose output to load as the item list (defaults to
 *                the step immediately before stepId in the pipeline)
 *   dashboardId — the plugin folder name (e.g. "image-review")
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUICK START (copy into a new dashboard's index.html)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const bridge = new DashboardBridge();
 *   await bridge.init();             // load data + prior selections
 *
 *   bridge.onStatus(({ status, message }) => { ... update status bar ... });
 *
 *   // When user makes a choice:
 *   bridge.select('555-12345', { mainImage: 'https://...' });
 *
 *   // When user clicks Done:
 *   await bridge.signalDone();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * API
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   new DashboardBridge(config?)
 *     config.apiBase     string   API root (default: 'http://localhost:3460')
 *     config.autoSave    number   ms between auto-saves, 0 to disable (default: 800)
 *     config.keyField    string   field to use as item key (default: 'Part Number')
 *
 *   bridge.init() → Promise<{ items, selections }>
 *     Loads items and any previously saved selections. Call once on page load.
 *
 *   bridge.items → Array
 *     The loaded item array. Available after init().
 *
 *   bridge.selections → Object
 *     The current in-memory selections map { [key]: value }. Live reference.
 *
 *   bridge.select(key, value)
 *     Record a selection and schedule an auto-save. Pass null to clear.
 *
 *   bridge.getSelection(key) → value | undefined
 *   bridge.hasSelection(key) → boolean
 *
 *   bridge.saveNow() → Promise<void>
 *     Flush pending selections to the server immediately.
 *
 *   bridge.signalDone() → Promise<void>
 *     Save selections then approve the pipeline step. After this call, the
 *     pipeline engine resumes execution of the next step.
 *
 *   bridge.onStatus(callback)
 *     Subscribe to status changes. Callback receives:
 *       { status: 'idle'|'saving'|'saved'|'error'|'done', message: string }
 *
 *   bridge.context → { runId, stepId, dataStep, dashboardId }
 *     The URL params. Useful for building API URLs or debugging.
 *
 *   bridge.isStandalone → boolean
 *     true when opened without a runId (not connected to a pipeline step).
 *     signalDone() is a no-op in standalone mode.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

class DashboardBridge {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiBase='http://localhost:3460']
   * @param {number} [config.autoSave=800]   ms debounce for auto-save (0 = off)
   * @param {string} [config.keyField='Part Number']  field used as item key
   */
  constructor(config = {}) {
    const params = new URLSearchParams(window.location.search);

    // ── Pipeline context (injected by Script Runner when opened from a manual step)
    this.context = {
      runId:       params.get('runId')       || config.runId       || null,
      stepId:      params.get('stepId')      || config.stepId      || null,
      dataStep:    params.get('dataStep')    || config.dataStep    || null,
      dashboardId: params.get('dashboardId') || config.dashboardId || null,
    };

    this.apiBase    = (config.apiBase || 'http://localhost:3460').replace(/\/$/, '');
    this.autoSave   = config.autoSave  ?? 800;
    this.keyField   = config.keyField  || 'Part Number';

    this.items      = [];
    this.selections = {};

    this._saveTimer      = null;
    this._statusCallbacks = [];
    this._status         = 'idle';
  }

  // ── Public: setup ─────────────────────────────────────────────────────────

  /**
   * Load items and prior selections. Must be called before using the bridge.
   * @returns {Promise<{ items: Array, selections: Object }>}
   */
  async init() {
    this._setStatus('idle', 'Loading…');
    try {
      const [items, selections] = await Promise.all([
        this._loadItems(),
        this._loadSelections(),
      ]);
      this.items      = items;
      this.selections = selections;
      this._setStatus('idle', `${items.length} items loaded`);
      return { items, selections };
    } catch (err) {
      this._setStatus('error', `Load failed: ${err.message}`);
      throw err;
    }
  }

  // ── Public: selections ────────────────────────────────────────────────────

  /**
   * Record a selection for an item. Schedules an auto-save.
   * @param {string} key      item key (value of keyField)
   * @param {*}      value    selection payload; null removes the entry
   */
  select(key, value) {
    if (value === null || value === undefined) {
      delete this.selections[key];
    } else {
      this.selections[key] = value;
    }
    if (this.autoSave > 0) this._scheduleSave();
  }

  getSelection(key)  { return this.selections[key]; }
  hasSelection(key)  { return key in this.selections; }

  /** Force-flush pending saves immediately. */
  async saveNow() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    await this._persist();
  }

  // ── Public: approval ──────────────────────────────────────────────────────

  /**
   * Save selections then approve the pipeline step so execution resumes.
   * No-op (resolves immediately) in standalone mode.
   */
  async signalDone() {
    await this.saveNow();

    if (this.isStandalone) {
      this._setStatus('done', 'Done (standalone mode — not connected to pipeline)');
      return;
    }

    this._setStatus('saving', 'Approving step…');
    try {
      const res = await fetch(`${this.apiBase}/api/runs/${this.context.runId}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stepId: this.context.stepId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      this._setStatus('done', 'Pipeline approved — you may close this tab');
    } catch (err) {
      this._setStatus('error', `Approval failed: ${err.message}`);
      throw err;
    }
  }

  // ── Public: status ────────────────────────────────────────────────────────

  /** @param {function({ status: string, message: string }): void} callback */
  onStatus(callback) {
    this._statusCallbacks.push(callback);
    // Immediately call with current status so late subscribers get initial state
    callback({ status: this._status, message: this._lastMessage || '' });
    return () => {
      this._statusCallbacks = this._statusCallbacks.filter(cb => cb !== callback);
    };
  }

  get isStandalone() { return !this.context.runId; }

  // ── Private ───────────────────────────────────────────────────────────────

  _setStatus(status, message = '') {
    this._status      = status;
    this._lastMessage = message;
    for (const cb of this._statusCallbacks) {
      try { cb({ status, message }); } catch { /* ignore */ }
    }
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._persist(), this.autoSave);
  }

  async _persist() {
    if (this.isStandalone) return; // nowhere to save

    this._setStatus('saving', 'Saving…');
    try {
      const { runId, dashboardId } = this.context;
      const res = await fetch(
        `${this.apiBase}/api/runs/${runId}/dashboard-selections/${dashboardId}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(this.selections),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._setStatus('saved', `Saved ${Object.keys(this.selections).length} selections`);
      setTimeout(() => {
        if (this._status === 'saved') this._setStatus('idle', 'All changes saved');
      }, 2000);
    } catch (err) {
      this._setStatus('error', `Save failed: ${err.message}`);
    }
  }

  async _loadItems() {
    const { runId, dataStep } = this.context;
    if (!runId || !dataStep) return [];

    const res = await fetch(`${this.apiBase}/api/runs/${runId}/data/${dataStep}`);
    if (!res.ok) throw new Error(`Failed to load items: HTTP ${res.status}`);
    return res.json();
  }

  async _loadSelections() {
    const { runId, dashboardId } = this.context;
    if (!runId || !dashboardId) return {};

    const res = await fetch(
      `${this.apiBase}/api/runs/${runId}/dashboard-selections/${dashboardId}`
    );
    if (!res.ok) return {};
    return res.json();
  }
}

// UMD-compatible export — works as a plain <script> tag or CommonJS require
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DashboardBridge;
}
