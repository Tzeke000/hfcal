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

var TOTAL = Object.keys(CHUNKS).length;

export function OfflineStatus() {
  var [st, setSt] = useState(null);
  var [failed, setFailed] = useState(false);

  // Watch for an install that the browser rejects. A worker that goes
  // 'redundant' while installing is exactly the storage-full case.
  useEffect(function() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    var alive = true;
    function watch(w) {
      if (!w) return;
      w.addEventListener('statechange', function() {
        if (alive && w.state === 'redundant') setFailed(true);
      });
    }
    navigator.serviceWorker.getRegistration().then(function(reg) {
      if (!reg || !alive) return;
      watch(reg.installing);
      reg.addEventListener('updatefound', function() { watch(reg.installing); });
    }).catch(function() { /* nothing to watch */ });
    return function() { alive = false; };
  }, []);

  // Poll while anything is in flight; stop once ready or failed.
  useEffect(function() {
    var alive = true, timer = null;
    function tick() {
      readOfflineState(TOTAL, failed).then(function(s) {
        if (!alive) return;
        setSt(s);
        if (s.state === 'installing' || s.state === 'incomplete') timer = setTimeout(tick, 3000);
      });
    }
    tick();
    return function() { alive = false; if (timer) clearTimeout(timer); };
  }, [failed]);

  if (!st || st.state === 'unsupported') return null;

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
