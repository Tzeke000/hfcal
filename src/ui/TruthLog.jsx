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
  formatTruthReport, truthFilename, TRUTH_MAX,
} from '../lib/truthLog.js';

export function TruthLog({ currentShot, appVersion }) {
  var [entries, setEntries] = useState(loadTruth);
  var [open, setOpen] = useState(false);
  var [note, setNote] = useState('');
  var [flash, setFlash] = useState(null);
  var [persistFailed, setPersistFailed] = useState(false);

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
            <button onClick={doExport}
              style={{ ...btn, width: '100%', padding: '9px 0', background: T.surfaceHi, color: T.textPrim, marginBottom: 10 }}>
              EXPORT TRUTH LOG ({entries.length}) — SEND IT BACK
            </button>
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
