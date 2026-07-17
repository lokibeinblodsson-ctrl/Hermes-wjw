// Wild Jazmine Wellness — main Worker entry.
// Serves: /api/v1/* REST endpoints + static SPA assets (fallback).
import { Hono } from "hono";
import { Env, siteName, IS_PRODUCTION } from "./lib/env";
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
app.onError((err, c) => {
  console.error("[unhandled]", err);
  if (err instanceof HttpError) {
    return c.json({ success: false, error: { code: err.code, message: err.message, details: err.details } }, err.status as Parameters<typeof c.json>[1]);
  }
  return c.json({ success: false, error: { code: "internal_error", message: "Internal server error" } }, 500);
});

// Set JWT secret + seed admin at startup of each isolate (idempotent).
app.use("*", async (c, next) => {
  // JWT secret: derive deterministically from a secret env. We fall back to a
  // dev-only secret when no JWT_SECRET provided (tests set one).
  if (!c.env.JWT_SECRET && c.env.BOOTSTRAP_TOKEN) {
    // Use BOOTSTRAP_TOKEN as the HMAC key base; it's a secret, not committed.
    setJwtSecret(`wjw-${c.env.BOOTSTRAP_TOKEN}`);
  } else if (c.env.JWT_SECRET) {
    setJwtSecret(c.env.JWT_SECRET);
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

export default app;
export { app, verifyJwt, getBearer };
