// The optional user list (v1.66): a first-open card asking name, rank, unit
// and MOS — every box optional — with a clear SKIP, and a HELP card to add
// yourself later. Logic and the line it draws: src/lib/roster.js.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useState, useEffect } from 'react';
import { T } from './theme.js';
import { RANKS, shouldAskRoster, isRosterConfigured, loadRoster, sendRoster, skipRoster, flushRoster } from '../lib/roster.js';
import { platformLabel } from '../lib/platform.js';
import { loadVersionsSeen } from '../lib/versionsSeen.js';

var OPEN_EVENT = 'hfcalc-roster-open';
var CHANGED_EVENT = 'hfcalc-roster-changed';
function announce() { try { window.dispatchEvent(new Event(CHANGED_EVENT)); } catch (e) { /* ignore */ } }

// The earliest open this device has on record (kept since v1.61), as a date.
function firstOpened() {
  var seen = loadVersionsSeen();
  var dates = Object.keys(seen).map(function(k) { return seen[k]; }).sort();
  return (dates[0] || new Date().toISOString()).slice(0, 10);
}

export function RosterPrompt({ appVersion }) {
  var [open, setOpen] = useState(function() { return shouldAskRoster(); });
  var [f, setF] = useState({ name: '', rank: '', unit: '', mos: '' });
  var [busy, setBusy] = useState(false);

  // A pending entry (filled in with no signal) goes when signal returns.
  useEffect(function() {
    function flush() { flushRoster().then(function(st) { if (st) announce(); }); }
    flush();
    function onOpen() { setOpen(true); }
    window.addEventListener('online', flush);
    window.addEventListener(OPEN_EVENT, onOpen);
    return function() { window.removeEventListener('online', flush); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);

  if (!open) return null;

  function set(k) { return function(e) { var v = e.target.value; setF(function(cur) { var n = Object.assign({}, cur); n[k] = v; return n; }); }; }
  function skip() { skipRoster(); setOpen(false); announce(); }
  function send() {
    if (busy) return;
    setBusy(true);
    sendRoster(f, { platform: platformLabel(), appVersion: appVersion, firstOpened: firstOpened() })
      .then(function() { setBusy(false); setOpen(false); announce(); });
  }

  var label = { color: T.textSec, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', margin: '10px 0 4px', display: 'block' };
  var box = { width: '100%', background: T.bg, color: T.textPrim, border: '1px solid ' + T.border, borderRadius: 6, padding: '10px 11px', fontSize: '0.9rem' };
  return (
    <div data-roster-prompt style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflowY: 'auto' }}>
      <div className="usmc-card" style={{ width: '100%', maxWidth: 520, margin: 0, borderRadius: '12px 12px 0 0', padding: '18px 16px calc(16px + env(safe-area-inset-bottom))' }}>
        <div style={{ color: T.accentText, fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.12em' }}>OPTIONAL</div>
        <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '1rem', marginTop: 4 }}>Who's using the app?</div>
        <div style={{ color: T.textBody, fontSize: '0.78rem', lineHeight: 1.5, marginTop: 6 }}>
          Help the app's author, Cpl Angeles-Gonzalez, see which units and MOSs use it. Fill in any of these — or none and tap SKIP. The app works exactly the same either way.
        </div>

        <label style={label} htmlFor="roster-name">NAME</label>
        <input id="roster-name" style={box} value={f.name} onChange={set('name')} autoComplete="off" placeholder="e.g. Smith" />
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={label} htmlFor="roster-rank">RANK</label>
            <input id="roster-rank" style={box} value={f.rank} onChange={set('rank')} list="roster-ranks" autoComplete="off" placeholder="e.g. Cpl" />
            <datalist id="roster-ranks">{RANKS.map(function(r) { return <option key={r} value={r} />; })}</datalist>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label} htmlFor="roster-mos">MOS</label>
            <input id="roster-mos" style={box} value={f.mos} onChange={set('mos')} autoComplete="off" placeholder="e.g. 0621" />
          </div>
        </div>
        <label style={label} htmlFor="roster-unit">UNIT</label>
        <input id="roster-unit" style={box} value={f.unit} onChange={set('unit')} autoComplete="off" placeholder="e.g. 8th Comm Bn" />

        <div style={{ color: T.textMute, fontSize: '0.68rem', lineHeight: 1.5, marginTop: 10 }}>
          Sent once, to the author's private spreadsheet (Google Sheets): what you typed, which kind of app this is, the app version and the date. Never your location. Nothing you would not put on an unclassified Google form. No signal? It waits and goes later.
        </div>

        <button onClick={send} disabled={busy}
          style={{ width: '100%', marginTop: 14, background: T.accent, color: '#0e1409', border: 'none', borderRadius: 8, padding: '12px 0', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.08em', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'SENDING…' : 'SEND'}
        </button>
        <button onClick={skip}
          style={{ width: '100%', marginTop: 10, background: 'transparent', color: T.textPrim, border: '2px solid ' + T.borderHi, borderRadius: 8, padding: '12px 0', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.08em', cursor: 'pointer' }}>
          SKIP — STAY ANONYMOUS
        </button>
      </div>
    </div>
  );
}

// HELP: where you stand, and a way in if you skipped.
export function RosterHelpCard() {
  var [rec, setRec] = useState(loadRoster);
  useEffect(function() {
    function on() { setRec(loadRoster()); }
    window.addEventListener(CHANGED_EVENT, on);
    return function() { window.removeEventListener(CHANGED_EVENT, on); };
  }, []);
  if (!isRosterConfigured()) return null;

  var status = !rec ? 'Not answered yet.'
    : rec.state === 'sent' ? 'You are on the list. To be taken off, tell the author.'
    : rec.state === 'pending' ? 'Filled in — waiting for signal to send.'
    : 'You skipped this. You can add yourself any time.';
  return (
    <div className="usmc-card" data-roster-help style={{ marginBottom: 16 }}>
      <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>User List (optional)</div>
      <div style={{ color: T.textMute, fontSize: '0.74rem', marginTop: 4, lineHeight: 1.5 }}>
        Name, rank, unit and MOS — sent once to the author's private spreadsheet to show who uses the app. {status}
      </div>
      {(!rec || rec.state === 'skipped') && (
        <button onClick={function() { try { window.dispatchEvent(new Event(OPEN_EVENT)); } catch (e) { /* ignore */ } }}
          style={{ marginTop: 10, background: T.surfaceHi, color: T.textPrim, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '8px 14px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer' }}>
          ADD MYSELF
        </button>
      )}
    </div>
  );
}
