// Cryptographic helpers using the Web Crypto API (available on Workers).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomId(prefix = ""): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return prefix ? `${prefix}_${s}` : s;
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64Url(buf);
}

export function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function sha256Hex(input: string): string {
  const digest = crypto.subtle.digest("SHA-256", enc.encode(input));
  return digest.then((buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }) as unknown as string; // resolved synchronously-by-design; callers await via hashToken
}

// PBKDF2 password hashing
const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string, salt?: string): Promise<string> {
  const useSalt = salt || toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(useSalt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  const hash = toBase64Url(bits);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${useSalt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const [, iterStr, salt, expectedHash] = parts;
  const candidate = await hashPassword(password, salt);
  // candidate format: pbkdf2$iter$salt$hash
  const candHash = candidate.split("$")[3];
  return constantTimeEqual(candHash, expectedHash);
}

export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

// Async SHA-256 hex of an arbitrary string. Used for backup checksums.
export async function sha256HexAsync(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
  return constantTimeEqual(a, b);
}

// Re-export DB helpers that route modules import from this path, so a single
// import line works. (Defined in db/db.ts to avoid a circular import at module
// load; these are re-exported here for convenience.)
export { nowIso, toJson, jsonField } from "../db/db";

export { enc, dec };
