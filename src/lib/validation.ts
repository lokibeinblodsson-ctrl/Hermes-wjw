// Centralized input validation schemas (zod). Used by route handlers.
import { z } from "zod";

export const emailSchema = z.string().email().max(200);
export const passwordSchema = z.string().min(8).max(200);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const signupSchema = z.object({
  email: emailSchema,
  display_name: z.string().min(1).max(120),
  password: passwordSchema,
  invite_token: z.string().min(1).optional(),
});

export const requestPasswordResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(1) });

export const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: passwordSchema,
});

// Cards
const checklistItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(1000),
  done: z.boolean(),
});
const mediaItemSchema = z.object({
  id: z.string().min(1),
  url: z.string().max(2000),
  type: z.string().max(50).optional().default(""),
  name: z.string().max(300).optional().default(""),
});
const resourceItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(300),
  url: z.string().max(2000),
  notes: z.string().max(2000).optional().default(""),
});
const customFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(200),
  value: z.string().max(5000),
});

export const cardCreateSchema = z.object({
  column_id: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(10000).optional().default(""),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
  due_date: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  assignee_id: z.string().nullable().optional(),
  // Extended card model (migration 0002).
  draft: z.string().max(50000).nullable().optional(),
  checklist: z.array(checklistItemSchema).max(200).optional(),
  media: z.array(mediaItemSchema).max(100).optional(),
  resources: z.array(resourceItemSchema).max(100).optional(),
  custom_fields: z.array(customFieldSchema).max(100).optional(),
  notes: z.string().max(50000).nullable().optional(),
  content_pillar: z.string().max(200).nullable().optional(),
  platform_ready: z.boolean().optional(),
  platforms: z.array(z.string().max(50)).max(30).optional(),
  research_page_id: z.string().max(120).nullable().optional(),
  scheduled_date: z.string().max(20).nullable().optional(),
});
export const cardUpdateSchema = cardCreateSchema.partial().extend({ position: z.number().int().optional() });

// Categories
export const categorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{3,6}$/).optional().default("#7c9c64"),
});

// Tasks
export const taskCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(10000).optional().default(""),
  assignee_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
  status: z.enum(["open", "in_progress", "blocked", "done", "cancelled"]).optional().default("open"),
});
export const taskUpdateSchema = taskCreateSchema.partial();

// Chat
export const channelCreateSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-z0-9-_]+$/),
  description: z.string().max(500).optional().default(""),
  is_private: z.boolean().optional().default(false),
  allowed_roles: z.array(z.enum(["admin", "moderator", "reviewer", "member"])).optional().default([]),
});
export const threadCreateSchema = z.object({
  channel_id: z.string().min(1),
  title: z.string().min(1).max(300),
});
export const messageCreateSchema = z.object({
  thread_id: z.string().min(1),
  parent_id: z.string().nullable().optional(),
  body: z.string().min(1).max(10000),
  mentions: z.array(z.string()).optional().default([]),
});

// Memory
export const memoryCreateSchema = z.object({
  type: z.enum(["fact", "idea", "plan", "decision", "changelog", "bug", "request", "note"]),
  title: z.string().min(1).max(300),
  body: z.string().max(20000).optional().default(""),
  summary: z.string().max(1000).optional().default(""),
  tags: z.array(z.string().max(50)).max(30).optional().default([]),
  source: z.string().max(200).optional().default(""),
});
export const memoryQuerySchema = z.object({
  q: z.string().min(1).max(500),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  since: z.string().optional(),
});

// Admin: user update
export const userUpdateSchema = z.object({
  display_name: z.string().max(120).optional(),
  role: z.enum(["admin", "moderator", "reviewer", "member"]).optional(),
  status: z.enum(["active", "disabled", "invited", "suspended"]).optional(),
  email_verified: z.boolean().optional(),
  force_reset: z.boolean().optional(),
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["admin", "moderator", "reviewer", "member"]).optional().default("member"),
  display_name: z.string().max(120).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CardCreate = z.infer<typeof cardCreateSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type ChannelCreate = z.infer<typeof channelCreateSchema>;
export type ThreadCreate = z.infer<typeof threadCreateSchema>;
export type MessageCreate = z.infer<typeof messageCreateSchema>;
export type MemoryCreate = z.infer<typeof memoryCreateSchema>;
export type UserUpdate = z.infer<typeof userUpdateSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
