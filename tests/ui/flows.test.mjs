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
  toggleCard, statVal, calculate, readFrequencies,
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
