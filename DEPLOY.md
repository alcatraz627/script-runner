# Preview Dashboard — Vercel Deployment

## Quick Deploy

```bash
./deploy-preview.sh
```

Auto-detects the data file from a running preview server on `:3457` or `:3458`.

## Explicit Deploy

```bash
./deploy-preview.sh runs/jegs-mar-17/data/final.json
./deploy-preview.sh runs/jegs-mar-17/data/final.json --prod
```

## Flags

| Flag | Description |
|------|-------------|
| `--prod` | Deploy to production URL (default is preview) |
| `--no-deploy` | Build `_deploy/` folder only, skip Vercel deploy |
| `--title "..."` | Override page title and heading |

## How It Works

1. `deploy-preview.sh` detects the data file (or takes it as an arg)
2. Calls `pipeline/deploy-preview.js` which:
   - Reads the source JSON and runs `autoMap` to normalize fields
   - Copies `preview-dashboard/index.html` + baked `data.json` into `_deploy/`
   - Runs `npx vercel` to deploy the static folder
3. Vercel config lives in `_deploy/.vercel/` and is preserved across builds

## Selections Feature

- **Local:** Selections persist to `preview-dashboard/selections.json` via the server API
- **Deployed:** API calls are skipped; selections fall back to browser `localStorage`
- No setup needed — the frontend detects the environment automatically

## Prerequisites

- `npx vercel` must be available (install globally or use npx)
- First deploy will prompt for Vercel project setup; subsequent deploys reuse `_deploy/.vercel/`
