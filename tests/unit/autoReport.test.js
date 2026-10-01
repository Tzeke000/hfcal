// The automatic field report (v1.55): a logged shot as a spreadsheet row.
// These tests pin the LINE the feature draws, not just that it works — what
// leaves the device by default, what never does, and that the queue cannot
// double-send or lose a row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_REPORT_FIELDS, buildAutoReport, encodeAutoReport, isAutoReportConfigured,
  flushAutoReports, loadAutoSent, markAutoSent, AUTO_SENT_KEY,
} from '../../src/lib/autoReport.js';
import { makeTruthEntry } from '../../src/lib/truthLog.js';

function yumaShot(outcome, note) {
  return makeTruthEntry({
    p1: { lat: 32.6566, lon: -114.6060 }, p2: { lat: 36.85, lon: -76.29 },
    distKm: 3508, freqMHz: 7.3, bearing: 62, magBearing: 72,
    takeoffDeg: 5, wireLabel: 'COPPER 14 AWG', zoneName: 'MEDIUM DX (2000-4000 km)',
    antenna: { name: 'LONG WIRE', key: 'longwire', apexFt: 15 },
    freqCheck: { luf: 4.2, muf: 13.1, fot: 10.1, verdictLabel: 'GOOD',
                 txWatts: 20, month: 9, utcHour: 14.5, sfi: 140, kp: 2 },
    appVersion: '1.55.0',
  }, outcome, note, new Date(Date.UTC(2026, 8, 3, 14, 30)));
}

test('by default no grid leaves the device — only a latitude BAND', function() {
  const row = buildAutoReport(yumaShot('failed', 'Never heard them'));
  assert.equal(row.fromGrid, '', 'from-grid must be empty by default');
  assert.equal(row.toGrid, '', 'to-grid must be empty by default');
  assert.equal(row.gridPrecision, 'none');
  // The midpoint's geomagnetic latitude, to the nearest 5 degrees. A region,
  // not a spot: enough for the model's latitude dependence, useless for
  // placing a unit.
  assert.match(row.midGeomagBand, /^-?\d+$/, 'band should be an integer, got ' + row.midGeomagBand);
  assert.equal(Number(row.midGeomagBand) % 5, 0, 'band must be a multiple of 5');
  // Nothing else in the row is a coordinate.
  const blob = JSON.stringify(row);
  assert.doesNotMatch(blob, /32\.65|114\.60|36\.85|76\.29/, 'a coordinate leaked into the row');
});

test('everything the model needs to be scored and re-derived does go', function() {
  const row = buildAutoReport(yumaShot('failed', 'Never heard them'));
  assert.equal(row.outcome, 'failed');
  assert.equal(row.cause, 'Never heard them');
  assert.equal(row.freqMHz, '7.3');
  assert.equal(row.distKm, '3508');
  assert.equal(row.bearingDeg, '62');
  assert.equal(row.muf, '13.1'); assert.equal(row.fot, '10.1'); assert.equal(row.luf, '4.2');
  assert.equal(row.verdict, 'GOOD');
  assert.equal(row.txWatts, '20'); assert.equal(row.month, '9'); assert.equal(row.utcHour, '14.5');
  assert.equal(row.sfi, '140'); assert.equal(row.kp, '2.0');
  assert.equal(row.antenna, 'LONG WIRE'); assert.equal(row.takeoffDeg, '5');
  assert.equal(row.wire, 'COPPER 14 AWG'); assert.equal(row.appVersion, '1.55.0');
  // Every declared column is present on the row, even if empty.
  for (const k of AUTO_REPORT_FIELDS) assert.ok(k in row, 'missing column ' + k);
});

test('a cause is only recorded for a failure; a worked note is not a cause', function() {
  assert.equal(buildAutoReport(yumaShot('worked', 'clear copy')).cause, '');
  assert.equal(buildAutoReport(yumaShot('failed', 'Jammed')).cause, 'Jammed');
});

test('grids go only when the operator explicitly turns them on', function() {
  const deg = buildAutoReport(yumaShot('worked'), { grids: 'degree' });
  assert.equal(deg.fromGrid, '33,-115', 'rounded to whole degrees');
  assert.equal(deg.gridPrecision, 'degree');
  const exact = buildAutoReport(yumaShot('worked'), { grids: 'exact' });
  assert.equal(exact.fromGrid, '32.6566,-114.6060');
  assert.equal(exact.gridPrecision, 'exact');
});

test('encoding sends only the fields the Form knows, keyed by entry id', function() {
  const cfg = { formAction: 'https://docs.google.com/forms/d/e/X/formResponse',
                fields: { outcome: 'entry.1', freqMHz: 'entry.2' } };
  const body = encodeAutoReport(buildAutoReport(yumaShot('failed', 'Jammed')), cfg);
  assert.equal(body.get('entry.1'), 'failed');
  assert.equal(body.get('entry.2'), '7.3');
  assert.equal([...body.keys()].length, 2, 'unknown fields must not be posted');
});

test('the feature is inert until a real Form is configured', function() {
  assert.equal(isAutoReportConfigured({ formAction: '', fields: {} }), false);
  assert.equal(isAutoReportConfigured({ formAction: 'https://x/y', fields: {} }), false, 'no fields');
  assert.equal(isAutoReportConfigured({ formAction: 'http://x/y', fields: { a: 'entry.1' } }), false, 'must be https');
  assert.equal(isAutoReportConfigured({ formAction: 'https://x/y', fields: { a: 'entry.1' } }), true);

  // The test stub is plain http and is admitted only by the explicit marker
  // the URL flag sets — never by a formAction alone. This is what keeps the
  // production https rule from being weakened to make a test pass.
  assert.equal(isAutoReportConfigured({ formAction: 'http://127.0.0.1/__autoreport-test', fields: { a: 'entry.1' }, test: true }), true);
  assert.equal(isAutoReportConfigured({ formAction: 'http://127.0.0.1/__autoreport-test', fields: { a: 'entry.1' } }), false,
    'an http endpoint without the test marker must be refused');
});

test('an entry from an older version with no setup block still builds a row', function() {
  const row = buildAutoReport({ id: 'old', dtg: '011200Z JAN 26', outcome: 'worked',
    freqMHz: 7.3, predicted: { muf: 10, fot: 8, luf: 4 } });
  assert.equal(row.freqMHz, '7.3');
  assert.equal(row.antenna, '');
  assert.equal(row.midGeomagBand, '', 'no endpoints, no band');
  assert.doesNotMatch(JSON.stringify(row), /undefined|NaN/);
});

// ── the queue ──────────────────────────────────────────────────────────────
// Installs a localStorage stub for the duration of fn — INCLUDING an async
// fn. The first cut tore the stub down in `finally` the moment an async
// callback returned its promise, so the flush under test ran against no
// storage at all and the ledger read back empty. Await it.
async function withStorage(fn) {
  const store = new Map();
  global.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  try { return await fn(store); } finally { delete global.localStorage; }
}

test('flush delivers oldest-first, marks each as sent, and never resends', async function() {
  await withStorage(async () => {
    const posted = [];
    global.fetch = (url, init) => { posted.push(new URLSearchParams(init.body).get('entry.1')); return Promise.resolve({}); };
    const cfg = { formAction: 'https://docs.google.com/forms/d/e/X/formResponse', fields: { dtg: 'entry.1' } };
    const entries = [{ id: 'c', dtg: 'THIRD', outcome: 'worked' },
                     { id: 'b', dtg: 'SECOND', outcome: 'worked' },
                     { id: 'a', dtg: 'FIRST', outcome: 'worked' }];   // newest-first, as stored
    try {
      let r = await flushAutoReports(entries, { cfg });
      assert.equal(r.sent, 3); assert.equal(r.failed, 0);
      assert.deepEqual(posted, ['FIRST', 'SECOND', 'THIRD'], 'oldest should go first');
      assert.deepEqual(loadAutoSent().sort(), ['a', 'b', 'c']);
      // Second flush: nothing new, nothing resent.
      r = await flushAutoReports(entries, { cfg });
      assert.equal(r.sent, 0);
      assert.equal(posted.length, 3, 'a delivered row was sent twice');
    } finally { delete global.fetch; }
  });
});

test('flush stops at the first network failure and keeps the rest queued', async function() {
  await withStorage(async () => {
    let calls = 0;
    global.fetch = () => { calls += 1; return calls === 2 ? Promise.reject(new Error('offline')) : Promise.resolve({}); };
    const cfg = { formAction: 'https://docs.google.com/forms/d/e/X/formResponse', fields: { dtg: 'entry.1' } };
    const entries = [{ id: 'c', outcome: 'worked' }, { id: 'b', outcome: 'worked' }, { id: 'a', outcome: 'worked' }];
    try {
      const r = await flushAutoReports(entries, { cfg });
      assert.equal(r.sent, 1, 'only the first row got through');
      assert.equal(r.failed, 2, 'the two after the failure stay queued');
      assert.deepEqual(loadAutoSent(), ['a'], 'only the delivered row is marked');
    } finally { delete global.fetch; }
  });
});

test('the sent ledger survives junk and caps its size', async function() {
  await withStorage((store) => {
    store.set(AUTO_SENT_KEY, '{not json');
    assert.deepEqual(loadAutoSent(), [], 'corrupt ledger must read as empty, not throw');
    for (let i = 0; i < 600; i++) markAutoSent('id' + i);
    assert.ok(loadAutoSent().length <= 500, 'ledger must not grow without bound');
  });
});
