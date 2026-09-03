// The field truth log records what the app predicted next to what actually
// happened, and exports it as a card the operator hands back. Its whole value
// is that the data is trustworthy, so its shape and its tolerance of junk are
// pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTruthEntry, scoreEntry, formatTruthReport, loadTruth, persistTruth, newTruthId,
  redactEntry, buildSubmission }
  from '../../src/lib/truthLog.js';

const SHOT = {
  p1: { lat: 34.9, lon: -76.9 }, p2: { lat: 26.3, lon: 127.8 },
  distKm: 12500, freqMHz: 14.2, txWatts: 20, appVersion: '1.43.0',
  freqCheck: { muf: 18.4, fot: 14.2, luf: 6.2, txWatts: 20, month: 8, utcHour: 4.5, verdictLabel: 'GOOD' },
};

test('an entry captures both the prediction and the outcome', function() {
  const e = makeTruthEntry(SHOT, 'worked', 'inverted-V over water', new Date('2026-08-09T12:00:00Z'));
  assert.equal(e.outcome, 'worked');
  assert.equal(e.note, 'inverted-V over water');
  assert.equal(e.freqMHz, 14.2);
  assert.equal(e.predicted.muf, 18.4);
  assert.equal(e.predicted.verdict, 'GOOD');
  assert.equal(e.predicted.utcHour, 4.5);
  assert.ok(e.id && e.dtg);
});

test('ids are unique even in the same millisecond', function() {
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(newTruthId());
  assert.equal(ids.size, 50);
});

test('scoreEntry marks agreement and surprises', function() {
  // GOOD prediction that worked = hit; GOOD that failed = miss.
  assert.equal(scoreEntry(makeTruthEntry(SHOT, 'worked')), 'hit');
  assert.equal(scoreEntry(makeTruthEntry(SHOT, 'failed')), 'miss');
  // A CLOSED prediction that then worked is also a surprise (miss).
  const closed = Object.assign({}, SHOT, {
    freqCheck: Object.assign({}, SHOT.freqCheck, { verdictLabel: 'BELOW LUF' }) });
  assert.equal(scoreEntry(makeTruthEntry(closed, 'worked')), 'miss');
  assert.equal(scoreEntry(makeTruthEntry(closed, 'failed')), 'hit');
  // No verdict -> unknown, never a false hit.
  assert.equal(scoreEntry({ outcome: 'worked' }), 'unknown');
});

test('the exported report leads with a scorable summary', function() {
  const entries = [
    makeTruthEntry(SHOT, 'worked'),
    makeTruthEntry(SHOT, 'failed'),
  ];
  const card = formatTruthReport(entries, '1.43.0');
  assert.match(card, /FIELD TRUTH LOG/);
  assert.match(card, /ENTRIES: 2/);
  assert.match(card, /1 hit \/ 1 miss/);
  assert.match(card, /14\.2 MHz/);
  assert.match(card, /Send this card back/);
});

test('report and score survive entries from older versions', function() {
  const junk = [
    {}, null, { outcome: 'worked' },
    { outcome: 'failed', predicted: {}, from: { lat: 1, lon: 2 } },
  ].filter(Boolean);
  assert.doesNotThrow(function() { formatTruthReport(junk, '1.43.0'); });
  junk.forEach(function(e) { assert.doesNotThrow(function() { scoreEntry(e); }); });
});

test('loadTruth drops non-object elements', function() {
  // Uses a tiny fake localStorage so the pure layer is testable in node.
  global.localStorage = {
    _v: JSON.stringify([{ id: 'a', outcome: 'worked' }, null, 5, 'x']),
    getItem() { return this._v; }, setItem(k, v) { this._v = v; }, removeItem() { this._v = null; },
  };
  const loaded = loadTruth();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'a');
  assert.equal(persistTruth([{ id: 'b', outcome: 'failed' }]), true);
  delete global.localStorage;
});

// ── SENDING A CARD BACK (v1.50) ──────────────────────────────────────────────
// The app's first promise is that the operator's position never leaves the
// device. The truth log is the one feature that deliberately sends something,
// so these tests are the guard on that promise: they assert that a card built
// for sending cannot carry a precise grid unless the operator explicitly
// asked for it.

const SEND_SHOT = {
  p1: { lat: 34.90361, lon: -76.88056 },     // Cherry Point, to 5 decimals
  p2: { lat: 26.35, lon: 127.76667 },        // Okinawa
  distKm: 12045.6, freqMHz: 14.2,
  freqCheck: { luf: 6.2, muf: 18.4, fot: 14.2, txWatts: 20, month: 8,
               utcHour: 6, sfi: 142, kp: 5.3, auroralDb30: 0.31,
               verdictLabel: 'GOOD' },
  appVersion: '1.50.0',
};

test('redaction: a sent grid is rounded to whole degrees by default', function() {
  const e = makeTruthEntry(SEND_SHOT, 'worked', 'inverted-V at 30 ft', new Date());
  const r = redactEntry(e, 'degree');
  assert.deepEqual(r.from, { lat: 35, lon: -77 }, 'from must be whole degrees');
  assert.deepEqual(r.to, { lat: 26, lon: 128 }, 'to must be whole degrees');
  assert.equal(r.coordPrecision, 'degree', 'the card must say it was rounded');
  // Everything the model actually needs survives untouched.
  assert.equal(r.distKm, 12045.6);
  assert.equal(r.freqMHz, 14.2);
  assert.equal(r.predicted.muf, 18.4);
  assert.equal(r.predicted.sfi, 142);
  assert.equal(r.predicted.kp, 5.3);
  assert.equal(r.note, 'inverted-V at 30 ft');
  // And the original entry on the device is NOT mutated — the operator keeps
  // their own full-precision history.
  assert.equal(e.from.lat, 34.90361, 'redaction must not damage the stored entry');
});

test('redaction: exact precision is opt-in and honoured when chosen', function() {
  const e = makeTruthEntry(SEND_SHOT, 'failed', null, new Date());
  const r = redactEntry(e, 'exact');
  assert.equal(r.from.lat, 34.90361, 'exact must mean exact');
  assert.equal(r.coordPrecision, undefined, 'exact carries no rounding claim');
});

test('redaction: rounding never leaks a sub-degree grid anywhere in the card', function() {
  // The real guard: scan the whole rendered text for the precise coordinates.
  // A future change that formats grids from some other field would break this.
  const e = makeTruthEntry(SEND_SHOT, 'worked', 'note', new Date());
  const sub = buildSubmission([e], '1.50.0', 'degree');
  assert.ok(sub.body.indexOf('34.90') === -1, 'precise latitude leaked into the card');
  assert.ok(sub.body.indexOf('76.88') === -1, 'precise longitude leaked into the card');
  assert.ok(sub.body.indexOf('127.76') === -1, 'precise longitude leaked into the card');
  assert.match(sub.body, /rounded to whole degrees/i, 'the card must disclose the rounding');
  // The physics is all still there.
  assert.match(sub.body, /14\.2 MHz/);
  assert.match(sub.body, /SFI 142/);
  assert.match(sub.body, /Kp 5\.3/);
  assert.match(sub.body, /20 W/);
});

test('submission: the subject line carries the headline', function() {
  const es = [makeTruthEntry(SEND_SHOT, 'worked', null, new Date()),
              makeTruthEntry(SEND_SHOT, 'failed', null, new Date())];
  const sub = buildSubmission(es, '1.50.0', 'degree');
  assert.match(sub.subject, /HFCALC field truth log/);
  assert.match(sub.subject, /2 shots/);
  assert.match(sub.subject, /v1\.50\.0/);
  // One hit (GOOD + worked) and one miss (GOOD + failed).
  assert.match(sub.subject, /1 hit \/ 1 miss/);
});

test('submission: an exact-precision card says so out loud', function() {
  const sub = buildSubmission([makeTruthEntry(SEND_SHOT, 'worked', null, new Date())],
                              '1.50.0', 'exact');
  assert.match(sub.body, /EXACT, sent deliberately/,
    'an exact card must state that the operator chose it');
});

test('submission: survives an empty log and a legacy entry with no space wx', function() {
  assert.doesNotThrow(function() { buildSubmission([], '1.50.0', 'degree'); });
  assert.doesNotThrow(function() { buildSubmission(null, '1.50.0', 'degree'); });
  // An entry logged before sfi/kp existed must still render.
  const old = { id: 'x', dtg: '011200Z JAN 26', outcome: 'worked',
                from: { lat: 1.5, lon: 2.5 }, to: null, freqMHz: 7.3,
                predicted: { muf: 12, verdict: 'GOOD' } };
  const sub = buildSubmission([old], '1.50.0', 'degree');
  assert.ok(sub.body.length > 0);
  assert.ok(sub.body.indexOf('SPACE WX') === -1, 'no space-wx line when unknown');
  assert.ok(!/undefined|NaN/.test(sub.body), 'must not print undefined/NaN');
});

test('the entry records the space weather it was predicted under', function() {
  const e = makeTruthEntry(SEND_SHOT, 'worked', null, new Date());
  assert.equal(e.predicted.sfi, 142);
  assert.equal(e.predicted.kp, 5.3);
  assert.equal(e.predicted.auroralDb30, 0.31);
  // Absent readings become null, not undefined or NaN, so the JSON round-trips.
  const bare = makeTruthEntry({ freqCheck: { muf: 10 } }, 'failed', null, new Date());
  assert.equal(bare.predicted.sfi, null);
  assert.equal(bare.predicted.kp, null);
});
