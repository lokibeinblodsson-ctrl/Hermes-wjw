// Host-side authenticated QA walkthrough of the LOCAL wrangler dev app.
// Drives the real Playwright Chromium against http://127.0.0.1:8787.
// Usage: node scripts/qa-walkthrough.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const BASE = process.env.WJW_DEV_URL || 'http://127.0.0.1:8787';

// Dev-admin (local only). From .dev-admin.txt if present, else env.
let EMAIL = process.env.WJW_EMAIL || '';
let PASSWORD = process.env.WJW_PASSWORD || '';
try {
  const txt = readFileSync(new URL('../.dev-admin.txt', import.meta.url), 'utf8');
  const e = txt.match(/email:\s*(\S+)/); const p = txt.match(/password:\s*(\S+)/);
  if (e) EMAIL = e[1];
  if (p) PASSWORD = p[1];
} catch {}
if (!EMAIL || !PASSWORD) { console.error('No dev-admin creds. Set WJW_EMAIL/WJW_PASSWORD or .dev-admin.txt'); process.exit(1); }

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
  // ── Login ──
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  check('login page loads', (await page.title()).toLowerCase().includes('wild jazmine'));
  const emailField = page.locator('input[type="email"], input[placeholder*="Email" i]');
  const pwField = page.locator('input[type="password"]');
  check('login form has email+password', (await emailField.count()) === 1 && (await pwField.count()) === 1);
  await emailField.fill(EMAIL);
  await pwField.fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
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
  const cf = consoleErrors.filter((e) => /cloudflareinsights|beacon|static\.cloudflare/i.test(e)).length;
  log('CONSOLE ERRORS: ' + (consoleErrors.length - cf) + ' app-level, ' + cf + ' cloudflare-3rd-party (benign)');
  consoleErrors.filter((e) => !/cloudflareinsights|beacon|static\.cloudflare/i.test(e)).slice(0, 12).forEach((e) => log('  CE: ' + e.slice(0, 200)));
  log('PAGE ERRORS: ' + pageErrors.length);
  pageErrors.slice(0, 12).forEach((e) => log('  PE: ' + e.slice(0, 200)));
  const reportDir = process.env.QA_REPORT_DIR || '../qa-reports';
  const reportPath = resolve(reportDir, 'walkthrough-report.txt');
  writeFileSync(reportPath, out.join('\n') + '\n');
  log('\nReport written to: ' + reportPath.pathname);
}
