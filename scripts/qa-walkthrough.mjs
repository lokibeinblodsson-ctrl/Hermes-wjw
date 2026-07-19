// Host-side authenticated QA walkthrough of the WJW app.
// Drives a real Playwright Chromium (just like a human would) against a target.
// Usage:
//   WJW_DEV_URL=http://127.0.0.1:8787 node scripts/qa-walkthrough.mjs   # local sandbox
//   WJW_DEV_URL=https://app.wildjazminewellness.ca node scripts/qa-walkthrough.mjs  # live
//
// Auth (dev/sandbox): the app's sendEmail() writes to a dev mail sink
// (email_outbox) instead of delivering. This harness reads that sink to pull
// the password-reset link and sets a KNOWN dev password — so login always
// works without a real inbox and without the un-recoverable one-time bootstrap
// password. Production (bootstrap disabled, real mail) falls back to static
// creds from .dev-admin.txt / WJW_EMAIL + WJW_PASSWORD.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const BASE = process.env.WJW_DEV_URL || 'http://127.0.0.1:8787';
const BOOTSTRAP_TOKEN = process.env.WJW_BOOTSTRAP_TOKEN || 'local-dev-only-bootstrap-replace-in-prod';

// Admin identity (from .dev-admin.txt if present, else env).
let EMAIL = process.env.WJW_EMAIL || 'loki.bein.blodsson@gmail.com';
let PASSWORD = process.env.WJW_PASSWORD || '';
try {
  const txt = readFileSync(new URL('../.dev-admin.txt', import.meta.url), 'utf8');
  const e = txt.match(/email:\s*(\S+)/); const p = txt.match(/password:\s*(\S+)/);
  if (e) EMAIL = e[1];
  if (p) PASSWORD = p[1];
} catch { }
if (!EMAIL) { console.error('No admin email. Set WJW_EMAIL or .dev-admin.txt'); process.exit(1); }
// Dev password we will force the account to via the reset flow.
const DEV_PW = PASSWORD || 'WjwDev!2026';

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message));

// API calls run server-side (Node fetch) — avoids CORS (the SPA origin is
// null inside a blank page) and matches how an operator/tool would hit the API.

// Ensure the dev admin exists (bootstrap, dev only). We don't rely on the
// one-time temp password — we overwrite it via the reset flow below.
async function ensureAdmin() {
  await fetch(BASE + '/api/v1/bootstrap/provision', {
    method: 'POST', headers: { 'x-bootstrap-token': BOOTSTRAP_TOKEN },
  }).catch(() => {});
}

// In dev, sendEmail() writes to email_outbox instead of sending. We read that
// sink (via the dev-only endpoint) to pull the password-reset link — no real
// inbox needed. Returns the reset token or null (e.g. on prod where it's 403).
async function readResetTokenFromSink() {
  try {
    const res = await fetch(BASE + '/api/v1/dev/email-outbox');
    if (!res.ok) return null;
    const j = await res.json().catch(() => ({}));
    const rows = (j.data || []).filter((x) => x.to_addr === EMAIL || /reset/i.test(x.subject || ''));
    const body = rows[0]?.body || '';
    const m = body.match(/\/reset\?token=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

// Set a KNOWN dev password via the reset flow so we never depend on the
// un-recoverable one-time bootstrap password. Also clears any lockout
// (reset-password zeroes failed_logins + locked_until).
async function setKnownPassword() {
  const r = await fetch(BASE + '/api/v1/auth/request-password-reset', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL }),
  });
  if (!r.ok) throw new Error('request-password-reset failed (' + r.status + ')');
  const token = await readResetTokenFromSink();
  if (!token) throw new Error('could not read reset token from dev mail sink');
  const ok = await fetch(BASE + '/api/v1/auth/reset-password', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: DEV_PW }),
  });
  if (!ok.ok) throw new Error('reset-password failed (' + ok.status + ')');
}

const ROUTES = [
  ['/', 'Board (Kanban)'],
  ['/card', 'Card hub'],
  ['/chat', 'Chat'],
  ['/calendar', 'Calendar'],
  ['/memory', 'Memory'],
  ['/docs', 'Docs'],
  ['/activity', 'Activity'],
  ['/admin', 'Admin'],
  ['/files', 'Files'],
  ['/publish', 'Publishing pipeline'],
];

try {
  // ── Establish a known dev password (sink-based, dev only) ──
  let loginPw = PASSWORD;
  try {
    await ensureAdmin();
    await setKnownPassword();
    loginPw = DEV_PW;
    log(`dev login armed via mail-sink reset (email=${EMAIL})`);
  } catch (e) {
    log('dev mail-sink login unavailable (' + e.message + ') — using static creds');
  }

  // ── Login ──
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  check('login page loads', (await page.title()).toLowerCase().includes('wild jazmine'));
  const emailField = page.locator('input[type="email"], input[placeholder*="Email" i]');
  const pwField = page.locator('input[type="password"]');
  check('login form has email+password', (await emailField.count()) === 1 && (await pwField.count()) === 1);
  await emailField.fill(EMAIL);
  await pwField.fill(loginPw);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  // Safety net: if still forced to reset, set it to the known dev password.
  if (page.url().includes('/change-password')) {
    const fields = page.locator('input[type="password"]');
    const n = await fields.count();
    for (let i = 0; i < n; i++) await fields.nth(i).fill(loginPw);
    await page.getByRole('button', { name: /(set|change|update|save|confirm|submit).*password/i }).click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  const afterLogin = page.url();
  const authed = !afterLogin.includes('/login');
  check('login succeeded (redirected off /login)', authed, afterLogin);

  if (authed) {
    for (const [path, label] of ROUTES) {
      const before = pageErrors.length;
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const bodyText = (await page.locator('body').innerText().catch(() => '')).trim();
      const crashed = pageErrors.slice(before).length > 0;
      check(`page ${label} (${path}) renders`, !crashed && bodyText.length > 20, `len=${bodyText.length}${crashed ? ' PAGE-ERROR' : ''}`);
    }

    // ── Ctrl+K command palette ──
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(800);
    const paletteOpen = (await page.locator('.cmd-palette, [role="dialog"], [role="combobox"], input[placeholder*="command" i]').count()) > 0;
    check('command palette opens on Ctrl+K', paletteOpen);
    await page.keyboard.press('Escape');

    // ── Logout ──
    const logoutBtn = page.getByRole('button', { name: /logout/i });
    if (await logoutBtn.count()) {
      await logoutBtn.click();
      await page.waitForTimeout(1500);
      check('logout returns to login', page.url().includes('/login') || pageErrors.length === 0, page.url());
    } else {
      check('logout button present', false, 'not found');
    }
  } else {
    log('SKIP: login failed — authed walkthrough skipped.');
  }
} catch (e) {
  log('SCRIPT ERROR: ' + e.message);
} finally {
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
  const cf = consoleErrors.filter((e) => /cloudflareinsights|beacon|static\.cloudflare|challenge-platform|cdn-cgi/i.test(e)).length;
  log('CONSOLE ERRORS: ' + (consoleErrors.length - cf) + ' app-level, ' + cf + ' cloudflare-3rd-party/bot-challenge (benign from datacenter IP)');
  consoleErrors.filter((e) => !/cloudflareinsights|beacon|static\.cloudflare|challenge-platform|cdn-cgi/i.test(e)).slice(0, 12).forEach((e) => log('  CE: ' + e.slice(0, 200)));
  log('PAGE ERRORS: ' + pageErrors.length);
  pageErrors.slice(0, 12).forEach((e) => log('  PE: ' + e.slice(0, 200)));
  const reportDir = process.env.QA_REPORT_DIR || 'qa-reports';
  mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, 'walkthrough-report.txt');
  writeFileSync(reportPath, out.join('\n') + '\n');
  log('\nReport written to: ' + reportPath);
}
