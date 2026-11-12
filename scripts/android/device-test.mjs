// On-device checks for the Android app (v1.65).
//
// Everything Android used to be tested in desktop Chromium pretending to be
// the installed app. This drives the REAL app on an Android emulator: it
// attaches to the app's WebView over adb (Playwright's Android support; the
// debug APK has WebView debugging on) and checks what only a phone can show.
//
//   node scripts/android/device-test.mjs              # emulator via adb
//   node scripts/android/device-test.mjs --local URL  # desktop Chromium, for
//                                                     # debugging the checks
//
// Each check is REQUIRED (fails the run) or INFO (reported only). Results go
// to stdout, to GitHub annotations, and to the job summary.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import fs from 'node:fs';

const PKG = 'com.tzeke000.hffieldantenna';
const SITE_URL = 'https://tzeke000.github.io/hfcal/';
const CHERRY_POINT = 'N 34:54:03 W 076:52:50';
const OKINAWA = 'N 26:21:00 E 127:46:00';
const localIdx = process.argv.indexOf('--local');
const LOCAL = localIdx !== -1 ? process.argv[localIdx + 1] : null;

const results = [];
function record(name, level, ok, detail) {
  results.push({ name, level, ok, detail: String(detail == null ? '' : detail).slice(0, 600) });
  console.log(`${ok ? 'PASS' : (level === 'REQUIRED' ? 'FAIL' : 'NOTE')} [${level}] ${name} — ${detail}`);
}
// The app's process id: a change between two checks means the app died and
// Android restarted it — a crash, not a test problem.
async function appPid() { return LOCAL ? 'local' : (await shell(`pidof ${PKG}`)) || 'not running'; }

async function check(name, level, fn) {
  const pid0 = await appPid().catch(() => '?');
  try {
    const r = await fn();
    record(name, level, !!r.ok, r.detail);
  } catch (e) {
    const msg = e && e.message ? e.message.split('\n')[0] : String(e);
    if (!LOCAL && /has been closed|Target closed/i.test(msg)) {
      // The connection to the page dropped. Say whether the APP survived. If
      // it is still running, reattach; if Android shut it down (a small
      // virtual phone frees memory by closing background apps), start it
      // again. Either way try once more and say so: a real crash would crash
      // again and still fail.
      const pid1 = await appPid().catch(() => '?');
      try {
        if (pid1 === 'not running') {
          await openApp();
        } else {
          const wv = await device.webView({ pkg: PKG }, { timeout: 60000 });
          page = await wv.page(); listen(page); page.setDefaultTimeout(20000);
        }
        await page.waitForSelector('button:has-text("CALCULATE")', { timeout: 30000 });
        const r = await fn();
        record(name, level, !!r.ok, `${r.detail} [retried: page connection dropped; app pid ${pid0} -> ${pid1}]`);
        return;
      } catch (e2) {
        record(name, level, false, `threw: ${msg} [retry failed: ${String(e2 && e2.message || e2).split('\n')[0]}; app pid ${pid0} -> ${pid1}]`);
        return;
      }
    }
    record(name, level, false, 'threw: ' + msg);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the device (or a desktop stand-in) ───────────────────────────────────────
let device = null, browser = null, page = null;
const consoleLog = [];
function listen(p) {
  p.on('console', m => consoleLog.push(m.type() + ': ' + m.text().slice(0, 200)));
  p.on('pageerror', e => consoleLog.push('pageerror: ' + String(e).slice(0, 200)));
}

async function shell(cmd) {
  if (!device) return '';
  return String(await device.shell(cmd)).trim();
}

async function openApp() {
  if (LOCAL) {
    const { chromium } = await import('playwright-core');
    browser = browser || await chromium.launch({ executablePath: process.env.HFCALC_CHROMIUM || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(() => { window.androidBridge = { postMessage: function() {}, __test: true }; window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }; });
    page = await ctx.newPage();
    await page.goto(LOCAL, { waitUntil: 'domcontentloaded' });
  } else {
    await shell(`am force-stop ${PKG}`);
    await shell(`am start -W -n ${PKG}/.MainActivity`);
    const wv = await device.webView({ pkg: PKG }, { timeout: 90000 });
    page = await wv.page();
  }
  listen(page);
  page.setDefaultTimeout(20000);
  await page.waitForSelector('button:has-text("CALCULATE")', { timeout: 60000 });
  return page;
}

async function goTab(t) {
  await page.evaluate(t => { const b = document.querySelector(`[data-tab-btn="${t}"]`); if (b) b.click(); }, t);
  await sleep(150);
}

async function openCard(heading) {
  await page.evaluate((heading) => {
    const head = [...document.querySelectorAll('div')].find(e => e.children.length === 0 && e.textContent.trim() === heading);
    const box = head && head.closest('[data-tab]');
    if (box && box.hidden) document.querySelector(`[data-tab-btn="${box.getAttribute('data-tab')}"]`).click();
  }, heading);
  await sleep(150);
  const r = await page.evaluate((heading) => {
    const head = [...document.querySelectorAll('div')].find(e => e.children.length === 0 && e.textContent.trim() === heading);
    if (!head) return 'no heading';
    let row = head;
    for (let i = 0; i < 4 && row; i++) {
      const b = [...row.querySelectorAll('button')].find(x => /^(OPEN|CLOSE)$/.test(x.textContent.trim()));
      if (b) { if (b.textContent.trim() === 'OPEN') b.click(); return 'ok'; }
      row = row.parentElement;
    }
    return 'no toggle';
  }, heading);
  if (r !== 'ok') throw new Error(heading + ': ' + r);
  await sleep(300);
}

async function calculate(from, to) {
  await goTab('plan');
  const inputs = page.locator('input[placeholder*="15T XG"]');
  await inputs.nth(0).fill(from);
  await inputs.nth(1).fill(to);
  await page.getByRole('button', { name: 'CALCULATE', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.usmc-stat-label')].some(e => e.textContent.trim() === 'Distance'), null, { timeout: 30000 });
  return page.evaluate(() => {
    const l = [...document.querySelectorAll('.usmc-stat-label')].find(e => e.textContent.trim() === 'Distance');
    const v = l && l.parentElement.querySelector('.usmc-stat-val');
    return v ? v.textContent.trim() : null;
  });
}

function clickButton(text) {
  return page.evaluate(t => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t && !x.closest('[hidden]'));
    if (!b) return false;
    b.click(); return true;
  }, text);
}

// ── checks ───────────────────────────────────────────────────────────────────
async function run() {
  if (!LOCAL) {
    const { _android } = await import('playwright-core');
    const devs = await _android.devices({ omitDriverInstall: true });
    if (!devs.length) throw new Error('no Android device visible to adb');
    device = devs[0];
    record('device', 'INFO', true, `${device.model()} serial ${device.serial()}, Android ${await shell('getprop ro.build.version.release')}, WebView ${await shell("dumpsys package com.google.android.webview | grep -m1 versionName | sed 's/.*=//'")}`);
  }

  await check('app launches and shows the calculator', 'REQUIRED', async () => {
    await openApp();
    return { ok: true, detail: 'CALCULATE visible' };
  });
  if (!page) return;

  await check('the app knows it is the installed Android app', 'REQUIRED', async () => {
    const r = await page.evaluate(() => ({
      cap: !!window.Capacitor, native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
      platform: window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : null,
      href: location.href,
    }));
    return { ok: r.native, detail: JSON.stringify(r) };
  });

  await check('no offline-save worker inside the APK', 'REQUIRED', async () => {
    await sleep(2500);
    const r = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { sw: 'unsupported', caches: 0 };
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = typeof caches !== 'undefined' ? await caches.keys() : [];
      return { sw: reg ? 'registered' : 'none', caches: keys.length };
    });
    return { ok: r.sw !== 'registered' && r.caches === 0, detail: JSON.stringify(r) };
  });

  await check('header says installed and offline', 'REQUIRED', async () => {
    const t = await page.evaluate(() => document.body.innerText);
    const m = t.match(/Installed app[^\n]*/);
    const install = await page.locator('[data-install-chip]').count();
    return { ok: !!m && install === 0, detail: (m ? m[0] : 'no "Installed app" line') + `; INSTALL chips: ${install}` };
  });

  // v1.66: a real phone counts as an install; this emulator must not, or
  // every update's test run would add a fake install to the count.
  if (!LOCAL) await check('the test phone is not counted as an install', 'REQUIRED', async () => {
    await sleep(3000);
    const r = await page.evaluate(async () => {
      let virtual = null;
      try { virtual = (await window.Capacitor.Plugins.Device.getInfo()).isVirtual; } catch (e) { virtual = 'error: ' + e; }
      return { virtual, counted: localStorage.getItem('hfcalc_beacon_v1'), skipped: localStorage.getItem('hfcalc_beacon_skipped_v1') };
    });
    return { ok: r.virtual === true && !r.counted && r.skipped === 'virtual device', detail: JSON.stringify(r) };
  });

  let dist = null;
  await check('a calculation runs (Cherry Point → Okinawa)', 'REQUIRED', async () => {
    dist = await calculate(CHERRY_POINT, OKINAWA);
    return { ok: !!dist, detail: 'Distance ' + dist };
  });

  await check('the QR encodes the website, not localhost', 'REQUIRED', async () => {
    await openCard('Saved Shots & Export');
    await clickButton('SHOW QR');
    const url = await page.waitForFunction(() => {
      const d = [...document.querySelectorAll('div')].find(e => e.children.length === 0 && /^https?:\/\/\S+\?from=/.test(e.textContent.trim()));
      return d && d.textContent.trim();
    }, null, { timeout: 10000 }).then(h => h.jsonValue());
    await clickButton('HIDE QR');
    return { ok: url.startsWith(SITE_URL + '?from='), detail: url.slice(0, 90) };
  });

  // The one the switch instructions depend on: does EXPORT actually get the
  // comm card somewhere the operator can get it back? (v1.64 and earlier: the
  // app said "DOWNLOADED" and nothing was saved anywhere.)
  async function pasteFromClipboard() {
    if (LOCAL) return page.evaluate(() => navigator.clipboard.readText().catch(e => 'readText failed: ' + e));
    await page.evaluate(() => {
      const t = document.createElement('textarea'); t.id = '__pastebox';
      t.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:60px;z-index:2147483647';
      document.body.appendChild(t); t.focus();
    });
    await sleep(300);
    await shell('input keyevent 279');   // KEYCODE_PASTE
    await sleep(800);
    return page.evaluate(() => { const t = document.getElementById('__pastebox'); const v = t ? t.value : ''; if (t) t.remove(); return v; });
  }
  // Wait (up to 15 s) for the app to be the screen in front again; press BACK
  // once more if the share menu is still up. Android closes it on its own time.
  async function backToApp() {
    for (let i = 0; i < 30; i++) {
      const top = await shell('dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity"');
      if (top.includes(PKG)) return true;
      if (i === 10) await shell('input keyevent 4');
      if (i === 20) await shell(`am start -n ${PKG}/.MainActivity`);
      await sleep(500);
    }
    return false;
  }
  function flashText() {
    return page.evaluate(() => {
      const s = [...document.querySelectorAll('span')].find(e => /^(COPIED|DOWNLOADED|EXPORT FAILED|SENT|NOT SENT|SHOWN ON SCREEN)$/.test(e.textContent.trim()));
      return s ? s.textContent.trim() : '(no message)';
    });
  }

  if (!LOCAL) await check('the app\'s native copy really reaches the clipboard', 'REQUIRED', async () => {
    await backToApp();
    const r = await page.evaluate(async () => {
      const C = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Clipboard;
      if (!C) return 'no Clipboard plugin';
      try { await C.write({ string: 'HFCALC clipboard check' }); return 'ok'; } catch (e) { return 'write failed: ' + e; }
    });
    // Read it back through Android's clipboard (the plugin's read), and by a
    // simulated paste; either one showing the text proves the copy landed.
    // (The paste keypress alone was flaky right after the share menu closed.)
    // Android only lets the FOCUSED app read the clipboard; tap the app's own
    // title bar (harmless) so it has focus, and give it three tries.
    let readBack = '';
    for (let i = 0; r === 'ok' && i < 3 && !readBack.includes('HFCALC clipboard check'); i++) {
      await shell('input tap 300 200');
      await sleep(700);
      readBack = await page.evaluate(async () => {
        try { const v = await window.Capacitor.Plugins.Clipboard.read(); return v && v.value ? v.value : ''; } catch (e) { return 'read failed: ' + e; }
      });
    }
    const pasted = (r === 'ok' && !readBack.includes('HFCALC clipboard check')) ? await pasteFromClipboard() : '';
    const ok = readBack.includes('HFCALC clipboard check') || pasted.includes('HFCALC clipboard check');
    return { ok, detail: `plugin write: ${r}; read back: ${JSON.stringify(readBack.slice(0, 40))}${pasted ? '; pasted: ' + JSON.stringify(pasted.slice(0, 40)) : ''}` };
  });

  if (!LOCAL) await check('EXPORT opens Android\'s share menu with the comm card', 'REQUIRED', async () => {
    await openCard('Saved Shots & Export');
    await clickButton('EXPORT CURRENT');
    await sleep(3000);
    const top = await shell('dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity"');
    const sheet = /Chooser|intentresolver|ResolverActivity/i.test(top);
    await shell('input keyevent 4');   // BACK: close the menu without sending
    const back = await backToApp();
    let after = '(no message)';
    for (let i = 0; i < 10 && after === '(no message)'; i++) { await sleep(300); after = await flashText(); }
    return { ok: sheet && back, detail: `share menu ${sheet ? 'opened' : 'did NOT open'} (${top.replace(/.*ActivityRecord\{\S+ \S+ /, '').replace(/\s+/g, ' ').slice(0, 60)}); after BACK the app said "${after}" and is ${back ? 'back on screen' : 'NOT back'}` };
  });

  if (LOCAL) await check('EXPORT CURRENT really saves the comm card', 'INFO', async () => {
    await openCard('Saved Shots & Export');
    await clickButton('EXPORT CURRENT');
    await sleep(1200);
    const pasted = await pasteFromClipboard();
    return { ok: /HFCALC/.test(pasted), detail: `app said "${await flashText()}"; clipboard ${/HFCALC/.test(pasted) ? 'has it' : 'does not'}` };
  });

  await check('the update check can reach the website', 'REQUIRED', async () => {
    const r = await page.evaluate(async (u) => {
      try { const res = await fetch(u + 'version.json?t=' + Date.now(), { cache: 'no-store' }); return { status: res.status, body: (await res.text()).slice(0, 60) }; }
      catch (e) { return { error: String(e) }; }
    }, SITE_URL);
    return { ok: r.status === 200 && /version/.test(r.body || ''), detail: JSON.stringify(r) };
  });

  if (!LOCAL) await check('a website link opens outside the app', 'INFO', async () => {
    await page.evaluate((u) => {
      const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = 'x'; document.body.appendChild(a); a.click(); a.remove();
    }, SITE_URL);
    await sleep(4000);
    const top = await shell('dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity"');
    const outside = top && !top.includes(PKG);
    await shell('am force-stop com.android.chrome');   // free its memory for the checks after this
    await openApp();
    return { ok: outside, detail: top || '(no resumed activity line)' };
  });

  await check('compass gets a heading', 'INFO', async () => {
    if (!LOCAL) {
      // The emulator's virtual sensors: device lying flat, pointing roughly north.
      await shell('true');
    }
    await openCard('Compass');
    await sleep(4000);
    const sub = await page.evaluate(() => {
      const head = [...document.querySelectorAll('div')].find(e => e.children.length === 0 && e.textContent.trim() === 'Compass');
      return head && head.nextElementSibling ? head.nextElementSibling.textContent.trim() : '(no subtitle)';
    });
    return { ok: /MAG/.test(sub), detail: sub };
  });

  await check('the photo scanner\'s files load inside a background worker', 'INFO', async () => {
    const r = await page.evaluate(async () => {
      const base = new URL('ocr/', location.href).href;
      // Android's packager unzips .gz assets and drops the extension.
      const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.androidBridge && !window.androidBridge.__test);
      const files = ['worker.min.js', 'tesseract-core-lstm.wasm.js', native ? 'eng.traineddata' : 'eng.traineddata.gz'];
      const main = {};
      for (const f of files) {
        try { const res = await fetch(base + f); main[f] = res.status + ' ' + (await res.arrayBuffer()).byteLength; }
        catch (e) { main[f] = 'ERR ' + e; }
      }
      const src = 'onmessage = async (e) => { const out = {}; for (const u of e.data) { try { const r = await fetch(u); out[u.split("/").pop()] = r.status + " " + (await r.arrayBuffer()).byteLength; } catch (err) { out[u.split("/").pop()] = "ERR " + err; } } try { importScripts(e.data[0]); out.importScripts = "ok"; } catch (err) { out.importScripts = "ERR " + err; } postMessage(out); };';
      let w;
      try { w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); }
      catch (e) { return { main, worker: 'cannot start: ' + e }; }
      const worker = await new Promise(res => {
        w.onmessage = e => res(e.data); w.onerror = e => res({ error: e.message || 'error' });
        setTimeout(() => res({ timeout: true }), 30000);
        w.postMessage(files.map(f => base + f));
      });
      w.terminate();
      return { main, worker };
    });
    const ok = r.worker && Object.values(r.worker).every(v => v === 'ok' || /^200 /.test(v));
    return { ok, detail: JSON.stringify(r) };
  });

  await check('DAGR photo scan reads a grid (OCR, offline engine)', LOCAL ? 'INFO' : 'REQUIRED', async () => {
    consoleLog.length = 0;
    await goTab('plan');
    const t0 = Date.now();
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 220;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#000'; g.font = 'bold 54px monospace';
      g.fillText('N 39:11:24.3', 30, 90); g.fillText('W 077:30:15.0', 30, 170);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const input = document.querySelectorAll('input[type=file]')[1];   // TARGET STATION's scanner
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'dagr.png', { type: 'image/png' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const msg = await page.waitForFunction(() => {
      const d = [...document.querySelectorAll('div')].find(e => e.children.length === 0 && /Read from image|No grid found|Could not read that image/.test(e.textContent));
      return d && d.textContent.trim();
    }, null, { timeout: 90000 }).then(h => h.jsonValue()).catch(e => { throw new Error('no result in 90 s; console: ' + consoleLog.slice(-12).join(' || ')); });
    const val = await page.locator('input[placeholder*="15T XG"]').nth(1).inputValue();
    return { ok: /Read from image/.test(msg), detail: `${Math.round((Date.now() - t0) / 1000)} s; "${msg.slice(0, 70)}"; field now "${val}"` };
  });

  if (!LOCAL) await check('works with no signal (airplane mode, cold start)', 'REQUIRED', async () => {
    await shell('cmd connectivity airplane-mode enable');
    await shell('svc wifi disable'); await shell('svc data disable');
    await sleep(3000);
    await openApp();
    const net = await page.evaluate(async (u) => { try { await fetch(u + 'version.json?t=' + Date.now(), { cache: 'no-store' }); return 'ONLINE'; } catch (e) { return 'offline'; } }, SITE_URL);
    const d = await calculate(OKINAWA, CHERRY_POINT);
    const detail = await page.evaluate(() => document.body.innerText.match(/Installed app[^\n]*/) ? 'installed line shown' : 'no installed line');
    await shell('cmd connectivity airplane-mode disable');
    await shell('svc wifi enable'); await shell('svc data enable');
    return { ok: net === 'offline' && d === dist, detail: `network ${net}; Distance ${d} (online run: ${dist}); ${detail}` };
  });
}

let fatal = null;
try { await run(); } catch (e) { fatal = e; record('harness', 'REQUIRED', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
if (!LOCAL && device) {
  try { fs.writeFileSync('device-final.png', await device.screenshot()); } catch (e) { /* best effort */ }
  // Android's own log: crashes, WebView renderer deaths, Capacitor plugin errors.
  try {
    const log = await shell('logcat -d -v time -t 4000');
    const keep = log.split('\n').filter(l => /AndroidRuntime|FATAL|crash|Crash|chromium|Capacitor|libc|DEBUG|hffieldantenna|died|Renderer|lowmemorykiller|lmkd|Killing|kill/i.test(l));
    fs.writeFileSync('logs-logcat.txt', keep.slice(-1500).join('\n'));
  } catch (e) { /* best effort */ }
}
try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
try { if (device) device.close(); } catch (e) { /* ignore */ }

// Report: annotations (readable at a glance) + job summary + JSON.
const failed = results.filter(r => r.level === 'REQUIRED' && !r.ok);
fs.writeFileSync('device-report.json', JSON.stringify(results, null, 2));
if (process.env.GITHUB_ACTIONS) {
  // GitHub shows at most 10 notices per step, so: every problem, then one
  // line for everything that passed. The full table is in the job summary.
  for (const r of results.filter(x => !x.ok)) {
    const kind = r.level === 'REQUIRED' ? 'error' : 'warning';
    const msg = (r.detail || '').replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
    console.log(`::${kind} title=NOT OK ${r.name.replace(/[:,]/g, ' ')}::${msg}`);
  }
  console.log(`::notice title=Device checks passed::${results.filter(x => x.ok).map(x => x.name.replace(/[:,]/g, ' ')).join(' / ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['## Android device checks', '', '| | Check | Level | Detail |', '|---|---|---|---|']
      .concat(results.map(r => `| ${r.ok ? '✅' : (r.level === 'REQUIRED' ? '❌' : '⚠️')} | ${r.name} | ${r.level} | ${(r.detail || '').replace(/\|/g, '\\|')} |`));
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}
console.log(`\n${results.length} checks, ${failed.length} required failures`);
process.exit(failed.length || fatal ? 1 : 0);
