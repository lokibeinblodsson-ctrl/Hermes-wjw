# Hermes-wjw (Wild Jazmine Wellness Planner)

The complete site served at **https://hermes.wildjazminewellness.ca/**:
a team content-planning board with **in-app Hermes chat**, **team login**,
and **live sync**. Frontend (React + Vite) + backend (Node/Express + WebSocket).

## Architecture
```
browser ── hermes.wildjazminewellness.ca (Cloudflare tunnel)
              └─ backend  (auth, board store, WebSocket live-sync, Hermes chat proxy)
                    └─ Hermes agent (full, with tools) via HERMES_URL
```
- **Frontend**: `src/` (React + TypeScript + Vite). `npm run build` → `dist/`.
- **Backend**: `server/` (Express + ws). Serves `dist/` in production, plus
  `/api/*` (auth, board), `/ws` (live sync), `/api/hermes/chat` (Hermes proxy).
- **Hermes**: the owner's full Hermes agent (tools + memory), reached via
  `HERMES_URL` (on the owner's PC, exposed through a Cloudflare tunnel).

## Deploy (SnapDeploy — free, no card)
1. SnapDeploy → Connect GitHub → pick this repo (auto-deploy on push),
   OR Upload the `server/` folder.
2. Set the container **port to 4000**.
3. Build/run command: `cd server && npm install && node index.js`
   (or use the included `Dockerfile`).
4. Add environment variables (see `server/.env.example`):
   - `HERMES_URL`  → `https://hermes-api.wildjazminewellness.ca` (owner's Hermes via tunnel)
   - `HERMES_MODEL` → `Hermes-Agent`
   - `JWT_SECRET` → a long random string
   - `PORT` → `4000`
5. SnapDeploy gives a public URL. Point the Cloudflare tunnel
   `hermes.wildjazminewellness.ca` at it.

## Local development
```
# terminal 1 — backend
cd server && npm install && PORT=4000 HERMES_URL=http://127.0.0.1:8642 npm start
# terminal 2 — frontend (Vite dev, proxies /api and /ws to :4000)
npm install && npm run dev
# open http://localhost:5173
```

## Env reference (backend)
| Var | Default | Purpose |
|-----|---------|---------|
| PORT | 4000 | backend listen port |
| HERMES_URL | http://127.0.0.1:8642 | Hermes OpenAI-compatible API base |
| HERMES_KEY | wjw-local-dev-key | Hermes API key (owner's) |
| HERMES_MODEL | Hermes-Agent | model id sent to Hermes |
| JWT_SECRET | changeme | signs auth tokens |

## Files
- `src/` — React frontend (board, card workspace, chat panel, login, docs, backup)
- `server/` — Node backend (auth, board store, WebSocket sync, Hermes proxy)
- `vite.config.ts` — dev proxy for `/api` and `/ws` → backend
