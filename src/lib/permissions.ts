// SINGLE SOURCE OF TRUTH FOR PERMISSIONS.
//
// Every access decision in the app — both the normal REST API routes AND the
// Hermes action layer — MUST go through the functions in this file. There is
// no second permission system. If you find a duplicated inline check like
//   if (user.role !== "admin" && user.role !== "moderator") ...
// anywhere else, replace it with the corresponding function here. The role
// capability matrix below is authoritative and was reconciled against the
// existing inline checks in board.ts / cardhub.ts / calendar.ts / files.ts /
// publishing.ts / admin.ts during the Hermes security build.
//
// All permission helpers take a *resolved* session user (one whose
// token_version and status were already verified against the DB by
// resolveSession in db/users.ts) and return a boolean. They fail closed: a
// null/unverifiable user is denied every action.

import type { Role } from "./types";

// Minimal shape every caller has after session resolution.
export interface Actor {
  id: string;
  role: Role;
}

// Role rank conveys privilege level. `reviewer` sits between member and
// moderator: it can read + approve/reject content but cannot manage
// users/system. `admin` is top.
export const ROLE_RANK: Record<Role, number> = {
  member: 1,
  reviewer: 2,
  moderator: 3,
  admin: 4,
};

export function roleAtLeast(user: Actor | null, min: Role): boolean {
  if (!user) return false;
  return ROLE_RANK[user.role] >= ROLE_RANK[min];
}

export function isActive(user: Actor | null): boolean {
  // resolveSession already drops disabled/suspended users (returns null), so a
  // non-null Actor is, by construction, an active, logged-in user.
  return !!user;
}

// ── Card permissions ───────────────────────────────────────────────────────
// Members may create, move, comment, and edit *their own* cards. Moderators+
// may edit or delete any card. This is the exact matrix from the spec and it
// FIXES the prior gap where board PATCH had no ownership check at all.

export function canCreateCard(user: Actor | null): boolean {
  return isActive(user);
}

export function canCommentOnCard(user: Actor | null): boolean {
  return isActive(user);
}

export function canAddSource(user: Actor | null): boolean {
  return isActive(user);
}

export function canLinkFile(user: Actor | null): boolean {
  return isActive(user);
}

// Schedule content: every role may schedule (matrix: Y Y Y Y). Per-card sanity
// (e.g. not scheduling another author's card) is left to the endpoint, which
// already permits the owner; we widen to all roles per the matrix.
export function canScheduleCard(user: Actor | null): boolean {
  return isActive(user);
}

export function canSubmitForReview(user: Actor | null): boolean {
  return isActive(user);
}

// Move between columns: allowed for every role (matrix: Y Y Y Y), regardless of
// ownership. This is intentionally more permissive than editing card fields.
export function canMoveCard(_user: Actor | null, _card?: { created_by: string | null }): boolean {
  return isActive(_user);
}

// Edit card fields: own card for any role; any card for moderator+.
export function canEditCard(user: Actor | null, card?: { created_by: string | null }): boolean {
  if (!isActive(user)) return false;
  if (roleAtLeast(user, "moderator")) return true;
  if (!card) return false; // cannot verify ownership without the card
  return card.created_by === user!.id;
}

export function canDeleteCard(user: Actor | null): boolean {
  return roleAtLeast(user, "moderator");
}

// ── Publishing pipeline ──────────────────────────────────────────────────────
export function canApproveContent(user: Actor | null): boolean {
  return roleAtLeast(user, "reviewer");
}

export function canPublishContent(user: Actor | null): boolean {
  return roleAtLeast(user, "moderator");
}

// ── Admin / system surfaces ──────────────────────────────────────────────────
export function canManageUsers(user: Actor | null): boolean {
  return roleAtLeast(user, "admin");
}

export function canManageInvites(user: Actor | null): boolean {
  return roleAtLeast(user, "admin");
}

export function canManageCategories(user: Actor | null): boolean {
  return roleAtLeast(user, "moderator");
}

export function canManageColumns(user: Actor | null): boolean {
  return roleAtLeast(user, "moderator");
}

export function canChangeSettings(user: Actor | null): boolean {
  return roleAtLeast(user, "admin");
}

export function canViewAuditLogs(user: Actor | null): boolean {
  return roleAtLeast(user, "moderator");
}

export function canViewAnalytics(user: Actor | null): boolean {
  return roleAtLeast(user, "moderator");
}

export function canViewPrivateMessages(user: Actor | null): boolean {
  return roleAtLeast(user, "admin");
}

// ── Channel access ───────────────────────────────────────────────────────────
// Access to a channel is evaluated from three inputs so there is ONE rule used
// by every chat endpoint (list, threads, messages, post). Fails closed.
//
//   channel.is_private === false  -> any active user may read & post.
//   channel.is_private === true   -> allowed IFF the user's role is in
//                                    allowed_roles OR the user has an explicit
//                                    channel_members row (isMember).
//
// This closes the prior IDOR where thread/message reads had no privacy check,
// and adds per-user grants without widening whole roles. Managing a channel
// (create/rename/set members/moderate) remains moderator+ as before.
export interface ChannelAccessInput {
  is_private: boolean;
  allowed_roles: Role[];
  isMember: boolean; // has an explicit channel_members row
}

export function canReadChannel(user: Actor | null, ch: ChannelAccessInput): boolean {
  if (!isActive(user)) return false;
  if (!ch.is_private) return true;
  if (ch.allowed_roles.includes(user!.role)) return true;
  return ch.isMember;
}

// Posting (threads / messages) uses the same gate as reading. Thread-lock and
// ownership checks remain the endpoint's responsibility.
export function canPostInChannel(user: Actor | null, ch: ChannelAccessInput): boolean {
  return canReadChannel(user, ch);
}

// Create channels, edit channel settings, and manage a channel's member list.
export function canManageChannel(user: Actor | null): boolean {
  return roleAtLeast(user, "moderator");
}

// Website planning edits (own): same rule as editing one's own card.
export function canEditWebsitePlanning(user: Actor | null, card?: { created_by: string | null }): boolean {
  return canEditCard(user, card);
}

// ── Hermes allow-list ────────────────────────────────────────────────────────
// The ONLY actions Hermes may ever invoke. Anything not in this list is
// structurally unreachable from the Hermes layer — not merely discouraged.
// Expanding this list is a deliberate, reviewed change (see hermes.ts).
export const HERMES_ALLOWED_ACTIONS = [
  "create_card",
  "update_card",
  "move_card",
  "comment_on_card",
  "add_source",
  "link_file",
  "schedule_card",
  "submit_for_review",
  "approve_card", // role-gated: reviewer+
  "publish_card", // role-gated: moderator+
] as const;

export type HermesAction = (typeof HERMES_ALLOWED_ACTIONS)[number];

export function isHermesAction(value: string): value is HermesAction {
  return (HERMES_ALLOWED_ACTIONS as readonly string[]).includes(value);
}

// Human-readable label for an action, used in confirmation + denial messages.
export const HERMES_ACTION_LABELS: Record<HermesAction, string> = {
  create_card: "Create card",
  update_card: "Update card",
  move_card: "Move card",
  comment_on_card: "Comment on card",
  add_source: "Add source/citation",
  link_file: "Upload/link file",
  schedule_card: "Schedule card",
  submit_for_review: "Submit for review",
  approve_card: "Approve content",
  publish_card: "Publish content",
};

// Required role for each Hermes action (null = any authenticated role).
// Used to build precise denial messages ("only moderators+ can publish").
export const HERMES_ACTION_MIN_ROLE: Record<HermesAction, Role | null> = {
  create_card: null,
  update_card: null, // own card; moderator+ for any card
  move_card: null,
  comment_on_card: null,
  add_source: null,
  link_file: null,
  schedule_card: null,
  submit_for_review: null,
  approve_card: "reviewer",
  publish_card: "moderator",
};

// Evaluate whether `user` may perform `action`, including card-ownership
// nuances for card-scoped actions. Returns a structured result so the Hermes
// layer can render a precise, helpful denial (what was requested, why blocked,
// and who *could* do it). This is the defense-in-depth pre-check that runs in
// the Hermes action layer BEFORE forwarding to the real endpoint; the endpoint
// itself enforces the same rules independently.
export interface PermissionResult {
  ok: boolean;
  action: HermesAction;
  requiredRole: Role | null;
  reason?: string;
}

export function checkHermesAction(
  user: Actor | null,
  action: HermesAction,
  card?: { created_by: string | null }
): PermissionResult {
  const minRole = HERMES_ACTION_MIN_ROLE[action];
  if (!isActive(user)) {
    return { ok: false, action, requiredRole: minRole, reason: "You must be signed in to use Hermes actions." };
  }
  if (minRole && !roleAtLeast(user, minRole)) {
    return {
      ok: false,
      action,
      requiredRole: minRole,
      reason: `Only ${minRole}+ roles can ${HERMES_ACTION_LABELS[action].toLowerCase()}. Your role (${user!.role}) cannot.`,
    };
  }
  // Card-ownership-gated actions.
  if (action === "update_card" || action === "move_card") {
    // move is allowed for all; update requires ownership for non-moderators.
    if (action === "update_card" && !canEditCard(user, card)) {
      return {
        ok: false,
        action,
        requiredRole: minRole,
        reason:
          card && card.created_by !== user!.id
            ? "You can only edit cards you created, unless you are a moderator+."
            : "You cannot edit this card.",
      };
    }
  }
  return { ok: true, action, requiredRole: minRole };
}
