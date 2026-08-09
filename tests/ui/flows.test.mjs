// Browser tests for the flows that have actually broken in the field.
//
// Each case below corresponds to a bug an operator hit and reported, not to a
// hypothetical. They are written against the built app so what is tested is
// what ships. See harness.mjs for why these exist alongside the unit tests.
//
// Run with:  npm run test:ui   (builds first, serves dist/, drives Chromium)

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserAvailable, startServer, stopServer, launch, newPage,
  toggleCard, statVal, calculate, readFrequencies, BASE_URL,
} from './harness.mjs';

const unavailable = browserAvailable();
const SKIP = unavailable ? `browser tests skipped: ${unavailable}` : false;
const CHERRY_POINT = 'N 34:54:03 W 076:52:50';
const OKINAWA = 'N 26:21:00 E 127:46:00';

let browser = null;

before(async () => {
  if (unavailable) return;
  await startServer();
  browser = await launch();
}, { timeout: 120000 });

after(async () => {
  if (browser) await browser.close();
  await stopServer();
});

// Feed the page a synthetic magnetometer reading. Chromium has no compass, so
// the app's own listener is driven directly — which is the part under test.
async function sendHeading(page, alpha) {
  await page.evaluate((a) => {
    const ev = new DeviceOrientationEvent('deviceorientationabsolute',
      { alpha: a, beta: 0, gamma: 0, absolute: true });
    window.dispatchEvent(ev);
  }, alpha);
  await page.waitForTimeout(120);
}

function compassSubtitle(page) {
  return page.evaluate(() => {
    const head = [...document.querySelectorAll('div')]
      .find(e => e.children.length === 0 && e.textContent.trim() === 'Compass');
    return head && head.nextElementSibling ? head.nextElementSibling.textContent.trim() : null;
  });
}

describe('compass', { skip: SKIP, concurrency: 1 }, () => {
  // The reported bug: close the card, walk somewhere, open it again, and the
  // needle stays pointed wherever you were standing when you closed it.
  // Closing detaches the sensor listeners, so re-opening has to re-attach.
  test('re-opening re-arms the sensor instead of freezing on the old heading', async () => {
    const page = await newPage(browser);

    await toggleCard(page, 'Compass', 'OPEN');
    await sendHeading(page, 90);                    // alpha 90 -> 270 magnetic
    assert.match(await compassSubtitle(page), /270° MAG/);

    await toggleCard(page, 'Compass', 'CLOSE');
    const closed = await compassSubtitle(page);
    assert.doesNotMatch(closed, /MAG/, 'a closed compass must not keep showing a heading');

    await toggleCard(page, 'Compass', 'OPEN');
    await sendHeading(page, 180);                   // alpha 180 -> 180 magnetic
    const reopened = await compassSubtitle(page);
    assert.match(reopened, /180° MAG/, 'heading is frozen at the pre-close value');

    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  // It is a compass first: it must not require a calculation to work.
  test('opens with no calculation run', async () => {
    const page = await newPage(browser);
    await toggleCard(page, 'Compass', 'OPEN');
    await sendHeading(page, 0);
    assert.match(await compassSubtitle(page), /0° MAG/);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('saved shots', { skip: SKIP, concurrency: 1 }, () => {
  async function shotCount(page) {
    return page.evaluate(() =>
      [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '✕').length);
  }
  async function storedShots(page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem('hfcalc_shots_v1') || '[]'));
  }

  // Two saves inside the same millisecond used to share one id. A shared id
  // meant deleting either removed both, and React saw duplicate keys.
  test('five saves produce five rows with five distinct ids', async () => {
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    await toggleCard(page, 'Saved Shots & Export', 'OPEN');

    // Clicked without awaiting between them: same millisecond, on purpose.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'SAVE CURRENT');
      for (let i = 0; i < 5; i++) btn.click();
    });
    await page.waitForTimeout(400);

    assert.equal(await shotCount(page), 5);
    const ids = (await storedShots(page)).map(s => s.id);
    assert.equal(ids.length, 5);
    assert.equal(new Set(ids).size, 5, 'saved shots share an id');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  // The reported bug: delete several shots quickly and one of them comes back
  // on the next render, because each handler filtered the same stale snapshot.
  test('three rapid deletions remove exactly three shots, and they stay gone', async () => {
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    await toggleCard(page, 'Saved Shots & Export', 'OPEN');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'SAVE CURRENT');
      for (let i = 0; i < 5; i++) btn.click();
    });
    await page.waitForTimeout(400);
    const before = (await storedShots(page)).map(s => s.id);
    assert.equal(before.length, 5);

    // Three taps against one pre-delete DOM, with no render in between.
    await page.evaluate(() => {
      const xs = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '✕');
      xs[0].click(); xs[2].click(); xs[4].click();
    });
    await page.waitForTimeout(400);

    assert.equal(await shotCount(page), 2, 'a rapid delete dropped or resurrected a shot');
    const after = (await storedShots(page)).map(s => s.id);
    assert.deepEqual(after, [before[1], before[3]]);

    // And they must not come back when the app is restarted.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:has-text("CALCULATE")');
    await toggleCard(page, 'Saved Shots & Export', 'OPEN');
    assert.equal(await shotCount(page), 2, 'deleted shots came back after a reload');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('CLEAR SAVED DATA empties the list and the store', async () => {
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    await toggleCard(page, 'Saved Shots & Export', 'OPEN');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'SAVE CURRENT');
      btn.click(); btn.click();
    });
    await page.waitForTimeout(400);
    assert.equal(await shotCount(page), 2);

    await page.evaluate(() => {
      [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim().startsWith('CLEAR SAVED DATA')).click();
    });
    await page.waitForTimeout(400);
    assert.equal(await shotCount(page), 0);
    assert.deepEqual(await storedShots(page), []);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('frequency check', { skip: SKIP, concurrency: 1 }, () => {
  async function openFreqCheck(page) {
    await calculate(page, CHERRY_POINT, OKINAWA);
    await toggleCard(page, 'Frequency Check', 'OPEN');
  }
  async function pickMonth(page, abbr) {
    await page.evaluate((m) => {
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === m).click();
    }, abbr);
    await page.waitForTimeout(250);
  }
  async function pickPower(page, label) {
    await page.evaluate((l) => {
      [...document.querySelectorAll('button')]
        .find(b => b.firstElementChild && b.firstElementChild.textContent.trim() === l).click();
    }, label);
    await page.waitForTimeout(250);
  }

  test('LUF, FOT and MUF are ordered and plausible on a real long path', async () => {
    const page = await newPage(browser);
    await openFreqCheck(page);

    // Cherry Point to Okinawa is a known 12,500 km great circle. If the
    // geometry is wrong the frequencies below are meaningless.
    const km = parseFloat((await statVal(page, 'Distance')).replace(/,/g, ''));
    assert.ok(Math.abs(km - 12500) < 300, `Cherry Point → Okinawa came out ${km} km`);

    const f = await readFrequencies(page);
    for (const k of ['LUF', 'FOT', 'MUF']) {
      assert.ok(Number.isFinite(f[k]), `${k} did not render a number`);
      assert.ok(f[k] > 0 && f[k] < 60, `${k} = ${f[k]} MHz is off the HF band`);
    }
    assert.ok(f.FOT < f.MUF, 'FOT must sit below the MUF');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  // The seasonal term is the whole reason the month wheel exists. If every
  // month gives the same answer, the wheel is wired to nothing.
  test('the month wheel actually moves the MUF', async () => {
    const page = await newPage(browser);
    await openFreqCheck(page);
    const seen = [];
    for (const m of ['JAN', 'APR', 'JUL', 'OCT']) {
      await pickMonth(page, m);
      seen.push((await readFrequencies(page)).MUF);
    }
    assert.ok(seen.every(Number.isFinite), `month wheel produced ${seen}`);
    assert.ok(new Set(seen).size > 1, 'MUF is identical in every season');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  // Power moves the LUF and nothing else. Both halves of that are asserted:
  // a regression that let watts leak into the MUF would pass a one-sided test.
  test('power lowers the LUF and leaves the MUF alone', async () => {
    const page = await newPage(browser);
    await openFreqCheck(page);

    await pickPower(page, 'LOW');
    const low = await readFrequencies(page);
    await pickPower(page, 'VRC');
    const high = await readFrequencies(page);

    assert.ok(high.LUF < low.LUF, `150 W LUF ${high.LUF} should beat 2 W LUF ${low.LUF}`);
    assert.equal(high.MUF, low.MUF, 'transmit power must not move the MUF');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  // Added v1.28. foF2Source() had existed since v1.20 with a comment saying it
  // was "surfaced so the UI can say so rather than quietly varying in accuracy"
  // — and it was wired to nothing. The app ran at 1.2% or 7.4% on the critical
  // frequency depending on whether a 709 KB asset had loaded, and never said
  // which. This asserts the operator is now told.
  test('the panel states which ionospheric data source is live', async () => {
    const page = await newPage(browser);
    await openFreqCheck(page);
    const note = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find(e =>
        e.children.length === 0 && /ionospheric table loaded|built-in fallback model/.test(e.textContent));
      return el ? el.textContent.trim() : null;
    });
    assert.ok(note, 'the panel never says which data source it is using');
    // dist/ precaches the table, so the built app must report the good one.
    assert.match(note, /Full ionospheric table loaded/);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  // Turn the power right down on a long path and the floor should cross the
  // ceiling. When it does the operator must be told outright, not left to
  // compare two numbers.
  test('the PATH CLOSED banner appears exactly when the LUF exceeds the MUF', async () => {
    const page = await newPage(browser);
    await openFreqCheck(page);
    await pickPower(page, 'LOW');
    for (const m of ['JAN', 'APR', 'JUL', 'OCT']) {
      await pickMonth(page, m);
      const f = await readFrequencies(page);
      const banner = await page.locator('text=PATH CLOSED AT THIS POWER').count();
      assert.equal(banner > 0, f.LUF > f.MUF,
        `${m}: banner=${banner > 0} but LUF ${f.LUF} vs MUF ${f.MUF}`);
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('cards that had no test at all', { skip: SKIP, concurrency: 1 }, () => {
  // SpaceWxCard, ImageCarousel, InvVGeoCalc, UpdateBanner and InstallBanner
  // were never touched by any test at any level. They hold exactly the kind of
  // React state the compass bug lived in, and the compass bug is the reason
  // this file exists. This does not test what they compute — it tests that
  // they mount, survive being driven, and do not throw.

  test('the space weather card opens and reports its own freshness', async () => {
    const page = await newPage(browser);
    // The card only mounts once there is a path to report on.
    await calculate(page, CHERRY_POINT, OKINAWA);
    // No network here, so it must fall back rather than break — which is the
    // whole promise of an offline app.
    const txt = await page.evaluate(() => document.body.innerText);
    assert.match(txt, /NOAA SWPC|SOLAR|default solar/i,
      'the space weather card did not render at all');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('the antenna image carousel advances without throwing', async () => {
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
        .filter(b => /^[\u2039\u203a<>]$/.test(b.textContent.trim()));
      btns.slice(0, 6).forEach(b => { b.click(); b.click(); });
      return btns.length;
    });
    await page.waitForTimeout(300);
    assert.deepEqual(page.errors, [], 'carousel threw after ' + clicked + ' controls driven');
    await page.context().close();
  });

  test('the inverted-V geometry calculator takes input without throwing', async () => {
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    const apex = page.locator('input[placeholder^="e.g. "]');
    const n = await apex.count();
    for (let i = 0; i < n; i++) {
      const box = apex.nth(i);
      if (!(await box.isVisible())) continue;
      await box.fill('30');
      await box.fill('0');
      await box.fill('999');
    }
    await page.waitForTimeout(300);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('every button on the page can be clicked without throwing', async () => {
    // Blunt, and it is the point: a smoke pass over every control there is.
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    const n = await page.evaluate(() => {
      // Scan DAGR opens a file chooser, which a scripted click cannot
      // legitimately do; clicking it asserts nothing and only produces a
      // browser warning about the missing user activation.
      const skip = /CLEAR SAVED DATA|EXPORT|SCAN DAGR/i;
      const btns = [...document.querySelectorAll('button')]
        .filter(b => !skip.test(b.textContent || ''));
      btns.forEach(b => { try { b.click(); } catch (e) { /* keep going */ } });
      return btns.length;
    });
    await page.waitForTimeout(600);
    assert.ok(n > 20, 'expected a page full of controls, found ' + n);
    assert.deepEqual(page.errors, [], 'clicking ' + n + ' controls threw');
    await page.context().close();
  });
});

describe('input validation', { skip: SKIP, concurrency: 1 }, () => {
  // The frequency guard (1-30 MHz) is what stops a zero or negative frequency
  // reaching the wire maths, where it would produce an infinite or negative
  // length. It had no test at any level.
  async function tryCalc(page, from, to, freq) {
    const inputs = page.locator('input[placeholder*="15T XG"]');
    await inputs.nth(0).fill(from);
    await inputs.nth(1).fill(to);
    const f = page.locator('input[placeholder="e.g. 7.3"]');
    if (await f.count()) await f.first().fill(freq);
    await page.getByRole('button', { name: 'CALCULATE', exact: true }).click();
    await page.waitForTimeout(400);
    return page.evaluate(() =>
      [...document.querySelectorAll('.usmc-stat-label')].some(e => e.textContent.trim() === 'Distance'));
  }

  test('a frequency outside 1-30 MHz is refused, not computed', async () => {
    // Non-numeric text is not in this list because the field is type="number"
    // and the browser will not accept it — that guard is real and it is the
    // browser's, not ours. These are the values that CAN be typed.
    for (const bad of ['0', '-5', '900', '0.5']) {
      const page = await newPage(browser);
      const got = await tryCalc(page, CHERRY_POINT, OKINAWA, bad);
      assert.equal(got, false, 'the app computed a result for frequency "' + bad + '"');
      const msg = await page.evaluate(() =>
        document.body.innerText.includes('Enter frequency 1-30 MHz'));
      assert.ok(msg, 'no error shown for frequency "' + bad + '"');
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
  });

  test('an unparseable location is refused, not guessed at', async () => {
    const page = await newPage(browser);
    const got = await tryCalc(page, 'not a coordinate', OKINAWA, '7.3');
    assert.equal(got, false, 'the app computed a result from junk input');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('a valid shot still calculates after a rejected one', async () => {
    // A rejected input must not leave the form wedged.
    const page = await newPage(browser);
    assert.equal(await tryCalc(page, CHERRY_POINT, OKINAWA, '0'), false);
    assert.equal(await tryCalc(page, CHERRY_POINT, OKINAWA, '7.3'), true,
      'the form stayed stuck after a rejected frequency');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('wired-up physics reaches the screen', { skip: SKIP, concurrency: 1 }, () => {
  // v1.31. These were real physics the app computed (or could) and never
  // showed anyone. A capability nobody can reach is not a capability.

  test('a ground-wave path over water tells the operator what the ground is worth', async () => {
    const page = await newPage(browser);
    // ~40 km across open water off the North Carolina coast.
    await calculate(page, 'N 34:30:00 W 076:20:00', 'N 34:45:00 W 076:00:00');
    const txt = await page.evaluate(() => document.body.innerText);
    assert.match(txt, /Ground wave/i, 'not classified as a ground-wave path');
    assert.match(txt, /\u00d7 the range|average dry land|average land/i,
      'the app knew the ground conductivity and said nothing about it');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('the About card reads its accuracy from the data, not from prose', async () => {
    // The numbers here used to be typed by hand, which is how three different
    // M-factor figures ended up in three places.
    const page = await newPage(browser);
    await page.getByRole('button', { name: 'ABOUT', exact: true }).click();
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'What It Does').click();
    });
    await page.waitForTimeout(250);
    const txt = await page.evaluate(() => document.body.innerText);
    assert.match(txt, /Critical frequency is accurate to about \d/,
      'the accuracy sentence did not render');
    assert.match(txt, /path geometry to about \d/,
      'the path-geometry accuracy is not being read from the table');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('postMessage bridge', { skip: SKIP, concurrency: 1 }, () => {
  // v1.29 security fix. Before it, any page could iframe the app and read the
  // operator's cached coordinates straight out of getInputs — the location
  // cache is loaded into state before any user action, so a bare frame load
  // was enough. For a field app that is a position leak.
  async function ask(page, method) {
    return page.evaluate((m) => new Promise((resolve) => {
      const id = 'probe-' + m;
      function onMsg(ev) {
        if (!ev.data || ev.data.type !== 'hfcalc:response' || ev.data.id !== id) return;
        window.removeEventListener('message', onMsg);
        resolve(ev.data);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ type: 'hfcalc:request', id, method: m }, '*');
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 2500);
    }), method);
  }

  test('refuses to hand out coordinates without an explicit opt-in', async () => {
    const page = await newPage(browser);
    // Put a real coordinate pair in the cache, exactly as an operator would.
    await calculate(page, CHERRY_POINT, OKINAWA);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:has-text("CALCULATE")');

    const res = await ask(page, 'getInputs');
    assert.ok(res, 'no reply at all — the probe is broken, not the app');
    assert.equal(res.ok, false, 'the bridge served coordinates with no opt-in');
    assert.match(res.error, /embed=1/, 'the refusal should tell an integrator what to do');
    assert.equal(res.result, undefined, 'a refusal must not carry a payload');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('getResults is refused too, not just getInputs', async () => {
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    const res = await ask(page, 'getResults');
    assert.ok(res && res.ok === false, 'getResults leaked without opt-in');
    assert.equal(res.result, undefined);
    await page.context().close();
  });

  test('ping still answers, and carries no operator data', async () => {
    // An integrator must be able to detect the app and learn what to do.
    const page = await newPage(browser);
    const res = await ask(page, 'ping');
    assert.ok(res && res.ok === true, 'ping should always answer');
    assert.equal(res.result.pong, true);
    const blob = JSON.stringify(res.result);
    assert.doesNotMatch(blob, /\d{2}\.\d+\s*,\s*-?\d/, 'ping must not carry coordinates');
    assert.ok(res.result.version, 'ping should still identify the build');
    await page.context().close();
  });

  test('with ?embed=1 the documented integration still works', async () => {
    // The fix must not break a host that legitimately embeds the calculator.
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    await page.goto(BASE_URL + '?embed=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:has-text("CALCULATE")');
    const res = await ask(page, 'getInputs');
    assert.ok(res && res.ok === true, 'opt-in did not re-enable the bridge');
    assert.ok(res.result.from, 'getInputs should return the from location when opted in');
    await page.context().close();
  });
});

describe('collapsible cards', { skip: SKIP, concurrency: 1 }, () => {
  // Whatever else changes, opening and closing a panel must never throw and
  // must never leave the card stuck. This is the cheap guard that would have
  // caught the compass freeze class of bug anywhere else in the app.
  const CARDS = ['Compass', 'Frequency Check', 'Saved Shots & Export',
    '24-Hour Frequency Forecast', 'Get Coords From Your DAGR'];

  test('every card survives open → close → open', async () => {
    const page = await newPage(browser);
    await calculate(page, CHERRY_POINT, OKINAWA);
    for (const card of CARDS) {
      await toggleCard(page, card, 'OPEN');
      await toggleCard(page, card, 'CLOSE');
      await toggleCard(page, card, 'OPEN');
      await toggleCard(page, card, 'CLOSE');
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('the About card renders all three tabs', async () => {
    const page = await newPage(browser);
    await toggleCard(page, 'About', 'OPEN').catch(async () => {
      // The About toggle reads ABOUT / CLOSE rather than OPEN / CLOSE.
      await page.getByRole('button', { name: 'ABOUT', exact: true }).click();
    });
    await page.waitForTimeout(250);
    for (const tab of ['About', 'What It Does', 'Vs. Fielded Tools']) {
      await page.evaluate((t) => {
        [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t).click();
      }, tab);
      await page.waitForTimeout(200);
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});
