// Consistent API error shape. Errors are returned as JSON with a code + message.

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (msg = "Bad request", details?: unknown) => new HttpError(400, "bad_request", msg, details),
  unauthorized: (msg = "Authentication required") => new HttpError(401, "unauthorized", msg),
  forbidden: (msg = "You do not have permission to perform this action") => new HttpError(403, "forbidden", msg),
  notFound: (msg = "Resource not found") => new HttpError(404, "not_found", msg),
  conflict: (msg = "Resource conflict") => new HttpError(409, "conflict", msg),
  tooManyRequests: (msg = "Too many requests, please slow down") => new HttpError(429, "rate_limited", msg),
  internal: (msg = "Internal server error") => new HttpError(500, "internal_error", msg),
};

export function jsonError(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  console.error("Unhandled error", err);
  return json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export const ok = (data: unknown, headers?: Record<string, string>) => json({ ok: true, data }, 200, headers);
export const created = (data: unknown) => json({ ok: true, data }, 201);
