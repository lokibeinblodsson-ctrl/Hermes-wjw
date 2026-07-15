# ---- SnapDeploy free container: wjw-kanban backend ----
# Runs ONLY the Node backend (auth + board + WebSocket live-sync +
# Hermes chat proxy). The chat brain is OpenRouter's FREE catalog
# (no card), set via HERMES_URL + HERMES_MODEL + HERMES_KEY.
# The full Hermes agent stays on the user's PC (optional) — the in-app
# chat works without it via OpenRouter free.

FROM node:22-slim

WORKDIR /app

# backend source
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js store.js ./
COPY data ./data

# backend listens on 4000 (SnapDeploy port mapping)
EXPOSE 4000

# ---- Config (override via SnapDeploy env panel) ----
# HERMES_URL    = https://openrouter.ai/api/v1   (OpenAI-compatible)
# HERMES_KEY    = sk-or-... (your OpenRouter FREE key)
# HERMES_MODEL  = a free model id, e.g. meta-llama/llama-3.1-8b-instruct:free
# JWT_SECRET    = any long random string
# PORT          = 4000
ENV PORT=4000 \
    HERMES_URL=https://openrouter.ai/api/v1 \
    HERMES_MODEL=meta-llama/llama-3.1-8b-instruct:free

CMD ["node", "index.js"]
