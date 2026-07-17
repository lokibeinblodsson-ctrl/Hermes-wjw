// Domain types shared across the worker.

export type Role = "admin" | "moderator" | "reviewer" | "member";
export type UserStatus = "active" | "disabled" | "invited" | "suspended";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  email_verified: boolean;
  force_reset: boolean;
  token_version: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  failed_logins: number;
  locked_until: string | null;
}

export type Priority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";

export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface BoardColumn {
  id: string;
  name: string;
  position: number;
  color: string;
  wip_limit: number | null;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
export interface MediaItem {
  id: string;
  url: string;
  type: string;
  name: string;
}
export interface ResourceItem {
  id: string;
  label: string;
  url: string;
  notes: string;
}
export interface CustomField {
  id: string;
  label: string;
  value: string;
}

export interface Card {
  id: string;
  column_id: string;
  title: string;
  description: string;
  priority: Priority;
  due_date: string | null;
  category_id: string | null;
  tags: string[];
  assignee_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  position: number;
  // Extended card model (migration 0002).
  draft: string | null;
  checklist: ChecklistItem[];
  media: MediaItem[];
  resources: ResourceItem[];
  custom_fields: CustomField[];
  notes: string | null;
  content_pillar: string | null;
  platform_ready: boolean;
  platforms: string[];
  research_page_id: string | null;
}

export type MemoryType =
  | "fact"
  | "idea"
  | "plan"
  | "decision"
  | "changelog"
  | "bug"
  | "request"
  | "note";

export interface MemoryNote {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  source: string;
  embedding: number[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  token_version: number;
  force_reset: boolean;
}
