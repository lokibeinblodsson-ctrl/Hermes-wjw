// Image storage adapter. Stores generated content images and returns a public
// HTTPS URL suitable for social platforms (Instagram/Pinterest require a public
// image URL). Three backends, chosen by which secrets are present:
//   1. B2  — Backblaze B2 (S3-compatible), free 10GB, no credit card. Preferred.
//   2. R2  — Cloudflare R2 binding (env.R2), if bound + configured.
//   3. inline fallback — when no storage is configured, returns the raw bytes as
//      a data: URL so the pipeline still works in dev/test with zero secrets.
//
// No external SDKs: B2/R2 both speak plain HTTP (S3 PUT) we issue via fetch().

export interface StorageEnv {
  B2_KEY_ID?: string;
  B2_APP_KEY?: string;
  B2_BUCKET_NAME?: string;
  B2_PUBLIC_URL?: string;
  R2?: { put: (key: string, data: ArrayBuffer | Uint8Array | string) => Promise<{ key: string }> };
  R2_PUBLIC_URL?: string;
  SITE_NAME?: string;
}

export type StorageBackend = "b2" | "r2" | "inline";

export function activeBackend(env: StorageEnv): StorageBackend {
  if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_NAME) return "b2";
  if (env.R2 && env.R2_PUBLIC_URL) return "r2";
  return "inline";
}

// Minimal S3 v4 auth for a PUT (unsigned payload, sha256=UNSIGNED-PAYLOAD).
// B2's S3-compatible API accepts this. We avoid pulling in an AWS SDK.
async function s3Put(opts: {
  endpoint: string; // e.g. https://s3.us-west-004.backblazeb2.com
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<string> {
  const url = `${opts.endpoint}/${opts.bucket}/${opts.key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const region = "us-west-004"; // B2 S3 endpoint region; adjust if using another
  const service = "s3";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalHeaders =
    `host:${new URL(url).host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest =
    `PUT\n/${opts.bucket}/${opts.key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const enc = new TextEncoder();
  const hash = async (data: string) => {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(data));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const algorithm = `AWS4-HMAC-SHA256`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign =
    `${algorithm}\n${amzDate}\n${credentialScope}\n${await hash(canonicalRequest)}`;

  const hmac = async (key: Uint8Array | string, data: string) => {
    const keyBuf: BufferSource = typeof key === "string" ? enc.encode(key) : (key as unknown as BufferSource);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
    return new Uint8Array(sig);
  };
  const hmacHex = async (key: Uint8Array | string, data: string) =>
    [...(await hmac(key, data))].map((b) => b.toString(16).padStart(2, "0")).join("");

  const kDate = await hmac(`AWS4${opts.secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = await hmacHex(kSigning, stringToSign);

  const authorization =
    `${algorithm} Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": opts.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization,
    },
    body: opts.body as unknown as BodyInit,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`B2/S3 PUT failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  return `${opts.endpoint}/${opts.bucket}/${opts.key}`;
}

export interface StoreResult {
  backend: StorageBackend;
  url: string;
}

// Exported for the scheduled daily-backup module (src/lib/backup.ts), which
// needs to PUT a JSON snapshot to the same B2 bucket.
export { s3Put };

// Stores image bytes and returns a public URL. keyHint names the object
// (e.g. `posts/<id>.png`).
export async function storeImage(
  env: StorageEnv,
  bytes: Uint8Array,
  contentType: string,
  keyHint: string
): Promise<StoreResult> {
  const backend = activeBackend(env);
  if (backend === "b2") {
    const url = await s3Put({
      endpoint: (env.B2_PUBLIC_URL || "").replace(/\/[^/]*$/, "") || "https://s3.us-west-004.backblazeb2.com",
      bucket: env.B2_BUCKET_NAME!,
      key: keyHint,
      body: bytes,
      contentType,
      accessKeyId: env.B2_KEY_ID!,
      secretAccessKey: env.B2_APP_KEY!,
    });
    return { backend, url };
  }
  if (backend === "r2") {
    await env.R2!.put(keyHint, bytes);
    return { backend, url: `${env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${keyHint}` };
  }
  // inline fallback: data URL. Works with no secrets; not suitable for social
  // posting at scale but keeps the pipeline functional in dev/test.
  const b64 = [...bytes].map((b) => String.fromCharCode(b)).join("");
  const dataUrl = `data:${contentType};base64,${btoa(b64)}`;
  return { backend, url: dataUrl };
}
