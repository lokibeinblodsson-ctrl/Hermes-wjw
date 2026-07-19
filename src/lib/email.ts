// Email service. Delivery is provider-optional and always free / no-card:
//   1. BREVO_API_KEY        — preferred. Free tier (300/day, no credit card).
//   2. MAILJET_API_KEY +
//      MAILJET_SECRET_KEY   — backup. Free tier (200/day, no credit card).
//   3. MAILCHANNELS_TOKEN   — legacy fallback (kept for compat; now gates on a
//                             credit card, so not recommended).
//   4. no provider          — message is recorded in email_outbox and the
//                             operator relays the link from the Admin "Mail
//                             Queue" tab.
// In every case the message is written to email_outbox first, so a recovery
// link is never lost even if delivery fails. Fully free path, no third-party
// account, is the outbox + Mail Queue relay.
import type { D1Database } from "@cloudflare/workers-types";
import { randomId, nowIso } from "../lib/crypto";
import type { Env } from "../lib/env";

// Used as the From address only when a real provider is configured. Keep this
// aligned with a domain you control (your CF zone domain).
const SYSTEM_FROM = "no-reply@wildjazminewellness.ca";

function b64(b: ArrayBuffer | Uint8Array): string {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}

export async function sendEmail(
  env: Env,
  db: D1Database,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  // Always record in the outbox so it's inspectable and testable, and so a
  // recovery link survives even if the provider call below fails.
  const id = randomId("mail");
  await db
    .prepare(`INSERT INTO email_outbox (id, to_addr, subject, body, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, to, subject, body, nowIso())
    .run();

  const markSent = () =>
    db.prepare(`UPDATE email_outbox SET sent_at = ? WHERE id = ?`).bind(nowIso(), id).run();

  // Preferred: Brevo free transactional email (300/day, no credit card).
  if (env.BREVO_API_KEY) {
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": env.BREVO_API_KEY,
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: SYSTEM_FROM, name: env.SITE_NAME || "Wild Jazmine Wellness" },
          to: [{ email: to }],
          subject,
          htmlContent: body,
        }),
      });
      if (!res.ok) console.error("brevo send failed", res.status, await res.text());
      else await markSent();
    } catch (e) {
      console.error("brevo error", e);
    }
    return;
  }

  // Backup: Mailjet Send API v3.1 (200/day, no credit card). Needs both the
  // API key and the secret key; if only one is set we skip to the next path.
  if (env.MAILJET_API_KEY && env.MAILJET_SECRET_KEY) {
    try {
      const auth = "Basic " + b64(
        new TextEncoder().encode(`${env.MAILJET_API_KEY}:${env.MAILJET_SECRET_KEY}`)
      );
      const res = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({
          Messages: [
            {
              From: { Email: SYSTEM_FROM, Name: env.SITE_NAME || "Wild Jazmine Wellness" },
              To: [{ Email: to }],
              Subject: subject,
              HTMLPart: body,
            },
          ],
        }),
      });
      if (!res.ok) console.error("mailjet send failed", res.status, await res.text());
      else await markSent();
    } catch (e) {
      console.error("mailjet error", e);
    }
    return;
  }

  // Legacy fallback: Mailchannels (requires a credit card now — not default).
  if (env.MAILCHANNELS_TOKEN) {
    try {
      const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.MAILCHANNELS_TOKEN },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: SYSTEM_FROM, name: env.SITE_NAME || "Wild Jazmine Wellness" },
          subject,
          content: [{ type: "text/html", value: body }],
        }),
      });
      if (!res.ok) console.error("mailchannels send failed", await res.text());
    } catch (e) {
      console.error("mailchannels error", e);
    }
    return;
  }

  // No provider configured: email stays in the outbox for the operator to relay
  // from the Admin "Mail Queue" tab. No error — recovery is still possible.
}

export function verificationEmailHtml(site: string, link: string): string {
  return `<h1>${site}</h1><p>Verify your email by clicking the link below:</p><p><a href="${link}">${link}</a></p>`;
}

export function resetEmailHtml(site: string, link: string): string {
  return `<h1>${site}</h1><p>Reset your password using the link below. If you didn't request this, ignore the email.</p><p><a href="${link}">${link}</a></p>`;
}

export function inviteEmailHtml(site: string, link: string): string {
  return `<h1>${site}</h1><p>You've been invited. Set your password here:</p><p><a href="${link}">${link}</a></p>`;
}
