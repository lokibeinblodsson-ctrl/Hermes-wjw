# Wild Jazmine Wellness — Internal Platform

Internal operations workspace for Wild Jazmine Wellness (Celina's practice):
a calm, keyboard-first tool for content planning, the publishing pipeline,
files, chat, docs, and admin — running as a Cloudflare Worker + D1 SPA.

## Links

- **Web app:** https://app.wildjazminewellness.ca
- **Repository:** https://github.com/lokibeinblodsson-ctrl/Hermes-wjw
- **API health:** https://app.wildjazminewellness.ca/api/health

## What's inside

- **Board (kanban)** — cards as operational records. Click a card to open its
  full **card hub**: summary header + tabs for Overview, Activity, Comments
  (threaded), Sources (APA citations), Related (cards + posts), Draft, Media,
  Resources, Checklist, Details, Notes (Hermes instructions), and Research.
- **Global command palette** — press **Cmd/Ctrl + K** from anywhere to fuzzy-search
  cards, pages, files, chats, docs, and jump to admin/calendar/publishing/activity;
  trigger quick actions (create card, open board/docs/calendar/files/Hermes, etc.).
- **Publishing pipeline** — draft → submit → review (approve/reject) → publish,
  with image generation and stored assets.
- **Files** — upload/link media and documents with tags.
- **Chat** — channel-based team chat + a Hermes AI sidebar for instructions.
- **Docs** — internal documentation.
- **Calendar / scheduling** — content scheduling views.
- **Activity center** — `/activity` feed of recent audit events.
- **Admin** — users, categories, backups, and system settings.

## Tech stack

- **Frontend:** React + TypeScript (Vite), React Router, calm custom CSS.
- **Backend:** Hono on Cloudflare Workers, D1 (SQLite) via `workerd`.
- **Auth:** JWT (PBKDF2 password hashing), role-based access (member / reviewer /
  moderator / admin).
- **Tests:** Vitest + Miniflare (in-memory D1), with a schema-sync guard that
  keeps the migration files and the test schema mirror in lockstep.

## Local development

```bash
npm install
npm run dev            # build SPA + start wrangler dev (applies migrations, seeds admin)
npm run typecheck     # tsc --noEmit
npm run build         # build the SPA into ./public
npm test              # vitest integration suite (board, auth, publishing, card hub, ...)
npm run check:schema  # verify migrations <-> inline test schema are in sync
```

The dev suite relies on committed dev placeholders in `wrangler.toml`
(`JWT_SECRET`, `BOOTSTRAP_TOKEN`, `ADMIN_EMAIL`, `ENVIRONMENT=development`).
A seeded admin is auto-provisioned on first run.

## Deployment

See [DEPLOY.md](./DEPLOY.md) for the full Cloudflare Workers + D1 deployment
steps (build, apply migrations, set production secrets, `wrangler deploy`).
The Worker serves `app.wildjazminewellness.ca` as a Cloudflare custom domain.

## Project layout

```
src/
  index.ts            # Worker entry: mounts /api/v1/* routes + static SPA
  routes/             # board, cardhub, auth, chat, docs, files, publishing, calendar, admin, hermes
  db/                 # D1 access, audit logging, migrations runner
  lib/                # crypto, jwt, auth, validation, errors, env
migrations/           # SQL migrations (0001_init .. 0004_card_hub)
app/                  # React SPA (pages, components, lib/api, styles.css)
tests/                # vitest integration suite + schema mirror (kept in sync with migrations)
```

## Notes

- Calm UI: no bright blue/green. Uses moss/slate/stone palette tokens in
  `app/styles.css`.
- Card-scoped activity reuses the shared `audit_logs` table (no separate table).
- Binary media upload is planned; today media/files are referenced by hosted URL.
