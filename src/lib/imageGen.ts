// Image generation. Primary: Cloudflare Workers AI (`@cf/black-forest-labs/...`
// or similar text-to-image model) when an AI binding is present. Fallback:
// Pollinations.ai (free, no key) returns a direct image URL/stream.
//
// Returns raw PNG bytes when a backend is available, or null if image generation
// is unavailable (caller can proceed without an image).

import type { Env } from "./env";

export interface GenResult {
  bytes: Uint8Array;
  contentType: string;
}

// Workers AI text-to-image. The exact model id depends on what's bound; we
// call the AI binding generically and expect image bytes back.
async function viaWorkersAi(env: Env, prompt: string): Promise<GenResult | null> {
  const ai = (env as any).AI;
  if (!ai) return null;
  try {
    const model = (env as any).AI_MODEL_TEXT_TO_IMAGE || "@cf/black-forest-labs/flux-1-schnell";
    const res: any = await ai.run(model, { prompt });
    if (!res || !res.image) return null;
    // Workers AI returns base64 image in `image` for some models.
    const b64 = typeof res.image === "string" ? res.image : null;
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, contentType: "image/png" };
  } catch {
    return null;
  }
}

// Pollinations fallback: GET https://image.pollinations.xyz/<encodeURIComponent(prompt)>
async function viaPollinations(prompt: string): Promise<GenResult | null> {
  try {
    const url = `https://image.pollinations.xyz/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/png";
    return { bytes: buf, contentType: ct };
  } catch {
    return null;
  }
}

export async function generateImage(env: Env, prompt: string): Promise<GenResult | null> {
  if (!prompt || !prompt.trim()) return null;
  return (await viaWorkersAi(env, prompt)) ?? (await viaPollinations(prompt));
}
