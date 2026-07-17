// Auth context from a request: resolves the JWT, enforces token version &
// force-reset, and exposes permission helpers. Server-side enforcement only.
import { verifyJwt } from "./jwt";
import { Errors } from "./errors";
import type { SessionUser, Role } from "./types";
import type { Env } from "./env";
import { resolveSession } from "../db/users";

export function getBearer(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) return token;
  return null;
}

export async function getSessionUser(req: Request, env: Env): Promise<SessionUser | null> {
  const token = getBearer(req);
  if (!token) return null;
  try {
    const payload = await verifyJwt(token);
    // token_version mismatch → session invalidated (logout everywhere)
    // We compare against DB token_version in the route layer when sensitive,
    // but the JWT itself carries tv for fast rejection.
    return {
      id: payload.sub,
      email: payload.sub, // email stored separately if needed; we resolve via DB in routes
      role: payload.role as Role,
      token_version: payload.tv,
      force_reset: Boolean(payload.force_reset),
    };
  } catch {
    return null;
  }
}

export function requireAuth(session: SessionUser | null): SessionUser {
  if (!session) throw Errors.unauthorized();
  return session;
}

export function requireRole(session: SessionUser, ...roles: Role[]): void {
  if (!roles.includes(session.role)) {
    throw Errors.forbidden(`Requires one of roles: ${roles.join(", ")}`);
  }
}

export function isAdmin(session: SessionUser | null): boolean {
  return session?.role === "admin";
}

// Rank conveys privilege level. `reviewer` sits between member and moderator:
// it can read + approve/reject content but cannot manage users/system.
export const ROLE_RANK: Record<Role, number> = { member: 1, reviewer: 2, moderator: 3, admin: 4 };

// Reviewer permissions: read content + approve/reject in the publishing pipeline.
// Non-admin/moderator roles must not reach system/admin surfaces.
export function canReview(session: SessionUser | null): boolean {
  if (!session) return false;
  return ROLE_RANK[session.role] >= ROLE_RANK.reviewer;
}

// ── Shared DB-backed session resolver ───────────────────────────────────────
// This is the ONE place that turns a raw request into a fully-verified session
// user (JWT signature + token_version + disabled/suspended status check). Every
// route file should use this instead of copy-pasting a `me()` helper. Reusing
// resolveSession from db/users guarantees identical verification everywhere.
export async function getResolvedUser(req: Request, env: Env): Promise<SessionUser | null> {
  const token = getBearer(req);
  if (!token) return null;
  try {
    const payload = await verifyJwt(token);
    return await resolveSession(env.DB, payload.sub, payload.tv || 0);
  } catch {
    return null;
  }
}
