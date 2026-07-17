// One-time provisioning helper. Run locally with:
//   node scripts/provision.mjs
// It calls the Worker's /bootstrap/provision endpoint with the BOOSTRAP_TOKEN,
// reads back the generated admin password (shown ONCE), and writes it to a
// LOCAL .admin-provision.txt that is git-ignored. The password must be changed
// on first login (force_reset). NEVER commit .admin-provision.txt.
//
// Set BOOTSTRAP_TOKEN to the same secret you configured via `wrangler secret put BOOTSTRAP_TOKEN`.
// Set WORKER_URL to your deployed https://<sub>.workers.dev (or http://localhost:8787 in dev).

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BOOTSTRAP_TOKEN = process.env.BOOTSTRAP_TOKEN || "";
const WORKER_URL = process.env.WORKER_URL || "http://localhost:8787";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "loki.bein.blodsson@gmail.com";

if (!BOOTSTRAP_TOKEN) {
  console.error("Set BOOTSTRAP_TOKEN (the secret you put via `wrangler secret put BOOTSTRAP_TOKEN`).");
  process.exit(1);
}
if (!ADMIN_EMAIL) {
  console.error("Set ADMIN_EMAIL.");
  process.exit(1);
}

const res = await fetch(`${WORKER_URL}/api/v1/bootstrap/provision`, {
  method: "POST",
  headers: { "x-bootstrap-token": BOOTSTRAP_TOKEN },
});

if (!res.ok) {
  const t = await res.text();
  console.error(`Provision failed (${res.status}): ${t}`);
  process.exit(1);
}

const data = await res.json();
console.log("Provision response:", JSON.stringify(data, null, 2));

if (data?.data?.temporary_password) {
  // Write to a LOCAL, git-ignored file.
  const dir = join(homedir(), ".wjw");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, "admin-provision.txt");
  writeFileSync(
    path,
    `Wild Jazmine Wellness — admin provision (LOCAL ONLY, git-ignored)\n` +
      `admin_email: ${ADMIN_EMAIL}\n` +
      `temporary_password: ${data.data.temporary_password}\n` +
      `force_reset: true (change on first login)\n` +
      `generated: ${new Date().toISOString()}\n`
  );
  console.log(`\nTemporary admin password written to: ${path}`);
  console.log("Store it in a password manager. It must be changed on first login.\n");
} else {
  console.log("\nNo temporary password returned (admin likely already exists).");
}
