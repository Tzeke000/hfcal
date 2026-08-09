// SOI mode — your assigned frequencies, ranked for this path.
//
// Operators are ISSUED a handful of frequencies (the SOI/JCEOI); they do not
// pick freely. Enter the list once (persisted); for any path it shows which
// assigned frequency closes now and, for the ones that do not, the hour each
// one opens. The ranking lives in freqAdvisor.rankAssignedFrequencies; this is
// the card.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useState, useEffect } from 'react';
import { T } from './theme.js';
import { HOP } from '../physics/propagation.js';
import { rankAssignedFrequencies } from '../physics/freqAdvisor.js';

var SOI_KEY = 'hfcalc_soi_v1';

function loadSoi() {
  try {
    var raw = localStorage.getItem(SOI_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(function(f) { return typeof f === 'number' && isFinite(f) && f > 0; }) : [];
  } catch (e) { return []; }
}

export function SoiPanel({ results, pathCtx, month, txWatts, cachedSFI }) {
  var [open, setOpen] = useState(false);
  var [freqs, setFreqs] = useState(loadSoi);
  var [entry, setEntry] = useState('');
  var [tick, setTick] = useState(0);

  useEffect(function() {
    try { localStorage.setItem(SOI_KEY, JSON.stringify(freqs)); } catch (e) { /* ignore */ }
  }, [freqs]);

  // Re-rank on the wall clock while open, since "now" moves.
  useEffect(function() {
    if (!open) return;
    var id = setInterval(function() { setTick(function(t) { return t + 1; }); }, 60000);
    return function() { clearInterval(id); };
  }, [open]);

  function add() {
    var v = parseFloat(entry);
    if (isNaN(v) || v < 1 || v > 30) return;
    setFreqs(function(cur) {
      if (cur.indexOf(v) !== -1) return cur;
      return cur.concat(v).sort(function(a, b) { return a - b; });
    });
    setEntry('');
  }
  function remove(f) { setFreqs(function(cur) { return cur.filter(function(x) { return x !== f; }); }); }

  var ranked = null;
  if (results && pathCtx && freqs.length) {
    var now = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
    ranked = rankAssignedFrequencies({
      takeoffDeg: results.directive.mufTakeoffDeg, layerKm: HOP.F2.hKm,
      midLon: pathCtx.midLon, latDeg: pathCtx.midLat,
      magLatDeg: pathCtx.magLatDeg, modipDeg: pathCtx.modipDeg,
      ends: pathCtx.ends, bounces: pathCtx.bounces, hops: pathCtx.hops,
      distKm: results.geo.distKm, txWatts: txWatts, month: month,
      sfi: cachedSFI ? cachedSFI() : null,
    }, freqs, now);
  }

  var btn = { border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 12px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer' };
  function hz(h) { return String(Math.floor(((h % 24) + 24) % 24)).padStart(2, '0') + '00Z'; }
  function vColor(code) {
    return code === 'good' ? T.accent : code === 'near_muf' ? '#c8a24a'
         : code === 'low' ? '#a8a86a' : T.warn;
  }

  return (
    <div className="usmc-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>SOI — Assigned Frequencies</div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>
            {freqs.length ? freqs.length + ' assigned · ranked for this path' : 'Your issued frequencies, ranked: which closes now, which closes when'}
          </div>
        </div>
        <button onClick={function() { setOpen(!open); }} style={{ ...btn, background: open ? T.accentDim : T.surfaceHi, color: T.textPrim, flexShrink: 0 }}>
          {open ? 'CLOSE' : 'OPEN'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <label style={{ color: T.textSec, fontWeight: 600, fontSize: '0.68rem', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Assigned frequencies (MHz)
          </label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={entry} onChange={function(e) { setEntry(e.target.value); }}
              onKeyDown={function(e) { if (e.key === 'Enter') add(); }}
              type="number" min="1" max="30" step="0.1" placeholder="add MHz, e.g. 7.3"
              style={{ flex: 1, padding: '8px 10px', background: T.bg, color: T.textPrim, border: '1px solid ' + T.border, borderRadius: 5, fontSize: '0.8rem' }} />
            <button onClick={add} style={{ ...btn, background: T.accent, color: '#0e1409', border: 'none', padding: '8px 16px' }}>ADD</button>
          </div>

          {freqs.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {freqs.map(function(f) {
                return (
                  <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.bg, border: '1px solid ' + T.border, borderRadius: 5, padding: '4px 8px', fontSize: '0.72rem', color: T.textSec }}>
                    {f + ' MHz'}
                    <button onClick={function() { remove(f); }} aria-label={'Remove ' + f + ' MHz'}
                      style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1, padding: 0 }}>✕</button>
                  </span>
                );
              })}
            </div>
          )}

          {!freqs.length && (
            <div style={{ color: T.textMute, fontSize: '0.74rem' }}>Add the frequencies you were assigned. They stay on this device.</div>
          )}

          {freqs.length > 0 && !ranked && (
            <div style={{ color: T.textMute, fontSize: '0.74rem' }}>Run a calculation to rank these for the path.</div>
          )}

          {ranked && ranked.map(function(r) {
            var code = r.verdict ? r.verdict.code : null;
            return (
              <div key={r.freqMHz} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 8, alignItems: 'center', background: T.bg, border: '1px solid ' + (r.usableNow ? T.borderHi : T.border), borderLeft: '3px solid ' + vColor(code), borderRadius: 6, padding: '8px 11px', marginBottom: 6 }}>
                <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.9rem' }}>{r.freqMHz}</div>
                <div>
                  <div style={{ color: vColor(code), fontWeight: 700, fontSize: '0.72rem' }}>
                    {r.usableNow
                      ? (r.verdict ? r.verdict.label : 'USABLE') + ' NOW'
                      : (r.next ? 'OPENS ' + hz(r.next.utcHour) + ' (in ' + (r.next.inHours === 1 ? '1 h' : r.next.inHours + ' h') + ')'
                                : 'CLOSED ALL DAY at ' + txWatts + ' W')}
                  </div>
                  <div style={{ color: T.textMute, fontSize: '0.6rem', marginTop: 2 }}>
                    {'LUF ' + (r.luf != null ? r.luf.toFixed(1) : '--')
                      + '  FOT ' + (r.fot != null ? r.fot.toFixed(1) : '--')
                      + '  MUF ' + (r.muf != null ? r.muf.toFixed(1) : '--')}
                  </div>
                </div>
              </div>
            );
          })}

          {ranked && (
            <div style={{ color: T.textDim, fontSize: '0.62rem', marginTop: 6, lineHeight: 1.45 }}>
              Ranked for {new Date().getUTCHours().toString().padStart(2, '0')}00Z at {txWatts} W. Aim for the top of the list; "opens" times assume this power. Your SOI/JCEOI assignment governs.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
