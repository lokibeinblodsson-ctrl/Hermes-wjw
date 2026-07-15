# wjw-kanban-cloud (backend)

The **server** for the Wild Jazmine Wellness planner: team auth (JWT),
server-side board store, WebSocket live-sync, and a Hermes chat proxy.

This repo is deployed to **SnapDeploy** (free, no card) as a Node container.
The chat proxy points at a **full Hermes agent** (tools + memory) running
on the owner's always-on PC, exposed via a Cloudflare tunnel.

## Deploy (SnapDeploy, free, no card)

1. SnapDeploy → Connect GitHub → pick this repo (auto-deploy on push).
2. Or: SnapDeploy → Upload → zip this folder.
3. Set the container **port to 4000**.
4. Add environment variables (see `.env.example`):
   - `HERMES_URL`  → `https://hermes-api.wildjazminewellness.ca` (owner's PC Hermes via tunnel)
   - `HERMES_MODEL` → `Hermes-Agent` (the owner's Hermes model id)
   - `JWT_SECRET` → any long random string
   - `PORT` → `4000`
5. Deploy. SnapDeploy gives a public URL, e.g. `https://node-express-app-xxxx.snapdeploy.app`.

## Point the app + tunnel at it

- Cloudflare tunnel `hermes.wildjazminewellness.ca` → SnapDeploy backend URL.
- The React app (wjw-kanban repo) calls `/api/*` which proxies to this backend.

## Local dev

```
cd server
npm install
HERMES_URL=http://127.0.0.1:8642 PORT=4000 npm start
```

## Env reference

| Var | Default | Purpose |
|-----|---------|---------|
| PORT | 4000 | backend listen port |
| HERMES_URL | http://127.0.0.1:8642 | Hermes OpenAI-compatible API base |
| HERMES_KEY | wjw-local-dev-key | Hermes API key (owner's) |
| HERMES_MODEL | Hermes-Agent | model id sent to Hermes |
| JWT_SECRET | changeme | signs auth tokens |
| SYSTEM_PROMPT | (built-in) | system prompt for chat |
