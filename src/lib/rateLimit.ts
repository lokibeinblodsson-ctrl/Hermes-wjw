// In-memory sliding-window rate limiter.
// Note: D1-backed rate limiting would be more robust across multiple Workers
// instances, but in-memory is acceptable for a single free-tier Worker. The limiter
// is keyed by scope+bucket and records the timestamps of recent hits within the window.
//
// For production multi-instance deploys, swap this for a D1/KV-backed counter.

interface Bucket {
  hits: number[];
}

const store = new Map<string, Bucket>();

// Exposed for tests so the in-memory limiter does not bleed counts across
// isolated test describes (the Vitest pool shares one Worker instance).
export function resetRateLimitStore(): void {
  store.clear();
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds
}

export function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now()
): RateLimitResult {
  const bucket = store.get(key) ?? { hits: [] };
  const windowStart = now - windowSeconds * 1000;
  // prune old hits
  bucket.hits = bucket.hits.filter((t) => t > windowStart);
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    const retryAfter = Math.ceil((oldest + windowSeconds * 1000 - now) / 1000);
    store.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }
  bucket.hits.push(now);
  store.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.hits.length),
    retryAfter: 0,
  };
}

// Strict auth-focused limits
export const RATE_LIMITS = {
  login: { limit: 10, window: 60 }, // 10 logins / minute per IP
  passwordReset: { limit: 5, window: 60 * 60 }, // 5 resets / hour per IP
  signup: { limit: 20, window: 60 * 60 },
  // General API buckets. Unauthenticated traffic keeps a moderate cap; the tight
  // brute-force protection for auth actions (login/reset/accept-invite/provision)
  // lives in those route handlers themselves. Authenticated traffic (valid JWT)
  // gets a generous cap so normal app usage — e.g. an admin panel firing several
  // concurrent data loads — never trips the limiter.
  api: { limit: 120, window: 60 }, // general unauthenticated API per IP
  apiAuthenticated: { limit: 500, window: 60 }, // authenticated API per IP
};

export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}
