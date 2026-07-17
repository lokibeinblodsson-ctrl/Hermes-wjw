// Minimal JWT (HS256) implementation using Web Crypto. No external deps.
import { toBase64Url, enc as _enc } from "./crypto";

const enc = _enc;
const dec = new TextDecoder();

function b64url(input: string): string {
  return toBase64Url(enc.encode(input));
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  // Coerce to a concrete ArrayBuffer-backed view so it satisfies BufferSource
  // under newer lib.dom typings (which reject ArrayBufferLike union).
  const keyBuf = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuf as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data) as BufferSource);
  return new Uint8Array(sig);
}

function toHex(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += b.toString(16).padStart(2, "0");
  return s;
}

// Secret is derived from the deployment secret (JWT secret). We read it from
// env at call time so no long-lived secret lives in memory in source.
let JWT_SECRET: string | null = null;
export function setJwtSecret(secret: string) {
  JWT_SECRET = secret;
}
function getSecret(): Uint8Array {
  if (!JWT_SECRET) throw new Error("JWT secret not configured");
  return enc.encode(JWT_SECRET);
}

export interface JwtPayload {
  sub: string;
  role: string;
  tv: number; // token version
  force_reset?: boolean;
  iat?: number;
  exp?: number;
}

export async function signJwt(payload: JwtPayload, ttlSeconds = 60 * 60 * 24 * 7): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify(body));
  const data = `${header}.${claim}`;
  const sig = await hmacSha256(getSecret(), data);
  return `${data}.${toBase64Url(sig)}`;
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [header, claim, sig] = parts;
  const expected = await hmacSha256(getSecret(), `${header}.${claim}`);
  const expectedB64 = toBase64Url(expected);
  if (expectedB64 !== sig) throw new Error("bad signature");
  const body = JSON.parse(dec.decode(b64urlToBytes(claim))) as JwtPayload;
  if (body.exp && body.exp < Math.floor(Date.now() / 1000)) throw new Error("token expired");
  return body;
}
