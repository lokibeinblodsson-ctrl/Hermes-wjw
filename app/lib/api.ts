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
    const msg = data?.error?.message || `Request failed (${res.status})`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
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
