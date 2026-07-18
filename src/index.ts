// Wild Jazmine Wellness — main Worker entry.
// Serves: /api/v1/* REST endpoints + static SPA assets (fallback).
import { Hono } from "hono";
import type { ScheduledEvent, ExecutionContext } from "@cloudflare/workers-types";
import { Env, IS_PRODUCTION } from "./lib/env";
import { runDailyBackup } from "./lib/backup";
import { runModelWatchdog } from "./lib/modelWatchdog";
import { json, jsonError, Errors, HttpError } from "./lib/errors";
import { setJwtSecret } from "./lib/jwt";
import { verifyJwt } from "./lib/jwt";
import { getBearer, getSessionUser } from "./lib/auth";
import { rateLimit, RATE_LIMITS, clientIp } from "./lib/rateLimit";
import { seedAdminIfNeeded } from "./bootstrap";
import { logAudit } from "./db/logging";

import authRoutes from "./routes/auth";
import boardRoutes from "./routes/board";
import chatRoutes from "./routes/chat";
import adminRoutes from "./routes/admin";
import apiRoutes from "./routes/api";
import publishingRoutes from "./routes/publishing";
import dataRoutes from "./routes/data";
import docsRoutes from "./routes/docs";
import hermesRoutes from "./routes/hermes";
import calendarRoutes from "./routes/calendar";
import filesRoutes from "./routes/files";
import cardhubRoutes from "./routes/cardhub";

// Shared app context type carrying env + request-derived session.
type Ctx = {
  Bindings: Env;
  Variables: {
    session: Awaited<ReturnType<typeof getSessionUser>>;
    ip: string;
  };
};

const app = new Hono<Ctx>();

// Global error handler: catches unhandled throws (incl. thrown HttpError from
// middleware guards like requireRole) and returns a structured JSON body
// instead of Hono's default 500 with no body.
// ── Security headers (defense-in-depth) ──────────────────────────────────
// Applied to EVERY response (HTML, API JSON, static assets) as well as error
// responses. The SPA only ever talks to its own /api/v1 origin and loads NO
// inline scripts (Vite bundles all app code to external /assets/*.js, covered
// by 'self'). So script-src 'self' is both safe and sufficient.
//
// NOTE: Cloudflare's zone-injected scripts (Bot Fight Mode's inline "challenge"
// loader + Web Analytics beacon at static.cloudflareinsights.com) are NOT
// allowed. They are third-party, their inline content varies per request (so
// it cannot be safely hash-pinned), and the app does not depend on them — this
// is an intentional security boundary, not an oversight. If Bot Fight Mode or
// Web Analytics are wanted, disable them at the Cloudflare zone instead of
// weakening this policy with 'unsafe-inline'.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React inline style attributes + vendored CSS
    "img-src 'self' data: https:", // card media may reference external https URLs
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  // HSTS is added below but ONLY in production — it must never be sent over
  // plain HTTP (browsers ignore it there anyway, but emitting it only on TLS
  // keeps the intent explicit and avoids any preload-list confusion).
};

// NOTE: response headers are *immutable* in the Workers runtime / Miniflare,
// so we must use Hono's `c.header()` setter (which writes to the outgoing
// response) rather than mutating `c.res.headers` directly.
function applySecurityHeaders(c: { header: (k: string, v: string) => void; env: Env }): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
  if (IS_PRODUCTION(c.env)) {
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
}

app.onError((err, c) => {
  console.error("[unhandled]", err);
  let res: Response;
  if (err instanceof HttpError) {
    res = c.json(
      { success: false, error: { code: err.code, message: err.message, details: err.details } },
      err.status as Parameters<typeof c.json>[1],
    );
  } else {
    res = c.json({ success: false, error: { code: "internal_error", message: "Internal server error" } }, 500);
  }
  applySecurityHeaders(c);
  return res;
});

// Apply to all successful responses and harden caching of the HTML shell.
app.use("*", async (c, next) => {
  await next();
  applySecurityHeaders(c);
  const ct = c.res.headers.get("content-type") || "";
  // The SPA shell carries no user data, but an auth app's root document must
  // never be served from a shared cache unvalidated. Pin it to private/no-cache
  // so Cloudflare (and any intermediary) revalidates instead of caching it.
  if (ct.includes("text/html")) {
    c.header("Cache-Control", "private, no-cache");
  }
});

// Set JWT secret + seed admin at startup of each isolate (idempotent).
app.use("*", async (c, next) => {
  // JWT secret: derive from a real secret env. Production MUST have a real
  // JWT_SECRET set via `wrangler secret put`. We fail CLOSED in production
  // rather than silently falling back to a known, guessable dev secret — that
  // would let anyone forge tokens if the secret were ever forgotten.
  if (c.env.JWT_SECRET) {
    setJwtSecret(c.env.JWT_SECRET);
  } else if (!IS_PRODUCTION(c.env) && c.env.BOOTSTRAP_TOKEN) {
    // Dev/local only: BOOTSTRAP_TOKEN doubles as the HMAC key base. Never in
    // production — production requires JWT_SECRET.
    setJwtSecret(`wjw-${c.env.BOOTSTRAP_TOKEN}`);
  } else if (IS_PRODUCTION(c.env)) {
    throw new HttpError(500, "internal_error", "JWT_SECRET is not configured");
  } else {
    setJwtSecret("dev-insecure-secret-change-me");
  }
  await next();
});

// Rate limit general API + attach session to context.
app.use("/api/*", async (c, next) => {
  const ip = clientIp(c.req.raw);
  c.set("ip", ip);
  const session = await getSessionUser(c.req.raw, c.env);
  c.set("session", session);
  // Authenticated requests are NEVER throttled by the general limiter — normal
  // app usage (e.g. the admin panel firing several concurrent data loads) must
  // never show a "Slow down" message. Abuse protection lives entirely in the
  // per-route brute-force limiters (login / reset / signup / provision), which
  // are unaffected by this general middleware.
  if (!session) {
    // Unauthenticated traffic: a generous floor. We key by a stable anonymous
    // bucket rather than client IP, because in local/dev `clientIp` resolves to
    // "unknown" for every request, which would otherwise collapse all traffic
    // into one tiny shared bucket and spuriously 429 the SPA.
    const rl = rateLimit("api-anon", RATE_LIMITS.api.limit * 5, RATE_LIMITS.api.window);
    if (!rl.allowed) {
      return jsonError(Errors.tooManyRequests(`Slow down. Retry in ${rl.retryAfter}s`));
    }
  }
  await next();
});

// On first deploy: provision the placeholder admin account if none exists and a
// BOOTSTRAP_TOKEN + ADMIN_EMAIL are provided. The admin password is randomly
// generated at seed time and force-reset on first login — never committed.
app.get("/api/v1/bootstrap/status", async (c) => {
  const existing = await c.env.DB.prepare(`SELECT count(*) as c FROM users`).first();
  const count = (existing as { c: number }).c;
  return json({
    ok: true,
    data: {
      admin_exists: count > 0,
      bootstrap_configured: Boolean(c.env.BOOTSTRAP_TOKEN && c.env.ADMIN_EMAIL),
      production: IS_PRODUCTION(c.env),
    },
  });
});

// Provisioning endpoint: only works once, requires the BOOTSTRAP_TOKEN. It
// creates the admin with a random password and returns the password ONE TIME
// (and flags force_reset). In production this should be hit once then disabled.
app.post("/api/v1/bootstrap/provision", async (c) => {
  if (IS_PRODUCTION(c.env)) {
    return jsonError(Errors.forbidden("Bootstrap disabled in production"));
  }
  // Tight brute-force limit on the provision endpoint regardless of the general
  // API limiter (which is generous for authenticated traffic).
  const ip = clientIp(c.req.raw);
  const rl = rateLimit(`provision:${ip}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.window);
  if (!rl.allowed) {
    return jsonError(Errors.tooManyRequests(`Slow down. Retry in ${rl.retryAfter}s`));
  }
  const provided = c.req.header("x-bootstrap-token");
  if (!c.env.BOOTSTRAP_TOKEN || provided !== c.env.BOOTSTRAP_TOKEN) {
    return jsonError(Errors.forbidden("Invalid bootstrap token"));
  }
  const result = await seedAdminIfNeeded(c.env, c.env.DB);
  if (!result.created && !result.recovered) {
    return json({ ok: true, data: { message: "Admin already exists", admin_email: result.email } });
  }
  if (result.recovered) {
    return json(
      {
        ok: true,
        data: {
          message: "Admin existed but still required first login — issued a fresh temporary password. Set it now; you will be forced to change it.",
          admin_email: result.email,
          temporary_password: result.temporaryPassword,
          force_reset: true,
          recovered: true,
        },
      },
      201
    );
  }
  // Log provisioning as an admin action (actor unknown at this stage).
  await logAudit(c.env.DB, {
    actorId: result.userId,
    action: "admin_provisioned",
    targetType: "user",
    targetId: result.userId,
    ip: c.get("ip") ?? clientIp(c.req.raw),
    meta: { email: result.email, force_reset: true },
  });
  return json(
    {
      ok: true,
      data: {
        message: "Admin provisioned. Set this password now — you will be forced to change it on first login.",
        admin_email: result.email,
        temporary_password: result.temporaryPassword, // shown ONCE
        force_reset: true,
      },
    },
    201
  );
});

// Mount feature routes.
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/board", boardRoutes);
app.route("/api/v1/chat", chatRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/publishing", publishingRoutes);
app.route("/api/v1/data", dataRoutes);
app.route("/api/v1/docs", docsRoutes);
app.route("/api/v1/hermes", hermesRoutes);
app.route("/api/v1/calendar", calendarRoutes);
app.route("/api/v1/files", filesRoutes);
app.route("/api/v1/board", cardhubRoutes);
app.route("/api/v1", apiRoutes);

// Health check.
app.get("/api/health", (c) => json({ ok: true, service: "wild-jazmine-wellness", time: new Date().toISOString() }));

// Static SPA: serve from ASSETS binding, fall back to index.html for client routes.
app.get("*", async (c) => {
  const url = new URL(c.req.url);
  // API 404 for unknown /api routes.
  if (url.pathname.startsWith("/api/")) {
    return jsonError(Errors.notFound(`No route for ${url.pathname}`));
  }
  try {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res && res.status < 400) return res;
  } catch {
    /* fall through */
  }
  // SPA fallback
  try {
    const index = await c.env.ASSETS.fetch(new Request(`${url.origin}/index.html`));
    return index;
  } catch {
    return new Response("Wild Jazmine Wellness — build the SPA with `npm run build:app`.", {
      headers: { "content-type": "text/plain" },
    });
  }
});

// Cron handler: daily business-continuity backup to B2. Wired via
// `[[triggers.crons]]` in wrangler.toml. No-ops gracefully when B2 is not
// configured or outside production (see runDailyBackup).
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyBackup(env));
    // Refresh the free-model map so Hermes always uses currently-free models.
    ctx.waitUntil(runModelWatchdog(env).then(() => undefined));
  },
};
export { app, verifyJwt, getBearer };
