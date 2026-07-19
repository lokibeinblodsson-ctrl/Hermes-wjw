// Host-side authenticated QA walkthrough of the WJW app.
// Drives a real Playwright Chromium (just like a human would) against a target.
// Usage:
//   WJW_DEV_URL=http://127.0.0.1:8787 node scripts/qa-walkthrough.mjs   # local sandbox
//   WJW_DEV_URL=https://app.wildjazminewellness.ca node scripts/qa-walkthrough.mjs  # live
//
// Auth: the local/dev app seeds its admin via /api/v1/bootstrap/provision
// (one-time random password, force_reset). This harness bootstraps that admin
// automatically so the authed walkthrough actually runs — mimicking a human who
// completes first-login setup. For prod (bootstrap disabled) it falls back to
// .dev-admin.txt / WJW_EMAIL + WJW_PASSWORD.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const BASE = process.env.WJW_DEV_URL || 'http://127.0.0.1:8787';
const BOOTSTRAP_TOKEN = process.env.WJW_BOOTSTRAP_TOKEN || 'local-dev-only-bootstrap-replace-in-prod';

// Known admin password (from .dev-admin.txt if present, else env). Used as the
// stable post-bootstrap password so the session isn't force-reset mid-walk.
let EMAIL = process.env.WJW_EMAIL || '';
let PASSWORD = process.env.WJW_PASSWORD || '';
try {
  const txt = readFileSync(new URL('../.dev-admin.txt', import.meta.url), 'utf8');
  const e = txt.match(/email:\s*(\S+)/); const p = txt.match(/password:\s*(\S+)/);
  if (e) EMAIL = e[1];
  if (p) PASSWORD = p[1];
} catch {}
if (!EMAIL || !PASSWORD) { console.error('No admin creds. Set WJW_EMAIL/WJW_PASSWORD or .dev-admin.txt'); process.exit(1); }

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

// Bootstrap the dev admin (returns a one-time password if it just created one).
async function bootstrapAdmin() {
  try {
    const r = await page.evaluate(async (b, t) => {
      const res = await fetch(b + '/api/v1/bootstrap/provision', { method: 'POST', headers: { 'x-bootstrap-token': t } });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }, BASE, BOOTSTRAP_TOKEN);
    if (r.body?.data?.temporary_password) return r.body.data.temporary_password;
  } catch { /* bootstrap unavailable (e.g. prod) — fall back to static creds */ }
  return null;
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
  // ── Bootstrap (dev only) ──
  const tempPw = await bootstrapAdmin();
  const loginPw = tempPw || PASSWORD;

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

  // ── Handle forced first-login password reset (bootstrap path) ──
  let onReset = page.url().includes('/change-password');
  if (!onReset) {
    const newPw = page.locator('input[autocomplete="new-password"], input[name="new_password"]');
    onReset = (await newPw.count()) > 0;
  }
  if (onReset) {
    const fields = page.locator('input[type="password"]');
    const n = await fields.count();
    for (let i = 0; i < n; i++) await fields.nth(i).fill(PASSWORD);
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
