import { webcrypto } from "node:crypto";
// Mirror of src/lib/crypto.ts hashPassword so we can set a known admin password
// in the local dev D1 without going through the (redacted) provision flow.
const enc = new TextEncoder();

function toBase64Url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const password = process.argv[2];
const saltBytes = webcrypto.getRandomValues(new Uint8Array(16));
const salt = toBase64Url(saltBytes);
const keyMaterial = await webcrypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
const hash = toBase64Url(bits);
process.stdout.write(`pbkdf2$100000$${salt}$${hash}`);
