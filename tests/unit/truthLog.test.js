// The field truth log records what the app predicted next to what actually
// happened, and exports it as a card the operator hands back. Its whole value
// is that the data is trustworthy, so its shape and its tolerance of junk are
// pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTruthEntry, scoreEntry, formatTruthReport, loadTruth, persistTruth, newTruthId }
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
