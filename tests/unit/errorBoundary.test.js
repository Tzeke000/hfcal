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
