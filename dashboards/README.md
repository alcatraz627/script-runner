# Dashboard Plugins

Manual review dashboards for the Script Runner pipeline. A dashboard is a browser-based UI that pauses pipeline execution while a human reviews, selects, or annotates data — then signals approval to resume.

---

## How it works

```
Pipeline step N completes → writes data/N.json
         ↓
type: "manual" step   →  engine suspends, emits step-awaiting event
         ↓
Script Runner UI shows "Awaiting Approval" + "Open Dashboard" button
         ↓
User opens dashboard  →  reviews items, makes selections, clicks Done
         ↓
DashboardBridge.signalDone()  →  POST /api/runs/:id/approve
         ↓
Engine resumes  →  next step runs with N.json as input
                   (manual step is a transparent pass-through)
```

---

## Creating a new dashboard

1. **Copy the template:**
   ```bash
   cp -r dashboards/_template dashboards/your-dashboard-name
   ```

2. **Edit `manifest.json`:**
   ```json
   {
     "name": "Image Review",
     "description": "Select the main product image for each item",
     "keyField": "Part Number"
   }
   ```

3. **Implement the three functions in `index.html`:**

   | Function | What to implement |
   |---|---|
   | `getItemSummary(item)` | One-line label for each list row |
   | `renderDetail(item)` | Full right-panel HTML for a selected item |
   | (optional) `onSearch(query)` | Custom search logic if the default isn't enough |

4. **Add to `run.config.js`:**
   ```js
   {
     "id": "image-review",
     "name": "Image Review",
     "type": "manual",
     "dashboardId": "your-dashboard-name"
   }
   ```

5. **Done.** The Script Runner will automatically list your dashboard in the Dashboards page and wire up the pipeline approval.

---

## URL parameters

When opened from a manual step, the Script Runner injects:

| Param | Description |
|---|---|
| `runId` | The run this is connected to (`jegs-ebay-final`) |
| `stepId` | The manual step awaiting approval (`image-review`) |
| `dataStep` | The previous step whose output to load as items |
| `dashboardId` | The plugin folder name |

You can also open a dashboard directly (standalone mode) by navigating to:
```
http://localhost:3460/dashboards/your-dashboard-name/?runId=...&stepId=...&dataStep=...&dashboardId=...
```

---

## DashboardBridge API

See [`dashboard-bridge.js`](./dashboard-bridge.js) for the full documented API. Quick reference:

```js
const bridge = new DashboardBridge({ keyField: 'Part Number' });
await bridge.init();                    // load items + prior selections

bridge.onStatus(({ status, message }) => { /* update status bar */ });

bridge.select('555-12345', { choice: 'A' }); // record selection (auto-saved)
bridge.getSelection('555-12345');             // read back
bridge.hasSelection('555-12345');             // boolean

await bridge.saveNow();                 // flush saves immediately
await bridge.signalDone();              // save + approve pipeline step
```

---

## Directory structure

```
dashboards/
  dashboard-bridge.js       Shared JS library — included by all dashboards
  README.md                 This file
  _template/
    index.html              Copy-and-customize starting point
    manifest.json           Dashboard metadata
    README.md               Agent usage guide

  image-review/             Example: image selection dashboard
    index.html
    manifest.json

  attribute-review/         Example: attribute review dashboard
    index.html
    manifest.json
```

---

## Selections storage

Selections are saved per-run to:
```
runs/<runId>/data/_selections-<dashboardId>.json
```

This keeps all run data together and survives server restarts. The file is a flat JSON object: `{ [itemKey]: selectionValue }`.

---

## Existing one-off dashboards

These older dashboards predate the plugin system and run on their own servers. They are **not** registered as plugins and do not integrate with the pipeline approval flow. They are kept as-is for reference.

| Dashboard | Port | Description |
|---|---|---|
| `image-selector/` | 3458 | Multi-image selection with carousel |
| `preview-dashboard/` | 3457 | Product listing viewer |
| `attribute-review.html` | — | Standalone HTML attribute editor |

Future: consider wrapping these as proper plugins using this template.
