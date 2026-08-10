// The ErrorBoundary is the backstop that keeps a corrupt saved shot (or any
// render-time throw) from white-screening the app on every launch. Rendered
// with react-dom/server so the assertion is deterministic and DOM-free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary.js';

function Boom() { throw new Error('corrupt shot: exploded in render'); }

test('renders its child when nothing throws', function() {
  const html = renderToStaticMarkup(
    React.createElement(ErrorBoundary, null, React.createElement('div', null, 'OK-CHILD')));
  assert.match(html, /OK-CHILD/);
  assert.doesNotMatch(html, /RECOVERY/);
});

test('CLEAR SAVED DATA wipes every hfcalc_* store and nothing else', function() {
  // The wipe list used to be hand-kept and missed the stores added in
  // v1.43/v1.44 (truth log, SOI, night mode) — a crash rooted in one of those
  // looped forever through the recovery button (Iris round 2, C2). The wipe
  // now matches the hfcalc_ prefix, so a store added next release is covered
  // the day it is written.
  const store = new Map([
    ['hfcalc_shots_v1', 'x'], ['hfcalc_locs_v1', 'x'], ['hfcalc_spacewx_v1', 'x'],
    ['hfcalc_truth_v1', 'x'], ['hfcalc_soi_v1', 'x'], ['hfcalc_night_v1', '1'],
    ['hfcalc_store_added_in_some_future_version', 'x'],
    ['somebody_elses_key', 'keep me'],
  ]);
  global.localStorage = {
    get length() { return store.size; },
    key: function(i) { return Array.from(store.keys())[i]; },
    removeItem: function(k) { store.delete(k); },
  };
  const hadWindow = 'window' in global;
  const oldWindow = global.window;
  global.window = { location: { reload: function() {} } };
  try {
    new ErrorBoundary({}).clearAndReload();
  } finally {
    delete global.localStorage;
    if (hadWindow) global.window = oldWindow; else delete global.window;
  }
  assert.deepEqual(Array.from(store.keys()), ['somebody_elses_key'],
    'every hfcalc_* key must go; foreign keys must survive');
});

test('catches a render throw and shows recovery instead of blank', function() {
  // react-dom/server surfaces the throw; a real DOM render would hit
  // getDerivedStateFromError. Assert the boundary is wired to catch by
  // driving that static method directly, which is what React calls.
  const next = ErrorBoundary.getDerivedStateFromError(new Error('corrupt shot'));
  assert.equal(next.failed, true);
  assert.match(next.message, /corrupt shot/);

  // And the fallback markup, rendered from the failed state, offers recovery.
  const eb = new ErrorBoundary({});
  eb.state = next;
  const html = renderToStaticMarkup(React.createElement('div', null, eb.render()));
  assert.match(html, /RECOVERY/);
  assert.match(html, /CLEAR SAVED DATA/);   // '&' renders as &amp; in static markup
});
