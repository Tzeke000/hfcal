// Browser-test harness.
//
// Every unit test in this repo covers a pure function. Every bug an operator
// actually reported — the compass freezing after you closed and re-opened it,
// a deleted shot coming back, two saves sharing one id — lived in React state
// and could not be reached by any of them. This harness exists so those flows
// can be tested the way they are used: in a browser, by clicking.
//
// It is deliberately dependency-light: playwright-core drives a Chromium that
// is already on the machine. If either is missing the suite SKIPS rather than
// fails, so `npm test` stays green on a box that has no browser.

import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ── Locating a browser ────────────────────────────────────────────────────────
// Checked in order: an explicit override, the shared image location, then
// Playwright's own download cache.
function findChromium() {
  if (process.env.HFCALC_CHROMIUM) {
    return existsSync(process.env.HFCALC_CHROMIUM) ? process.env.HFCALC_CHROMIUM : null;
  }
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers',
    join(process.env.HOME || '', '.cache/ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const direct = join(root, 'chromium');
    if (existsSync(direct) && !isDir(direct)) return direct;
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue;
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-win/chrome.exe']) {
        const p = join(root, entry, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

export function browserAvailable() {
  var why = null;
  try { require.resolve('playwright-core'); } catch { why = 'playwright-core is not installed'; }
  if (!why && !findChromium()) why = 'no Chromium binary found (set HFCALC_CHROMIUM)';
  // Skipping is the right default on a developer box with no browser. It is the
  // WRONG default in CI, where a silent skip reports success for work that did
  // not happen — the same defect as a validation mirror quietly falling back to
  // a rougher model. CI sets HFCALC_REQUIRE_BROWSER=1 and this turns fatal.
  if (why && process.env.HFCALC_REQUIRE_BROWSER === '1') {
    throw new Error('browser tests are required here but cannot run: ' + why);
  }
  return why;
}

// ── Serving the built app ─────────────────────────────────────────────────────
// The tests run against `dist/`, not the dev server: that is what ships, and
// it is what the service worker precaches.
const PORT = Number(process.env.HFCALC_PORT || 4179);
export const BASE_URL = process.env.HFCALC_URL || `http://127.0.0.1:${PORT}/`;

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.bin': 'application/octet-stream',
  '.txt': 'text/plain', '.wasm': 'application/wasm',
};

let server = null;

// A plain static file server. Using vite preview would tie the browser tests
// to the build tool's CLI layout; serving dist/ directly does not.
export async function startServer() {
  if (process.env.HFCALC_URL) return;           // caller is serving it themselves
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('dist/ is missing — run `npm run build` first');
  }
  server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, rel);
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
}

export async function stopServer() {
  if (!server) return;
  await new Promise(r => server.close(r));
  server = null;
}

// ── Browser lifecycle ─────────────────────────────────────────────────────────
export async function launch() {
  const { chromium } = await import('playwright-core');
  return chromium.launch({ executablePath: findChromium() });
}

// A fresh page with its own storage, plus a live list of anything the page
// logged as an error. Network failures are filtered out: the space-weather
// feed is expected to fail on a machine with no internet, and the whole point
// of the app is that it still works when it does.
export async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_|ERR_TUNNEL/.test(t)) return;
    errors.push(`${m.type()}: ${t}`);
  });
  page.errors = errors;
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button:has-text("CALCULATE")', { timeout: 15000 });
  return page;
}

// ── Page helpers ──────────────────────────────────────────────────────────────

// Click the OPEN/CLOSE button belonging to a named card. Every collapsible in
// the app follows the same shape — a heading and a toggle in one flex row — so
// walking up from the heading text finds the right button unambiguously.
export async function toggleCard(page, heading, want /* 'OPEN' | 'CLOSE' */) {
  const result = await page.evaluate(({ heading, want }) => {
    const head = [...document.querySelectorAll('div')]
      .find(e => e.children.length === 0 && e.textContent.trim() === heading);
    if (!head) return 'no heading: ' + heading;
    let row = head;
    for (let i = 0; i < 4 && row; i++) {
      const btns = [...row.querySelectorAll('button')].filter(b => /^(OPEN|CLOSE)$/.test(b.textContent.trim()));
      if (btns.length) {
        const btn = btns[0];
        const state = btn.textContent.trim();
        if (want && state !== want) return 'already ' + (state === 'OPEN' ? 'closed' : 'open');
        btn.click();
        return 'clicked';
      }
      row = row.parentElement;
    }
    return 'no toggle for: ' + heading;
  }, { heading, want });
  if (result.startsWith('no ')) throw new Error(result);
  await page.waitForTimeout(250);
  return result;
}

// Read a Link Analysis stat ("Distance", "Bearing To Target", ...) by its label.
export function statVal(page, label) {
  return page.evaluate((lbl) => {
    const hit = [...document.querySelectorAll('.usmc-stat-label')]
      .find(e => e.textContent.trim() === lbl);
    if (!hit) return null;
    const v = hit.parentElement.querySelector('.usmc-stat-val');
    return v ? v.textContent.trim() : null;
  }, label);
}

// Fill both location fields and run the calculation.
export async function calculate(page, from, to) {
  const inputs = page.locator('input[placeholder*="15T XG"]');
  if (await inputs.count() < 2) throw new Error('expected two location inputs');
  await inputs.nth(0).fill(from);
  await inputs.nth(1).fill(to);
  await page.getByRole('button', { name: 'CALCULATE', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.usmc-stat-label')].some(e => e.textContent.trim() === 'Distance'),
    null, { timeout: 10000 });
}

// LUF / FOT / MUF out of the open Frequency Check panel, as numbers.
export function readFrequencies(page) {
  return page.evaluate(() => {
    const out = {};
    for (const lbl of ['LUF', 'FOT', 'MUF']) {
      const hit = [...document.querySelectorAll('div')]
        .find(e => e.children.length === 0 && e.textContent.trim() === lbl);
      if (hit && hit.nextElementSibling) out[lbl] = parseFloat(hit.nextElementSibling.textContent);
    }
    return out;
  });
}
