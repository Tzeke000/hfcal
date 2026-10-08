// WHAT'S NEW (v1.61). The list is hand-written, so the risk is it going stale
// — a release shipped with no entry, and the HELP tab quietly describing an
// older app. The first test makes that impossible: the newest entry must be
// the version package.json is about to ship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGELOG } from '../../src/data/changelog.js';
import { loadVersionsSeen, recordVersionSeen, VERSIONS_SEEN_KEY } from '../../src/lib/versionsSeen.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

test('every release has an entry: the newest is the version being shipped', function() {
  assert.equal(CHANGELOG[0].version, pkg.version,
    'package.json is ' + pkg.version + ' but WHAT’S NEW starts at ' + CHANGELOG[0].version + ' — add an entry');
});

test('entries are newest-first, unique, dated, titled and say something', function() {
  assert.ok(CHANGELOG.length >= 5, 'WHAT’S NEW shows five; keep at least five');
  const seen = new Set();
  for (let i = 0; i < CHANGELOG.length; i++) {
    const e = CHANGELOG[i];
    assert.ok(!seen.has(e.version), 'duplicate ' + e.version); seen.add(e.version);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.version + ' date');
    assert.ok(e.title && e.title.length < 60, e.version + ' needs a short title');
    assert.ok(Array.isArray(e.notes) && e.notes.length > 0, e.version + ' needs notes');
    if (i > 0) {
      assert.ok(cmp(CHANGELOG[i - 1].version, e.version) > 0, 'not newest-first at ' + e.version);
      assert.ok(CHANGELOG[i - 1].date >= e.date, 'dates go backwards at ' + e.version);
    }
  }
});

function withStorage(fn) {
  const store = new Map();
  global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try { return fn(store); } finally { delete global.localStorage; }
}

test('a version is recorded the first time it opens, and never overwritten', function() {
  withStorage(() => {
    assert.equal(recordVersionSeen('1.61.0', new Date('2026-10-08T10:00:00Z')), true);
    assert.equal(recordVersionSeen('1.61.0', new Date('2026-10-09T10:00:00Z')), false, 'second open must not move the date');
    assert.equal(loadVersionsSeen()['1.61.0'], '2026-10-08T10:00:00.000Z');
  });
});

test('the install history survives junk and does not grow without bound', function() {
  withStorage((store) => {
    store.set(VERSIONS_SEEN_KEY, '{not json');
    assert.deepEqual(loadVersionsSeen(), {});
    for (let i = 0; i < 60; i++) recordVersionSeen('1.' + i + '.0', new Date(Date.UTC(2026, 0, 1 + i)));
    const m = loadVersionsSeen();
    assert.ok(Object.keys(m).length <= 40);
    assert.ok(m['1.59.0'], 'the newest are kept, the oldest dropped');
  });
});
