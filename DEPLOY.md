# Deployment — app.wildjazminewellness.ca

This document describes how the Wild Jazmine Wellness app is deployed to the
subdomain **app.wildjazminewellness.ca** on Cloudflare Workers + D1.

## Status of the subdomain config

The Worker is **already configured** to serve the subdomain. In `wrangler.toml`:

```toml
[[routes]]
pattern = "app.wildjazminewellness.ca"
custom_domain = true
```

On `wrangler deploy`, Cloudflare provisions the DNS CNAME + Universal SSL for
this hostname automatically and routes traffic to this Worker. **No manual CNAME
is required** for a `custom_domain` route — that is the whole point of the
`custom_domain = true` flag (it triggers Cloudflare-managed cert + DNS).

What code/config cannot do for you (must be done in the Cloudflare dashboard or
via `wrangler` once you own the zone):

- **Zone ownership / DNS for `wildjazminewellness.ca`** — the domain must be a
  Cloudflare zone you control (or delegated to Cloudflare). If the zone is not
  yet on Cloudflare, the `custom_domain` route will fail to attach at deploy
  time with a "domain not found / not in this account" error. This is expected
  and is a manual step.
- **Production secrets** — never commit real secrets. Set these with
  `wrangler secret put` (they must use a *different* name than the `[vars]`
  dev placeholders, because secrets and vars cannot share a name):
  - `JWT_SECRET` (rotate away from the dev placeholder)
  - `BOOTSTRAP_TOKEN` (rotate; bootstrap is disabled in production anyway)
  - `ADMIN_EMAIL` (already in `[vars]` for dev; set as secret for prod if you
    want it out of the file)
  - `MAILCHANNELS_TOKEN` (email sending)
  - `B2_KEY_ID` / `B2_APP_KEY` / `B2_BUCKET_NAME` / `B2_PUBLIC_URL` (file
    storage) **or** bind an `R2` bucket
  - `ENVIRONMENT=production` — set via `wrangler secret put ENVIRONMENT`
    (the `[vars]` block sets `development` for local/dev). Production also
    disables the `/bootstrap/provision` endpoint (defense in depth).

## Local vs production separation (already in place)

`wrangler.toml` `[vars]` block holds **dev-only placeholders**:

```
JWT_SECRET = "local-dev-only-secret-replace-in-prod"
BOOTSTRAP_TOKEN = "local-dev-only-bootstrap-replace-in-prod"
ADMIN_EMAIL = "loki.bein.blodsson@gmail.com"
ENVIRONMENT = "development"
```

These are what `wrangler dev` and the test suite rely on. For production,
override the sensitive ones with `wrangler secret put` (secrets win over vars
of a different name). Do **not** edit the committed placeholders with real
values — they are intentionally non-secret dev stand-ins.

## Deploy steps

1. Build the SPA:
   ```
   npm run build:app
   ```
   (outputs to `./public`).

2. Apply migrations to the target D1 database. **This is mandatory and easy to
   forget — `wrangler deploy` pushes worker code but does NOT run D1 migrations
   on the remote database.** Run it on every deploy that touches the schema, and
   again after any new migration file:
   ```
   wrangler d1 migrations apply wild-jazmine-wellness --remote
   ```
   Local/dev migrations are applied automatically by the test harness / dev
   server via `migrations_dir`.

3. Set production secrets (only the sensitive ones; see above).

4. Deploy:
   ```
   npm run deploy
   ```
   This runs `build:app` then `wrangler deploy`. On success, Cloudflare
   attaches `app.wildjazminewellness.ca` as a custom domain (assuming the zone
   is in your account).

5. Verify:
   ```
   curl https://app.wildjazminewellness.ca/api/health
   ```
   Expect `{"ok":true,"service":"wild-jazmine-wellness",...}`.

## Recovery: migrations applied but `apply` reports "duplicate column" / SQLITE_ERROR

Symptom: `wrangler d1 migrations apply --remote` fails partway with
`duplicate column name: <col>` or `no such column` at runtime (500s on
features that hit a "missing" table/column). Cause: the remote `d1_migrations`
tracker is **out of sync** with the actual schema — e.g. columns were added
manually or a prior `apply` crashed mid-file, so the tracker thinks a migration
was never applied while the schema actually has it.

Real-world example (2026-07-17): the remote D1 only recorded `0001_init.sql`
in `d1_migrations`, but `cards` already had all of migration 0002's columns.
`apply` re-ran 0002 and choked on the existing `draft` column. Meanwhile
migrations 0003/0004 had never run, so `cards.scheduled_date` and the
`hermes_conversations` / `hermes_messages` / `calendar_items` / `files` /
`card_comments` / `card_sources` / `card_links` tables were missing — producing
500s on create-card and the Hermes sidebar. Fix:

1. Inspect actual state (do NOT blindly re-run migrations):
   ```sql
   SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
   PRAGMA table_info(cards);                 -- list columns
   SELECT name FROM d1_migrations ORDER BY id;  -- what the tracker believes
   ```
2. For any migration whose schema changes are **already present** but not
   recorded, insert the tracker row so `apply` skips it:
   ```sql
   INSERT INTO d1_migrations (id, name, applied_at)
   SELECT 2, '0002_card_extend.sql', datetime('now')
   WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0002_card_extend.sql');
   ```
3. Re-run `wrangler d1 migrations apply wild-jazmine-wellness --remote`. The
   remaining migrations (e.g. 0003, 0004) run cleanly — their `CREATE TABLE IF
   NOT EXISTS` and guarded `ADD COLUMN` statements are idempotent. Only a bare
   `ALTER TABLE ... ADD COLUMN` errors on an existing column, which is why step 2
   is needed first.
4. Re-verify the missing tables/columns now exist and the tracker shows
   0001–0004.

Rule of thumb: `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`-style
guards are safe to re-run; bare `ALTER TABLE ... ADD COLUMN` is not. Reconcile
the tracker, don't mutate an already-correct schema.

## DNS notes (only if you manage the zone manually)

- With `custom_domain = true` you normally do **nothing** — Cloudflare manages
  it. If you ever prefer a manual CNAME instead, point
  `app.wildjazminewellness.ca` CNAME → `<your-subdomain>.workers.dev` and ensure
  the Worker route covers the hostname; but the simpler, supported path is the
  `custom_domain` route used here.
- Universal SSL is automatic for `custom_domain` routes.

## Flagged limitation

This repo can prepare and *attempt* to attach the subdomain, but it cannot
create the Cloudflare zone or verify domain ownership — that requires the
`wildjazminewellness.ca` domain to be in the Cloudflare account tied to
`account_id` in `wrangler.toml` (currently `274c13cfc3476cfe884ae08648d73cb4`).
If that zone is not present, `wrangler deploy` will report the custom domain
could not be attached and you must add the zone first (dashboard → Add site →
`update nameservers at the registrar`).
