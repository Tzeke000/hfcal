// Saved shots, local storage for them, and comm-card export.
//
// Split out of HFCalc.jsx in v1.26. Two of the three bugs reported from real
// use were in this code: a deleted shot coming back (a handler filtering the
// list it had closed over) and one delete removing two rows (Date.now() ids
// colliding inside a millisecond). Both fixes are load-bearing and both are
// pinned by tests/ui/flows.test.mjs.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useState, useEffect } from 'react';
import { T } from './theme.js';
import { dtg, formatCommCard, shotLabel, commCardFilename } from '../lib/commCard.js';

// ── SAVED SHOTS ───────────────────────────────────────────────────────────────
// Field workflow: you plan several links in a day. Save each one, export any
// of them later as a plain-text comm card (copy to clipboard, or download as
// a .txt when the clipboard API is unavailable). All local storage — nothing
// leaves the device.
// Last-used station locations. Prefilled on next launch so a Marine working
// the same link (or the same OP) does not retype grids every time — the same
// idea as the 7.3 MHz and 3-inch leg-end defaults. Written only after a
// calculation succeeds, so the cache always holds a known-good pair.
// Cleared via "CLEAR SAVED DATA" in Saved Shots or window.HFCalc.reset().
export const LOCS_KEY = 'hfcalc_locs_v1';
// Home-station default for "Your Location", in the same spirit as the 7.3 MHz
// and 3-inch leg-end defaults: MCAS Cherry Point, Havelock NC. Used until the
// operator runs a calculation from somewhere else, after which the last
// known-good pair is remembered instead.
const DEFAULT_STATION = '34.9008,-76.8806';   // MCAS Cherry Point, NC
export const DEFAULT_LOC1 = DEFAULT_STATION;
export const DEFAULT_LOC2 = DEFAULT_STATION;
function defaultLocs() { return { loc1: DEFAULT_LOC1, loc2: DEFAULT_LOC2 }; }
export function loadCachedLocs() {
  try {
    var raw = localStorage.getItem(LOCS_KEY);
    var v = raw ? JSON.parse(raw) : null;
    return (v && typeof v.loc1 === 'string' && typeof v.loc2 === 'string') ? v : defaultLocs();
  } catch (e) { return defaultLocs(); }
}
export function saveCachedLocs(loc1, loc2) {
  try { localStorage.setItem(LOCS_KEY, JSON.stringify({ loc1: loc1, loc2: loc2 })); } catch (e) {}
}
export function clearCachedLocs() {
  try { localStorage.removeItem(LOCS_KEY); } catch (e) {}
}

const SHOTS_KEY = 'hfcalc_shots_v1';
// Date.now() alone collides when two saves land in the same millisecond, and
// a colliding id makes filter() delete both rows and React keys duplicate.
var shotSeq = 0;
function newShotId() {
  shotSeq += 1;
  return 'shot_' + Date.now() + '_' + shotSeq + '_' + Math.random().toString(36).slice(2, 8);
}
var SHOTS_MAX = 25;

function loadShots() {
  try {
    var raw = localStorage.getItem(SHOTS_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
// Returns false when the write did not happen. It used to swallow the failure
// and return nothing, so a full storage quota produced a cheerful "SAVED" and
// a shot that was gone at the next launch.
function persistShots(list) {
  try {
    localStorage.setItem(SHOTS_KEY, JSON.stringify(list.slice(0, SHOTS_MAX)));
    return true;
  } catch (e) { return false; }
}

// Copy text to the clipboard, falling back to a .txt download when the
// clipboard API is missing or blocked (common in webviews / non-HTTPS).
function exportText(text, filename, onDone) {
  function download() {
    try {
      var blob = new Blob([text], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      onDone('DOWNLOADED');
    } catch (e) { onDone('EXPORT FAILED'); }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() { onDone('COPIED'); }, download);
      return;
    }
  } catch (e) { /* fall through */ }
  download();
}

export function SavedShots({ currentShot, onClearStored }) {
  var [shots, setShots] = useState(loadShots);
  var [open, setOpen] = useState(false);
  var [flash, setFlash] = useState(null);

  // Persist as a effect of the list changing, never alongside each setState.
  // Writing inside the click handlers meant a handler working from a stale
  // closure could persist an out-of-date list — which is how deleting one
  // shot could resurrect an earlier one.
  var [persistFailed, setPersistFailed] = useState(false);
  useEffect(function() { setPersistFailed(!persistShots(shots)); }, [shots]);

  function note(msg) {
    setFlash(msg);
    setTimeout(function() { setFlash(null); }, 1800);
  }
  function saveCurrent() {
    if (!currentShot) return;
    // Stamp the id and DTG at SAVE time. currentShot is rebuilt during the
    // parent's render, and saving does not necessarily re-render the parent,
    // so reusing its id let two saves share one id — after which deleting
    // either removed both and the React keys collided.
    var stamped = Object.assign({}, currentShot, { id: newShotId(), dtg: dtg(new Date()) });
    var dropped = false;
    setShots(function(cur) {
      var next = [stamped].concat(cur);
      dropped = next.length > SHOTS_MAX;   // the oldest is about to fall off
      return next.slice(0, SHOTS_MAX);
    });
    setOpen(true);
    note(dropped ? 'SAVED \u2014 OLDEST DROPPED' : 'SAVED');
  }
  function doExport(shot) {
    exportText(formatCommCard(shot), commCardFilename(shot), note);
  }
  function remove(id) {
    // Functional update: always filter the CURRENT list, never the one this
    // handler happened to close over. Rapid taps used to each work from the
    // same pre-delete snapshot.
    setShots(function(cur) { return cur.filter(function(s) { return s.id !== id; }); });
  }

  var btn = { border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 12px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer' };

  return (
    <div className="usmc-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>Saved Shots &amp; Export</div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>
            {shots.length ? shots.length + ' saved · export any as a comm card' : 'Save this plan, export as a comm card'}
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
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={saveCurrent} disabled={!currentShot}
              style={{ ...btn, flex: 1, minWidth: 130, padding: '10px 12px', background: currentShot ? T.accent : T.surfaceHi, color: currentShot ? '#0e1409' : T.textDim, border: 'none', opacity: currentShot ? 1 : 0.6 }}>
              SAVE CURRENT
            </button>
            <button onClick={function() { if (currentShot) doExport(currentShot); }} disabled={!currentShot}
              style={{ ...btn, flex: 1, minWidth: 130, padding: '10px 12px', background: T.surfaceHi, color: currentShot ? T.textPrim : T.textDim, opacity: currentShot ? 1 : 0.6 }}>
              EXPORT CURRENT
            </button>
          </div>
          {!currentShot && (
            <div style={{ color: T.textMute, fontSize: '0.72rem', marginBottom: 12 }}>
              Run a calculation to enable saving and exporting the current plan.
            </div>
          )}

          {persistFailed && (
            <div style={{ background: '#2a1410', border: '1px solid #7a3428', borderRadius: 6, padding: '9px 11px', marginBottom: 10, color: '#ffd9d0', fontSize: '0.74rem', lineHeight: 1.5 }}>
              <strong style={{ color: '#ff9b86' }}>NOT SAVED TO THIS DEVICE.</strong>{' '}
              Storage is full or blocked, so these shots will be gone when you close the app.
              Export the ones you need now, or clear saved data to make room.
            </div>
          )}

          {shots.length >= SHOTS_MAX && (
            <div style={{ color: T.warn, fontSize: '0.72rem', marginBottom: 10, lineHeight: 1.5 }}>
              {'Holding the maximum ' + SHOTS_MAX + ' shots \u2014 saving another drops the oldest.'}
            </div>
          )}

          {shots.length === 0 && (
            <div style={{ color: T.textMute, fontSize: '0.74rem' }}>No saved shots yet.</div>
          )}

          {shots.map(function(s) {
            return (
              <div key={s.id} style={{ background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '9px 11px', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: T.textPrim, fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shotLabel(s)}
                  </div>
                  <div style={{ color: T.textMute, fontSize: '0.64rem', marginTop: 2 }}>{s.dtg}</div>
                </div>
                <button onClick={function() { doExport(s); }} style={{ ...btn, background: T.surfaceHi, color: T.textPrim, flexShrink: 0 }}>EXPORT</button>
                <button onClick={function() { remove(s.id); }}
                  title={'Delete ' + shotLabel(s)} aria-label={'Delete saved shot: ' + shotLabel(s)}
                  style={{ ...btn, background: 'transparent', color: T.textDim, borderColor: T.border, padding: '6px 9px', flexShrink: 0 }}>✕</button>
              </div>
            );
          })}

          <div style={{ color: T.textDim, fontSize: '0.62rem', marginTop: 8, lineHeight: 1.45 }}>
            Stored on this device only. Export copies the comm card to the clipboard (or downloads a .txt if the clipboard is unavailable).
          </div>
          <button
            onClick={function() {
              setShots([]);
              clearCachedLocs();
              if (onClearStored) onClearStored();
              note('CLEARED');
            }}
            style={{ ...btn, background: 'transparent', color: T.warn, borderColor: T.border, marginTop: 10, width: '100%', padding: '8px 0' }}>
            CLEAR SAVED DATA (SHOTS + REMEMBERED LOCATIONS)
          </button>
        </div>
      )}
    </div>
  );
}
