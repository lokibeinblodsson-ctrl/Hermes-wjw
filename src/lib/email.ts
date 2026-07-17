// Email service. In dev/test it writes to the email_outbox table (a local sink) —
// no real SMTP credentials are used. In production, if MAILCHANNELS_TOKEN is set,
// it delivers via Cloudflare MailChannels (token stored as a secret, never in code).
import type { D1Database } from "@cloudflare/workers-types";
import { randomId, nowIso } from "../lib/crypto";
import type { Env } from "../lib/env";

const SYSTEM_FROM = "no-reply@wildjazmine.app";

export async function sendEmail(
  env: Env,
  db: D1Database,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  // Always record in the outbox so it's inspectable and testable.
  await db
    .prepare(`INSERT INTO email_outbox (id, to_addr, subject, body, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(randomId("mail"), to, subject, body, nowIso())
    .run();

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
  }
  // If no MAILCHANNELS_TOKEN, email stays in the outbox (dev sink). No error.
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
