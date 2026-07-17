// Auth routes: login, signup, logout, change-password, email verification,
// password reset, invite + accept-invite. All password handling is server-side;
// passwords are PBKDF2-hashed; tokens are SHA-256 hashed at rest.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Env, siteName } from "../lib/env";
import { json, Errors } from "../lib/errors";
import { verifyJwt, signJwt } from "../lib/jwt";
import {
  loginSchema,
  signupSchema,
  changePasswordSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  inviteSchema,
} from "../lib/validation";
import {
  randomId,
  randomToken,
  hashPassword,
  verifyPassword,
  hashToken,
  nowIso,
} from "../lib/crypto";
import {
  getUserByEmail,
  getUserById,
  getPasswordHash,
  setPasswordHash,
  bumpTokenVersion,
  resolveSession,
} from "../db/users";
import { logAudit, logAnalytics } from "../db/logging";
import { sendEmail, verificationEmailHtml, resetEmailHtml, inviteEmailHtml } from "../lib/email";
import { rateLimit, RATE_LIMITS, clientIp } from "../lib/rateLimit";
import { requireAuth, requireRole } from "../lib/auth";
import type { User } from "../lib/types";

const auth = new Hono<{ Bindings: Env }>();

async function getFlag(db: D1DatabaseLike, name: string): Promise<boolean> {
  const r = await db.prepare(`SELECT enabled FROM feature_flags WHERE name = ?`).bind(name).first();
  return r ? !!(r as { enabled: number }).enabled : false;
}
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    status: u.status,
    email_verified: u.email_verified,
    force_reset: u.force_reset,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}

function siteUrl(req: Request): string {
  return new URL(req.url).origin;
}

// ── Login ────────────────────────────────────────────────────────────────
auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const ip = clientIp(c.req.raw);
  const rl = rateLimit(`login:${ip}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.window);
  if (!rl.allowed) {
    await logAnalytics(c.env.DB, "login_rate_limited", null, { ip });
    return json({ error: { code: "rate_limited", message: `Too many attempts. Retry in ${rl.retryAfter}s` } }, 429);
  }
  const { email, password } = await c.req.json();
  const user = await getUserByEmail(c.env.DB, email);
  if (!user || user.status === "disabled" || user.status === "suspended") {
    await logAnalytics(c.env.DB, "login_failed", user?.id ?? null, { reason: "no_user_or_disabled", ip });
    return json({ error: { code: "unauthorized", message: "Invalid email or password" } }, 401);
  }
  // lockout check
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return json({ error: { code: "locked", message: "Account temporarily locked. Try later." } }, 423);
  }
  const hash = await getPasswordHash(c.env.DB, user.id);
  const ok = hash && (await verifyPassword(password, hash));
  if (!ok) {
    const fails = (user.failed_logins || 0) + 1;
    const lockUntil = fails >= 5 ? nowIsoPlusMinutes(15) : null;
    await c.env.DB.prepare(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`)
      .bind(fails, lockUntil, user.id).run();
    await logAnalytics(c.env.DB, "login_failed", user.id, { reason: "bad_password", ip });
    return json({ error: { code: "unauthorized", message: "Invalid email or password" } }, 401);
  }
  // success
  await c.env.DB.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`)
    .bind(nowIso(), user.id).run();
  const token = await signJwt({ sub: user.id, role: user.role, tv: user.token_version, force_reset: !!user.force_reset });
  await logAudit(c.env.DB, { actorId: user.id, action: "login", ip });
  await logAnalytics(c.env.DB, "login", user.id, { ip });
  return json({
    ok: true,
    data: { token, user: publicUser(user), force_reset: !!user.force_reset },
  });
});

// ── Logout (invalidate all sessions) ─────────────────────────────────────
auth.post("/logout", async (c) => {
  const session = await resolveSession(c.env.DB, (await currentSub(c)) ?? "", 0).catch(() => null);
  const bearer = c.req.header("authorization");
  if (bearer) {
    try {
      const p = await verifyJwt(bearer.replace(/^Bearer /, ""));
      await bumpTokenVersion(c.env.DB, p.sub);
      await logAudit(c.env.DB, { actorId: p.sub, action: "logout" });
    } catch { /* ignore */ }
  }
  return json({ ok: true });
});

// ── Current user ─────────────────────────────────────────────────────────
auth.get("/me", async (c) => {
  const sub = await currentSub(c);
  if (!sub) return json({ ok: true, data: { user: null } });
  const user = await resolveSession(c.env.DB, sub, await currentTv(c));
  if (!user) return json({ ok: true, data: { user: null } });
  return json({ ok: true, data: { user: publicUser(user) } });
});

// ── Change password (authenticated) ─────────────────────────────────────
auth.post("/change-password", zValidator("json", changePasswordSchema), async (c) => {
  const sub = await currentSub(c);
  if (!sub) return json({ error: { code: "unauthorized", message: "Auth required" } }, 401);
  const user = await resolveSession(c.env.DB, sub, await currentTv(c));
  if (!user) return json({ error: { code: "unauthorized", message: "Session invalid" } }, 401);
  const { current_password, new_password } = await c.req.json();
  const hash = await getPasswordHash(c.env.DB, user.id);
  if (!hash || !(await verifyPassword(current_password, hash))) {
    return json({ error: { code: "bad_request", message: "Current password is incorrect" } }, 400);
  }
  const newHash = await hashPassword(new_password);
  await setPasswordHash(c.env.DB, user.id, newHash);
  const tv = await bumpTokenVersion(c.env.DB, user.id);
  await c.env.DB.prepare(`UPDATE users SET force_reset = 0 WHERE id = ?`).bind(user.id).run();
  const token = await signJwt({ sub: user.id, role: user.role, tv, force_reset: false });
  await logAudit(c.env.DB, { actorId: user.id, action: "change_password" });
  await logAnalytics(c.env.DB, "password_changed", user.id);
  return json({ ok: true, data: { token } });
});

// ── Request email verification ───────────────────────────────────────────
auth.post("/request-verification", async (c) => {
  const sub = await currentSub(c);
  if (!sub) return json({ error: { code: "unauthorized", message: "Auth required" } }, 401);
  const user = await resolveSession(c.env.DB, sub, await currentTv(c));
  if (!user) return json({ error: { code: "unauthorized", message: "Session invalid" } }, 401);
  if (user.email_verified) return json({ ok: true, data: { message: "Already verified" } });
  const token = randomToken(24);
  const expires = nowIsoPlusMinutes(60 * 24);
  await c.env.DB.prepare(
    `INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(randomId("evf"), user.id, await hashToken(token), expires, nowIso()).run();
  const link = `${siteUrl(c.req.raw)}/verify?token=${token}`;
  await sendEmail(c.env, c.env.DB, user.email, `Verify your ${siteName(c.env)} email`, verificationEmailHtml(siteName(c.env), link));
  await logAnalytics(c.env.DB, "verification_requested", user.id);
  return json({ ok: true, data: { message: "Verification email sent" } });
});

// ── Verify email (token in query) ────────────────────────────────────────
auth.get("/verify-email", zValidator("query", verifyEmailSchema), async (c) => {
  const { token } = c.req.query() as { token: string };
  const hash = await hashToken(token);
  const row = await c.env.DB.prepare(
    `SELECT * FROM email_verifications WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
  ).bind(hash, nowIso()).first();
  if (!row) return json({ error: { code: "bad_request", message: "Invalid or expired token" } }, 400);
  const r = row as { id: string; user_id: string };
  await c.env.DB.prepare(`UPDATE email_verifications SET used_at = ? WHERE id = ?`).bind(nowIso(), r.id).run();
  await c.env.DB.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).bind(r.user_id).run();
  await logAnalytics(c.env.DB, "email_verified", r.user_id);
  return json({ ok: true, data: { message: "Email verified" } });
});

// ── Request password reset ───────────────────────────────────────────────
auth.post("/request-password-reset", zValidator("json", requestPasswordResetSchema), async (c) => {
  const ip = clientIp(c.req.raw);
  const rl = rateLimit(`pwreset:${ip}`, RATE_LIMITS.passwordReset.limit, RATE_LIMITS.passwordReset.window);
  if (!rl.allowed) return json({ error: { code: "rate_limited", message: `Retry in ${rl.retryAfter}s` } }, 429);
  const { email } = await c.req.json();
  const user = await getUserByEmail(c.env.DB, email);
  // Always return success to avoid user enumeration.
  if (user) {
    const token = randomToken(24);
    await c.env.DB.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(randomId("pwr"), user.id, await hashToken(token), nowIsoPlusMinutes(60), nowIso()).run();
    const link = `${siteUrl(c.req.raw)}/reset?token=${token}`;
    await sendEmail(c.env, c.env.DB, user.email, `Reset your ${siteName(c.env)} password`, resetEmailHtml(siteName(c.env), link));
    await logAnalytics(c.env.DB, "password_reset_requested", user.id, { ip });
  }
  return json({ ok: true, data: { message: "If the email exists, a reset link was sent." } });
});

// ── Reset password (with token) ──────────────────────────────────────────
auth.post("/reset-password", zValidator("json", resetPasswordSchema), async (c) => {
  const { token, password } = await c.req.json();
  const hash = await hashToken(token);
  const row = await c.env.DB.prepare(
    `SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
  ).bind(hash, nowIso()).first();
  if (!row) return json({ error: { code: "bad_request", message: "Invalid or expired token" } }, 400);
  const r = row as { id: string; user_id: string };
  const newHash = await hashPassword(password);
  await setPasswordHash(c.env.DB, r.user_id, newHash);
  await c.env.DB.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`).bind(nowIso(), r.id).run();
  await c.env.DB.prepare(`UPDATE users SET force_reset = 0, failed_logins = 0, locked_until = NULL WHERE id = ?`).bind(r.user_id).run();
  await bumpTokenVersion(c.env.DB, r.user_id);
  await logAnalytics(c.env.DB, "password_reset_completed", r.user_id);
  return json({ ok: true, data: { message: "Password updated. Please log in." } });
});

// ── Signup (invite-only gated by feature flag) ───────────────────────────
auth.post("/signup", zValidator("json", signupSchema), async (c) => {
  const ip = clientIp(c.req.raw);
  const rl = rateLimit(`signup:${ip}`, RATE_LIMITS.signup.limit, RATE_LIMITS.signup.window);
  if (!rl.allowed) return json({ error: { code: "rate_limited", message: `Retry in ${rl.retryAfter}s` } }, 429);
  const body = await c.req.json();
  const inviteOnly = await getFlag(c.env.DB, "invite_only_signup");
  if (inviteOnly && !body.invite_token) {
    return json({ error: { code: "forbidden", message: "Signup is invite-only" } }, 403);
  }
  const existing = await getUserByEmail(c.env.DB, body.email);
  if (existing) return json({ error: { code: "conflict", message: "Email already registered" } }, 409);
  const userId = randomId("usr");
  const hash = await hashPassword(body.password);
  let status = "invited";
  let inviteToken: string | null = null;
  if (body.invite_token) {
    // validate invite token (we stored it on the user row from /invite)
    const inv = await c.env.DB.prepare(`SELECT id FROM users WHERE invite_token = ?`).bind(body.invite_token).first();
    if (!inv) return json({ error: { code: "bad_request", message: "Invalid invite token" } }, 400);
    status = "active";
    await c.env.DB.prepare(`UPDATE users SET invite_token = NULL WHERE invite_token = ?`).bind(body.invite_token).run();
  }
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, status, email_verified, force_reset, token_version, created_at, updated_at, invited_by, invite_token)
     VALUES (?, ?, ?, ?, 'member', ?, 0, 0, 0, ?, ?, NULL, ?)`
  ).bind(userId, body.email, body.display_name, hash, status, nowIso(), nowIso(), inviteToken).run();
  await logAudit(c.env.DB, { actorId: userId, action: "signup", ip });
  await logAnalytics(c.env.DB, "signup", userId, { ip });
  return json({ ok: true, data: { user_id: userId, status, message: "Account created. Check email to verify." } }, 201);
});

// ── Invite (admin) ───────────────────────────────────────────────────────
auth.post("/invite", zValidator("json", inviteSchema), async (c) => {
  const sub = await currentSub(c);
  if (!sub) return json({ error: { code: "unauthorized", message: "Auth required" } }, 401);
  const admin = await resolveSession(c.env.DB, sub, await currentTv(c));
  if (!admin) return json({ error: { code: "unauthorized", message: "Session invalid" } }, 401);
  requireRole(admin, "admin");
  const body = await c.req.json();
  const existing = await getUserByEmail(c.env.DB, body.email);
  if (existing) return json({ error: { code: "conflict", message: "Email already registered" } }, 409);
  const userId = randomId("usr");
  const inviteToken = randomToken(24);
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, status, email_verified, force_reset, token_version, created_at, updated_at, invited_by, invite_token)
     VALUES (?, ?, ?, '', ?, 'invited', 0, 1, 0, ?, ?, ?, ?)`
  ).bind(userId, body.email, body.display_name || body.email.split("@")[0], body.role, nowIso(), nowIso(), admin.id, inviteToken).run();
  const link = `${siteUrl(c.req.raw)}/accept-invite?token=${inviteToken}`;
  await sendEmail(c.env, c.env.DB, body.email, `You're invited to ${siteName(c.env)}`, inviteEmailHtml(siteName(c.env), link));
  await logAudit(c.env.DB, { actorId: admin.id, action: "invite_user", targetType: "user", targetId: userId, meta: { email: body.email, role: body.role } });
  await logAnalytics(c.env.DB, "invitation_sent", userId, { by: admin.id });
  return json({ ok: true, data: { user_id: userId, message: "Invitation sent" } }, 201);
});

// ── Accept invite (set password) ─────────────────────────────────────────
auth.post("/accept-invite", async (c) => {
  const { token, password } = await c.req.json().catch(() => ({ token: "", password: "" }));
  if (!token || !password || password.length < 8) {
    return json({ error: { code: "bad_request", message: "token and password (min 8) required" } }, 400);
  }
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE invite_token = ? AND status = 'invited'`).bind(token).first();
  if (!user) return json({ error: { code: "bad_request", message: "Invalid or expired invite" } }, 400);
  const id = (user as { id: string }).id;
  const hash = await hashPassword(password);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, status = 'active', email_verified = 1, force_reset = 0, invite_token = NULL, updated_at = ? WHERE id = ?`
  ).bind(hash, nowIso(), id).run();
  await logAnalytics(c.env.DB, "invite_accepted", id);
  return json({ ok: true, data: { message: "Password set. You can now log in." } });
});

// ── helpers ──────────────────────────────────────────────────────────────
async function currentSub(c: { req: { raw: Request }; env: Env }): Promise<string | null> {
  const auth = c.req.raw.headers.get("authorization");
  if (!auth) return null;
  const token = auth.replace(/^Bearer /, "");
  try {
    const p = await verifyJwt(token);
    return p.sub;
  } catch {
    return null;
  }
}
async function currentTv(c: { req: { raw: Request }; env: Env }): Promise<number> {
  const auth = c.req.raw.headers.get("authorization");
  if (!auth) return 0;
  try {
    const p = await verifyJwt(auth.replace(/^Bearer /, ""));
    return p.tv || 0;
  } catch {
    return 0;
  }
}

function nowIsoPlusMinutes(mins: number): string {
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

export default auth;
