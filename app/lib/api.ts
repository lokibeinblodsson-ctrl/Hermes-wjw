// API client: attaches the stored JWT, parses errors, base path /api/v1.
const TOKEN_KEY = "wjw_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface ApiUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  email_verified: boolean;
  force_reset: boolean;
}

async function request(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg = extractErrorMessage(data, res.status);
    const err: any = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Turn a failed API response body into a user-facing message.
//
// The backend uses three distinct 400 shapes and we want all of them to read
// clearly in the UI instead of a generic "Request failed (400)":
//   1. Explicit HttpError:        { error: { message } }
//   2. Zod validation failure     { issues: [{ path, message }], name: "ZodError" }
//      (returned verbatim by @hono/zod-validator on 400 — no `error` wrapper).
//   3. No body / unexpected shape: fall back to plain English.
export function extractErrorMessage(data: any, status?: number): string {
  // 1. Explicit server message (HttpError shape).
  if (data && typeof data.error?.message === "string" && data.error.message.trim()) {
    return data.error.message;
  }
  // 2. Zod field-validation errors: surface the first relevant issue.
  if (data && Array.isArray(data.issues) && data.issues.length > 0) {
    const issue = data.issues[0];
    const field = Array.isArray(issue?.path) && issue.path.length > 0 ? issue.path[0] : "";
    const msg = typeof issue?.message === "string" ? issue.message : "";
    if (field && msg) return `${field}: ${msg}`;
    if (msg) return msg;
  }
  // 3. Fallback.
  if (typeof status === "number") return `Could not complete the request (${status}). Please check the form and try again.`;
  return `Could not complete the request. Please check the form and try again.`;
}

// Parse an error thrown by the `api` client (or a raw fetch response body) into
// a user-facing message. Prefers the server's own message / field errors, then
// falls back to plain English. Reused by callers that catch a thrown error.
export function parseError(err: any, fallback = "Could not complete the request. Please check the form and try again."): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  // Error created by `request()` already carries the extracted message.
  if (typeof err.message === "string" && err.message) return err.message;
  if (err.data) return extractErrorMessage(err.data, err.status);
  if (err.status) return `Could not complete the request (${err.status}). Please check the form and try again.`;
  return fallback;
}

export const api = {
  get: (p: string) => request("GET", p),
  post: (p: string, b?: unknown) => request("POST", p, b),
  patch: (p: string, b?: unknown) => request("PATCH", p, b),
  put: (p: string, b?: unknown) => request("PUT", p, b),
  delete: (p: string) => request("DELETE", p),
  // Generic request used by the Hermes action layer to execute a server-issued
  // plan against the real endpoint (method/path/body straight from the plan).
  request: (method: string, path: string, body?: unknown) => request(method, path, body),
};

export function currentUser(): ApiUser | null {
  const raw = localStorage.getItem("wjw_user");
  return raw ? JSON.parse(raw) : null;
}
export function setCurrentUser(u: ApiUser | null) {
  if (u) localStorage.setItem("wjw_user", JSON.stringify(u));
  else localStorage.removeItem("wjw_user");
}
