# Deployment Strategy — Versable Pipeline Manager

## Architecture Constraints

- **File-system persistence** — No database; runs, configs, and manifests are all on disk
- **Express + SvelteKit** — Single server process serves both API and static UI
- **LLM API calls** — Some transforms call Claude API (requires `ANTHROPIC_API_KEY`)
- **Long-running jobs** — Pipeline execution can take minutes (especially download-posters)
- **SSE streams** — Real-time event streaming requires persistent HTTP connections

## Deployment Options

### Option 1: Render Web Service (Recommended)

Best for: always-on server with persistent disk.

| Feature | Support |
|---------|---------|
| Persistent disk | Yes (Render Disk) |
| Long-running processes | Yes |
| SSE/WebSocket | Yes |
| Environment variables | Yes |
| Auto-deploy from GitHub | Yes |
| Free tier | Yes (spins down after inactivity) |

**Setup:**
1. Push to GitHub (see Pre-deployment Checklist below)
2. Create a Render Web Service pointing to the repo
3. Build command: `cd ui && npm install && npm run build && cd .. && npm install`
4. Start command: `node server.js`
5. Add environment variables: `ANTHROPIC_API_KEY`, `PORT=3460`
6. Attach a Render Disk mounted at `/opt/render/project/src/runs`
7. Set `RUNS_DIR` env var to the disk mount path

**Production server.js changes needed:**
```javascript
// Serve static SvelteKit build
app.use(express.static(path.join(__dirname, 'ui/build')));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'ui/build/index.html'));
  }
});
```

### Option 2: VPS / Docker (Full Control)

Best for: self-hosted, maximum flexibility.

```dockerfile
FROM node:23-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY ui/package*.json ui/
RUN cd ui && npm ci
COPY . .
RUN cd ui && npm run build
EXPOSE 3460
VOLUME /app/runs
CMD ["node", "server.js"]
```

**Docker Compose:**
```yaml
services:
  pipeline:
    build: .
    ports:
      - "3460:3460"
    volumes:
      - ./runs:/app/runs
      - ./transforms:/app/transforms
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

### Option 3: Local Network (Current)

Best for: development and personal use.

```bash
./start-dev.sh   # Express :3460 + Vite :5173
```

Access from other devices on the same network via `http://<machine-ip>:5173`.

## Pre-deployment Checklist

- [ ] Create `.gitignore` covering:
  - `runs/` (data — large, user-specific)
  - `node_modules/`
  - `.env`
  - `_deploy/`
  - `ui/build/` and `ui/.svelte-kit/`
  - `parse-excel/output/`
  - `.download-failures.json`
- [ ] Create `.env.example` with required variables
- [ ] Update `server.js` to serve static SvelteKit build in production
- [ ] Add `RUNS_DIR` env var support (currently hardcoded to `./runs`)
- [ ] Verify `transforms/` are included in deployment (they're the pipeline logic)
- [ ] Test production build: `cd ui && npm run build` then `NODE_ENV=production node server.js`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3460` | Express server port |
| `ANTHROPIC_API_KEY` | For LLM transforms | — | Claude API key |
| `RUNS_DIR` | No | `./runs` | Pipeline data directory |
| `NODE_ENV` | No | `development` | Set to `production` for deployment |

## Data Migration

Runs are portable — to migrate:
1. Copy the entire `runs/` directory
2. Copy `transforms/` if custom transforms exist
3. Set environment variables on the new host
4. Start the server

No database migration needed.

## Monitoring

- **Health check:** `GET /api/schema` (returns server version)
- **Job status:** `GET /api/jobs` (lists active/queued jobs)
- **Build verification:** Check `APP.buildTag` in the sidebar footer
