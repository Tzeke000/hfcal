// The offline-readiness decision (v1.59). The browser's offline install is
// all or nothing and ~36 MB since the whole world's terrain went in; an
// older iPhone that runs out of space fails silently until the operator has
// no signal. These pin that each real situation is named correctly — above
// all that a failed or partial save is never reported as ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineState } from '../../src/lib/offlineStatus.js';

test('everything saved and active is READY', function() {
  assert.equal(offlineState({ supported: true, active: true, cached: 369, total: 369 }).state, 'ready');
});

test('a rejected install is FAILED even if an old version is active', function() {
  // An older install can keep the app working online while the new one was
  // refused for space — the operator must still be told.
  assert.equal(offlineState({ supported: true, active: true, failed: true, cached: 136, total: 369 }).state, 'failed');
});

test('a download in progress is INSTALLING, with the count', function() {
  const s = offlineState({ supported: true, installing: true, cached: 120, total: 369 });
  assert.equal(s.state, 'installing');
  assert.equal(s.cached, 120);
  assert.equal(s.total, 369);
});

test('an older version with only the Americas saved is INCOMPLETE, not ready', function() {
  // A phone still on v1.57 has 136 chunks; v1.58 ships 369.
  assert.equal(offlineState({ supported: true, active: true, cached: 136, total: 369 }).state, 'incomplete');
});

test('no active worker at all is INCOMPLETE', function() {
  assert.equal(offlineState({ supported: true, active: false, cached: 0, total: 369 }).state, 'incomplete');
});

test('a browser that cannot install offline says nothing', function() {
  assert.equal(offlineState({ supported: false }).state, 'unsupported');
  assert.equal(offlineState(null).state, 'unsupported');
});

test('nothing but full coverage is ever called ready', function() {
  for (let cached = 0; cached < 369; cached += 23) {
    assert.notEqual(offlineState({ supported: true, active: true, cached, total: 369 }).state, 'ready',
      cached + ' of 369 must not read as ready');
  }
});

test('a first visit before the worker registers is SAVING, not "incomplete — reopen"', function() {
  // The first cut told every brand-new user "only 0 of 369 saved — reopen on
  // Wi-Fi" in the moment before the offline worker had even registered.
  assert.equal(offlineState({ supported: true, registered: false, active: false, cached: 0, total: 369 }).state, 'installing');
  // But a registered worker that is neither active nor installing is stuck.
  assert.equal(offlineState({ supported: true, registered: true, active: false, cached: 0, total: 369 }).state, 'incomplete');
});
