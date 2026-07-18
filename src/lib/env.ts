// Cloudflare Worker environment bindings.
export interface R2Like {
  put: (key: string, data: ArrayBuffer | Uint8Array | string) => Promise<{ key: string }>;
  get: (key: string) => Promise<{ body: ReadableStream | null } | null>;
}
export interface AiLike {
  run: (model: string, input: unknown) => Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  // Secrets (set via `wrangler secret put` — never committed):
  ADMIN_EMAIL?: string;
  BOOTSTRAP_TOKEN?: string;
  JWT_SECRET?: string;
  MAILCHANNELS_TOKEN?: string;
  SITE_NAME?: string;
  ENVIRONMENT?: string;
  // Image storage (Item 3): prefer Backblaze B2 (no CC), else R2 binding, else inline.
  B2_KEY_ID?: string;
  B2_APP_KEY?: string;
  B2_BUCKET_NAME?: string;
  B2_PUBLIC_URL?: string;
  R2?: R2Like;
  R2_PUBLIC_URL?: string;
  // Image generation (Item 3): Cloudflare Workers AI binding (optional).
  AI?: AiLike;
  AI_MODEL_TEXT_TO_IMAGE?: string;
  // In-app Hermes LLM — FREE providers only, prioritised fallback chain.
  // Each is optional; the chain uses whichever keys are set (see src/lib/llm.ts).
  // Set via `wrangler secret put <NAME>`.
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  MISTRAL_API_KEY?: string;
}

export const IS_PRODUCTION = (env?: Env): boolean =>
  env?.ENVIRONMENT === "production";

export const siteName = (env?: Env): string =>
  env?.SITE_NAME || "Wild Jazmine Wellness";
