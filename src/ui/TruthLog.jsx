// Field truth log card — one tap after a shot: it CLOSED, or it DIDN'T.
//
// Records the app's prediction beside the operator's real-world outcome, so
// the device accumulates a validation set from actual paths. Export hands it
// back as a plain-text card. See src/lib/truthLog.js for the record shape and
// report format; this file is only the UI.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useState, useEffect } from 'react';
import { T } from './theme.js';
import { exportText } from './SavedShots.jsx';
import {
  makeTruthEntry, loadTruth, persistTruth, scoreEntry,
  formatTruthReport, truthFilename, TRUTH_MAX, buildSubmission,
} from '../lib/truthLog.js';

// Where a card goes when the operator says yes. EMPTY BY DESIGN: with no
// address set, SEND opens the device's own share sheet and the operator picks
// the app and the recipient. Nothing is ever transmitted by this app — the
// operator's mail or messaging client does it, with the payload in front of
// them and their finger on send. Setting an address here only pre-fills the
// "to" field of that draft; it does not make the app send anything itself.
var AUTHOR_CONTACT = '';

// Remembers whether the operator has been asked, so the card is offered once
// rather than nagging on every open.
var ASK_KEY = 'hfcalc_truth_ask_v1';
function loadAsk() {
  try { return localStorage.getItem(ASK_KEY) || ''; } catch (e) { return ''; }
}
function saveAsk(v) {
  try { localStorage.setItem(ASK_KEY, v); } catch (e) { /* ignore */ }
}

export function TruthLog({ currentShot, appVersion }) {
  var [entries, setEntries] = useState(loadTruth);
  var [open, setOpen] = useState(false);
  var [note, setNote] = useState('');
  var [flash, setFlash] = useState(null);
  var [persistFailed, setPersistFailed] = useState(false);
  // '' = never asked, 'never' = declined for good, 'later' = not this session.
  var [askState, setAskState] = useState(loadAsk);
  var [exact, setExact] = useState(false);

  // Persist as an effect of the list changing — never alongside a click
  // handler working from a stale snapshot (the saved-shots resurrection bug).
  useEffect(function() { setPersistFailed(!persistTruth(entries)); }, [entries]);

  function say(msg) { setFlash(msg); setTimeout(function() { setFlash(null); }, 1800); }

  function log(outcome) {
    if (!currentShot) return;
    var entry = makeTruthEntry(currentShot, outcome, note, new Date());
    // Decide the flash BEFORE the state update, from this render's list —
    // reading a variable assigned inside the updater races React's scheduling
    // (updaters can be deferred or re-run), and the old code only ever showed
    // OLDEST DROPPED on the "failed" branch anyway (Iris round 2, minor).
    var dropped = entries.length >= TRUTH_MAX;
    setEntries(function(cur) { return [entry].concat(cur).slice(0, TRUTH_MAX); });
    setNote('');
    setOpen(true);
    // "Not now" and "already sent" both mean "ask again when there is new
    // data" — a fresh shot is new data. "Don't ask" is permanent.
    if (askState === 'later' || askState === 'sent') { saveAsk(''); setAskState(''); }
    say((outcome === 'worked' ? 'LOGGED — WORKED' : 'LOGGED — DIDN’T')
      + (dropped ? ' · OLDEST DROPPED' : ''));
  }

  function remove(id) {
    setEntries(function(cur) { return cur.filter(function(e) { return e.id !== id; }); });
  }

  function doExport() {
    if (!entries.length) return;
    exportText(formatTruthReport(entries, appVersion), truthFilename(new Date()), say);
  }

  // Hand the card back. Web Share first — on a phone that is the native sheet,
  // so the operator chooses Mail / Signal / whatever and the recipient, and
  // sees the text before it goes. Falls back to a mailto: draft, then to the
  // clipboard. Every route ends with a human pressing send in another app;
  // this function never puts anything on the network itself.
  function doSend() {
    if (!entries.length) return;
    var sub = buildSubmission(entries, appVersion, exact ? 'exact' : 'degree');
    saveAsk('sent');
    setAskState('sent');
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        navigator.share({ title: sub.subject, text: sub.body })
          .then(function() { say('SHARE SHEET OPENED'); },
                function() { /* operator cancelled — nothing to report */ });
        return;
      }
      var href = 'mailto:' + encodeURIComponent(AUTHOR_CONTACT)
        + '?subject=' + encodeURIComponent(sub.subject)
        + '&body=' + encodeURIComponent(sub.body);
      if (href.length < 6000) { window.location.href = href; say('EMAIL DRAFT OPENED'); return; }
      exportText(sub.body, truthFilename(new Date()), say);
    } catch (e) {
      exportText(sub.body, truthFilename(new Date()), say);
    }
  }

  var scored = entries.map(scoreEntry);
  var hits = scored.filter(function(x) { return x === 'hit'; }).length;
  var misses = scored.filter(function(x) { return x === 'miss'; }).length;

  var btn = { border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 12px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer' };

  return (
    <div className="usmc-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>Field Truth Log</div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>
            {entries.length
              ? entries.length + ' logged' + (hits + misses ? ' · ' + hits + '/' + (hits + misses) + ' predicted' : '')
              : 'After a shot: did it close? One tap builds real validation data.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {flash && <span style={{ color: T.accentText, fontSize: '0.64rem', fontWeight: 700 }}>{flash}</span>}
          <button onClick={function() { setOpen(!open); }} style={{ ...btn, background: open ? T.accentDim : T.surfaceHi, color: T.textPrim }}>
            {open ? 'CLOSE' : 'OPEN'}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {/* Asked once, when there is actually something worth sending, and
              never again after an answer. A prompt that reappears on every
              open teaches the operator to dismiss it without reading. */}
          {entries.length > 0 && askState !== 'never' && askState !== 'later' && askState !== 'sent' && (
            <div style={{ background: T.surfaceHi, border: '1px solid ' + T.borderHi, borderLeft: '3px solid ' + T.accent, borderRadius: 6, padding: '11px 13px', marginBottom: 12 }}>
              <div style={{ color: T.accentText, fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.06em', marginBottom: 4 }}>
                SEND THIS BACK?
              </div>
              <div style={{ color: T.textBody, fontSize: '0.76rem', lineHeight: 1.55 }}>
                {'Send these ' + entries.length + ' result'
                  + (entries.length === 1 ? '' : 's')
                  + ' to the author of this app, Cpl Angeles-Gonzalez, so the predictions can be measured against what actually happened? '
                  + 'Real shots are the only thing that can improve the model — VOACAP cannot provide them, because VOACAP is a model too.'}
              </div>
              <div style={{ color: T.textSec, fontSize: '0.72rem', lineHeight: 1.55, marginTop: 7 }}>
                <strong style={{ color: T.textPrim }}>What goes:</strong>{' '}
                {'frequency, distance, the MUF/FOT/LUF the app predicted, your power and month, the hour, the space weather at the time, whether it closed, and your note.'}
              </div>
              <div style={{ color: T.textSec, fontSize: '0.72rem', lineHeight: 1.55, marginTop: 4 }}>
                <strong style={{ color: T.textPrim }}>Your grids:</strong>{' '}
                {exact
                  ? 'EXACT, as entered. Only do this in training or if position is not sensitive.'
                  : 'rounded to whole degrees (~60 NM) — the resolution the model works at anyway, so nothing useful is lost.'}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, cursor: 'pointer' }}>
                <input type="checkbox" checked={exact} onChange={function(e) { setExact(e.target.checked); }} />
                <span style={{ color: T.textMute, fontSize: '0.7rem' }}>Send exact grids instead</span>
              </label>
              <div style={{ color: T.textDim, fontSize: '0.64rem', lineHeight: 1.45, marginTop: 6 }}>
                {'Nothing is transmitted by the app. Tapping SEND opens your own share sheet or email draft with the text in it — you choose who it goes to and you press send.'}
              </div>
              <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={doSend}
                  style={{ ...btn, flex: 1, minWidth: 120, padding: '10px 0', background: T.accent, color: '#0e1409', border: 'none' }}>
                  SEND IT
                </button>
                <button onClick={function() { saveAsk('later'); setAskState('later'); }}
                  style={{ ...btn, flex: 1, minWidth: 90, padding: '10px 0', background: T.bg, color: T.textPrim }}>
                  NOT NOW
                </button>
                <button onClick={function() { saveAsk('never'); setAskState('never'); }}
                  style={{ ...btn, flex: 1, minWidth: 90, padding: '10px 0', background: T.bg, color: T.textDim }}>
                  DON’T ASK
                </button>
              </div>
            </div>
          )}

          {!currentShot && (
            <div style={{ color: T.textMute, fontSize: '0.74rem', marginBottom: 12 }}>
              Run a calculation first — then log whether the path actually closed.
            </div>
          )}

          {currentShot && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: T.textSec, fontWeight: 600, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Did this shot close?
              </div>
              <input
                value={note}
                onChange={function(e) { setNote(e.target.value); }}
                placeholder="optional note — antenna, terrain, interference"
                maxLength={200}
                style={{ width: '100%', padding: '8px 10px', background: T.bg, color: T.textPrim, border: '1px solid ' + T.border, borderRadius: 5, fontSize: '0.76rem', marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={function() { log('worked'); }}
                  style={{ ...btn, flex: 1, padding: '11px 0', background: T.accent, color: '#0e1409', border: 'none' }}>
                  ✓ IT CLOSED
                </button>
                <button onClick={function() { log('failed'); }}
                  style={{ ...btn, flex: 1, padding: '11px 0', background: '#3a1810', color: '#ff9b86', border: '1px solid #7a3428' }}>
                  ✕ IT DIDN’T
                </button>
              </div>
            </div>
          )}

          {persistFailed && (
            <div style={{ background: '#2a1410', border: '1px solid #7a3428', borderRadius: 6, padding: '9px 11px', marginBottom: 10, color: '#ffd9d0', fontSize: '0.74rem', lineHeight: 1.5 }}>
              <strong style={{ color: '#ff9b86' }}>NOT SAVED TO THIS DEVICE.</strong>{' '}
              Storage is full or blocked — export now or you will lose these entries.
            </div>
          )}

          {entries.length > 0 && (
            <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
              <button onClick={doSend}
                style={{ ...btn, flex: 2, padding: '9px 0', background: T.surfaceHi, color: T.textPrim }}>
                SEND BACK ({entries.length})
              </button>
              <button onClick={doExport}
                style={{ ...btn, flex: 1, padding: '9px 0', background: T.bg, color: T.textSec }}>
                EXPORT
              </button>
            </div>
          )}

          {entries.length === 0 && (
            <div style={{ color: T.textMute, fontSize: '0.74rem' }}>Nothing logged yet.</div>
          )}

          {entries.map(function(e) {
            var sc = scoreEntry(e);
            var worked = e.outcome === 'worked';
            return (
              <div key={e.id} style={{ background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '9px 11px', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: worked ? T.accentText : '#ff9b86', fontSize: '0.74rem', fontWeight: 700 }}>
                    {(worked ? '✓ CLOSED' : '✕ DIDN’T')
                      + (e.freqMHz != null ? ' · ' + e.freqMHz + ' MHz' : '')
                      + (sc === 'miss' ? '  · SURPRISE' : '')}
                  </div>
                  <div style={{ color: T.textMute, fontSize: '0.62rem', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(e.dtg || '') + (e.note ? ' · ' + e.note : '')}
                  </div>
                </div>
                <button onClick={function() { remove(e.id); }} title="Delete entry" aria-label="Delete truth-log entry"
                  style={{ ...btn, background: 'transparent', color: T.textDim, borderColor: T.border, padding: '6px 9px', flexShrink: 0 }}>✕</button>
              </div>
            );
          })}

          <div style={{ color: T.textDim, fontSize: '0.62rem', marginTop: 8, lineHeight: 1.45 }}>
            Stored on this device only. Export copies a plain-text card (or downloads a .txt) — send it back and the model gets measured against your real paths.
          </div>
        </div>
      )}
    </div>
  );
}
