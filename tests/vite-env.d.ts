/// <reference types="@cloudflare/vitest-pool-workers" />

// Make the test `env` binding carry the worker's real Env shape so that
// `env.DB`, `env.JWT_SECRET`, etc. typecheck under plain `tsc` (not just
// when running through vitest-pool-workers).
import type { Env } from "../src/lib/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

declare module "*.sql?raw" {
  const content: string;
  export default content;
}
declare module "*?raw" {
  const content: string;
  export default content;
}
