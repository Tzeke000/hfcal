// "Can I lose signal now?" — the offline-readiness card (v1.59).
//
// See src/lib/offlineStatus.js for why: the offline install is all or
// nothing, ~36 MB since the whole world's terrain went in, and an older
// iPhone that runs out of space fails silently until the operator is in the
// field. This card says, in words, which of these is true:
//   SAVING     the world is still downloading — stay on Wi-Fi
//   FAILED     the phone refused the offline install — free space, reopen
//   INCOMPLETE an older version is active or the save is partial — update/reopen
//   READY      one small line, so it can be confirmed before heading out
// Nothing at all on a browser that cannot install offline.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useState, useEffect } from 'react';
import { T } from './theme.js';
import { readOfflineState } from '../lib/offlineStatus.js';
import { CHUNKS } from '../data/terrainChunks.js';
import { isNativeApp } from '../lib/platform.js';

var TOTAL = Object.keys(CHUNKS).length;
var NATIVE = isNativeApp();

// One reader for the whole page. The strip and the card each used to run
// their own, and each re-listed every cached file (~420) every 3 s for as long
// as the state was 'incomplete' — which, with an older version waiting for the
// operator to tap UPDATE, can be the whole session.
var shared = { st: null, failed: false, timer: null, started: false, subs: [] };

function publish(st) {
  shared.st = st;
  shared.subs.forEach(function(fn) { fn(st); });
}

function tick() {
  shared.timer = null;
  readOfflineState(TOTAL, shared.failed).then(function(st) {
    publish(st);
    // Quick while the world is downloading. Slow while waiting on something
    // only the operator can do (tap UPDATE, free storage) — a returning tab, a
    // new worker or a controller change re-checks at once anyway. Stop once
    // ready or failed.
    var wait = st.state === 'installing' ? 3000 : st.state === 'incomplete' ? 30000 : 0;
    if (wait && shared.subs.length && !shared.timer) shared.timer = setTimeout(tick, wait);
  });
}

function recheck() {
  if (shared.timer) { clearTimeout(shared.timer); shared.timer = null; }
  tick();
}

function start() {
  if (shared.started) return;
  shared.started = true;
  if (NATIVE) { publish({ state: 'ready', native: true, cached: TOTAL, total: TOTAL }); return; }
  // Watch for an install that the browser rejects. A worker that goes
  // 'redundant' while installing is exactly the storage-full case.
  try {
    var sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
    if (sw) {
      var watch = function(w) {
        if (!w) return;
        w.addEventListener('statechange', function() {
          if (w.state === 'redundant') { shared.failed = true; recheck(); }
        });
      };
      sw.getRegistration().then(function(reg) {
        if (!reg) return;
        watch(reg.installing);
        reg.addEventListener('updatefound', function() { watch(reg.installing); recheck(); });
      }).catch(function() { /* nothing to watch */ });
      sw.addEventListener('controllerchange', recheck);
    }
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && shared.subs.length) recheck();
    });
  } catch (e) { /* the reader still runs */ }
  tick();
}

// variant 'strip': the one-line status in the header (saving / not finished /
// ready) — present on every tab without crowding any of them. variant 'card':
// renders ONLY for the serious case, an install the phone refused, because
// "will not open without signal" must not be a line someone can miss.
export function OfflineStatus({ variant }) {
  var [st, setSt] = useState(shared.st);
  useEffect(function() {
    shared.subs.push(setSt);
    if (shared.st) setSt(shared.st);
    if (!shared.started) start();
    // A subscriber joining after polling stopped for 'incomplete' restarts it.
    else if (shared.st && shared.st.state !== 'ready' && shared.st.state !== 'failed' && !shared.timer) recheck();
    return function() {
      shared.subs = shared.subs.filter(function(f) { return f !== setSt; });
      if (!shared.subs.length && shared.timer) { clearTimeout(shared.timer); shared.timer = null; }
    };
  }, []);

  if (!st || st.state === 'unsupported') return null;

  if (variant === 'card' && st.state !== 'failed') return null;
  if (variant === 'strip') {
    if (st.state === 'failed') return null;          // the card handles it
    var line = st.native
      ? '✓ Installed app · works offline · all ' + st.total + ' terrain regions built in'
      : st.state === 'ready'
      ? '✓ Offline ready · all ' + st.total + ' terrain regions saved'
      : st.state === 'installing'
        ? 'Saving for offline use: ' + st.cached + ' / ' + st.total + ' regions — stay on Wi-Fi'
        : 'Offline save not finished: ' + st.cached + ' / ' + st.total + ' — reopen on Wi-Fi';
    return (
      <div style={{ margin: '6px 0 0', fontSize: '0.62rem', letterSpacing: '0.04em',
        color: st.state === 'ready' ? T.textMute : T.accentText }}>
        {line}
        {st.state === 'installing' && st.total > 0 && (
          <div style={{ height: 3, background: T.bg, borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ width: Math.min(100, Math.round(100 * st.cached / st.total)) + '%', height: '100%', background: T.accent }} />
          </div>
        )}
      </div>
    );
  }

  if (st.state === 'ready') {
    return (
      <div style={{ color: T.textMute, fontSize: '0.66rem', margin: '-6px 0 14px', textAlign: 'center' }}>
        {'✓ Offline ready — the app and all ' + st.total + ' terrain regions are saved on this device'}
      </div>
    );
  }

  var warn = st.state === 'failed';
  var title = st.state === 'installing' ? 'SAVING FOR OFFLINE USE'
    : warn ? 'NOT SAVED FOR OFFLINE USE' : 'OFFLINE SAVE NOT FINISHED';
  var body = st.state === 'installing'
    ? 'Saving the world map so the app works with no signal: ' + st.cached + ' of ' + st.total
      + ' terrain regions so far. Stay on Wi-Fi and keep the app open until this says ready.'
    : warn
      ? 'This device refused to save the app for offline use — usually because storage is full. '
        + 'It works now, but will NOT open without signal. Free up some storage, then reopen the app on Wi-Fi.'
      : 'Only ' + st.cached + ' of ' + st.total + ' terrain regions are saved on this device, so with no '
        + 'signal some areas fall back to coarse (~28 km) terrain. Reopen the app on Wi-Fi — and tap '
        + 'UPDATE if it offers one — to finish.';
  return (
    <div className="usmc-card" style={{ marginBottom: 16, borderLeft: '3px solid ' + (warn ? T.warn : T.accent) }}>
      <div style={{ color: warn ? T.warn : T.accentText, fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.12em' }}>{title}</div>
      <div style={{ color: T.textBody, fontSize: '0.76rem', lineHeight: 1.55, marginTop: 5 }}>{body}</div>
      {st.state === 'installing' && st.total > 0 && (
        <div style={{ height: 4, background: T.bg, borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: Math.min(100, Math.round(100 * st.cached / st.total)) + '%', height: '100%', background: T.accent }} />
        </div>
      )}
    </div>
  );
}
