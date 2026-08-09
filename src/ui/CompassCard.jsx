// The magnetometer compass card.
//
// Split out of HFCalc.jsx in v1.26. This component is where the first bug an
// operator ever reported lived: close the card, walk somewhere, open it again
// and the needle stayed pointed where you had been standing. Closing detaches
// the sensor listeners, so re-opening has to re-attach them — see toggle()
// below, and tests/ui/flows.test.mjs, which fails if that stops happening.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useState, useRef, useEffect, useCallback } from 'react';
import { T } from './theme.js';
import {
  declination, trueToMagnetic, norm360, relativeTurn, formatDeclination,
  isDeclinationModelCurrent, WMM_VALID_UNTIL,
} from '../physics/magnetic.js';

// ── COMPASS ───────────────────────────────────────────────────────────────────
// Uses the phone's magnetometer (DeviceOrientation) — a sensor, not a network
// service, so it works with the radio off like everything else here. Lives
// under TARGET STATION and works with no calculation run, because if it is the
// only compass a Marine has on them it should not be gated behind anything.
//
// Deliberately framed as an AID. Phone magnetometers are +/-5-15 deg at best
// and degrade badly near vehicles, radios, weapons and body armour — which is
// most of where this gets used. The lensatic compass remains the reference.
export function CompassCard({ selfLat, selfLon, targetBearingTrue }) {
  var [open, setOpen] = useState(false);
  var [status, setStatus] = useState('idle');   // idle|active|denied|unsupported
  var [headingMag, setHeadingMag] = useState(null);
  var [stale, setStale] = useState(false);
  var handlerRef = useRef(null);
  var lastFixRef = useRef(0);
  var unsupportedTimerRef = useRef(null);   // the 'no magnetometer' verdict timer
  var grantedRef = useRef(false);   // permission already granted this session

  // Continuous (unwrapped) rotation for the dial. Feeding norm360 headings
  // straight into an animated transform makes the card whirl 358 degrees the
  // long way round every time the heading crosses north — precisely where an
  // operator is most likely to be aiming. Accumulate the short-way delta
  // instead. (Assigning the ref during render is safe here: after prev is set
  // to the current heading, a repeated render adds exactly zero.)
  var rotRef = useRef(0);
  var prevHeadingRef = useRef(null);

  var decl = (typeof selfLat === 'number' && typeof selfLon === 'number')
    ? declination(selfLat, selfLon) : null;
  var hasDecl = typeof decl === 'number';
  // A stale reading is treated as no reading — never draw a needle that is not live.
  var liveHeading = (headingMag !== null && !stale) ? headingMag : null;
  if (liveHeading !== null) {
    if (prevHeadingRef.current !== null) {
      rotRef.current += relativeTurn(prevHeadingRef.current, liveHeading);
    } else {
      rotRef.current = liveHeading;
    }
    prevHeadingRef.current = liveHeading;
  }
  var headingTrue = (liveHeading !== null && hasDecl) ? norm360(liveHeading + decl) : null;
  var targetMag = (typeof targetBearingTrue === 'number' && hasDecl)
    ? trueToMagnetic(targetBearingTrue, decl) : null;
  var turn = (liveHeading !== null && targetMag !== null) ? relativeTurn(liveHeading, targetMag) : null;

  // useCallback so `attach` has a stable identity and can be listed honestly
  // in the dependency arrays of the effects that use it (Part 32 — the hooks
  // lint made every closure/dep-list mismatch an error after one of them
  // served stale state through the AI layer for two releases).
  var detach = useCallback(function() {
    if (handlerRef.current) {
      window.removeEventListener('deviceorientationabsolute', handlerRef.current);
      window.removeEventListener('deviceorientation', handlerRef.current);
      handlerRef.current = null;
    }
    // Cancel the pending 'unsupported' verdict. Without this, a quick
    // open->close before the first reading latched the card as unsupported
    // forever, even on a phone with a working compass.
    if (unsupportedTimerRef.current) {
      clearTimeout(unsupportedTimerRef.current);
      unsupportedTimerRef.current = null;
    }
  }, []);
  useEffect(function() { return detach; }, [detach]);

  var onOrientation = useCallback(function(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading;                  // iOS: already magnetic heading
    } else if (typeof e.alpha === 'number' && isFinite(e.alpha) && (e.absolute || e.type === 'deviceorientationabsolute')) {
      h = norm360(360 - e.alpha);                  // Android absolute: alpha is CCW from north
    }
    if (h !== null) {
      lastFixRef.current = Date.now();
      setHeadingMag(norm360(h));
      setStale(false);
      setStatus('active');
    }
  }, []);

  // Attach the sensor listeners. Separate from start() because re-opening the
  // card (or returning to the tab) must re-attach WITHOUT re-prompting for
  // permission — iOS only grants requestPermission() from a user gesture.
  var attach = useCallback(function() {
    detach();
    handlerRef.current = onOrientation;
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    lastFixRef.current = 0;
    setStale(false);
    unsupportedTimerRef.current = setTimeout(function() {
      unsupportedTimerRef.current = null;
      // Nothing arrived at all -> there is no usable magnetometer here.
      if (!lastFixRef.current) setStatus(function(cur) { return cur === 'active' ? cur : 'unsupported'; });
    }, 2500);
  }, [detach, onOrientation]);

  function start() {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      setStatus('unsupported'); return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function(res) {
        if (res === 'granted') { grantedRef.current = true; attach(); }
        else setStatus('denied');
      }).catch(function() { setStatus('denied'); });
    } else {
      grantedRef.current = true;
      attach();
    }
  }

  function toggle() {
    var next = !open;
    setOpen(next);
    if (next) {
      // Always re-arm on open. Closing detaches the listeners, so without this
      // a re-opened card kept rendering its last heading — a compass frozen
      // pointing wherever you happened to be standing when you closed it.
      if (status === 'denied' || status === 'unsupported') return;
      if (grantedRef.current) attach(); else start();
    } else {
      detach();
      setHeadingMag(null);   // nothing stale left to draw
      prevHeadingRef.current = null;   // restart the unwrapped rotation cleanly
      setStale(false);
    }
  }

  // Watchdog: if the sensor stops feeding while the card is open, say so
  // instead of leaving a dead needle on screen.
  useEffect(function() {
    if (!open || status !== 'active') return;
    var id = setInterval(function() {
      setStale(lastFixRef.current > 0 && Date.now() - lastFixRef.current > 3000);
    }, 1000);
    return function() { clearInterval(id); };
  }, [open, status]);

  // Browsers stop delivering orientation events to a backgrounded tab and do
  // not always resume — re-attach when we come back to the foreground.
  useEffect(function() {
    if (!open) return;
    function onVis() {
      if (document.visibilityState !== 'visible') return;
      if (status === 'denied' || status === 'unsupported') return;
      if (grantedRef.current) attach();
    }
    document.addEventListener('visibilitychange', onVis);
    return function() { document.removeEventListener('visibilitychange', onVis); };
  }, [open, status, attach]);

  // ── dial ──
  var R = 86, CX = 100, CY = 100;
  var ticks = [];
  for (var d = 0; d < 360; d += 15) {
    var major = d % 90 === 0, mid = d % 45 === 0;
    var len = major ? 14 : mid ? 10 : 6;
    var rad = (d - 90) * Math.PI / 180;
    ticks.push(
      <line key={d}
        x1={CX + (R - len) * Math.cos(rad)} y1={CY + (R - len) * Math.sin(rad)}
        x2={CX + R * Math.cos(rad)} y2={CY + R * Math.sin(rad)}
        stroke={major ? T.accentText : T.textMute} strokeWidth={major ? 2.5 : 1.2} />
    );
  }
  var cards = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(function(c) {
    var rad = (c[1] - 90) * Math.PI / 180, rr = R - 30;
    return (
      <text key={c[0]} x={CX + rr * Math.cos(rad)} y={CY + rr * Math.sin(rad) + 6}
        textAnchor="middle" fontSize="19" fontWeight="800"
        fill={c[0] === 'N' ? '#e05a45' : T.textSec}>{c[0]}</text>
    );
  });
  var targetMark = null;
  if (targetMag !== null) {
    var tr = (targetMag - 90) * Math.PI / 180;
    targetMark = (
      <g>
        <line x1={CX} y1={CY} x2={CX + (R - 6) * Math.cos(tr)} y2={CY + (R - 6) * Math.sin(tr)}
          stroke={T.accent} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx={CX + (R - 6) * Math.cos(tr)} cy={CY + (R - 6) * Math.sin(tr)} r="7" fill={T.accent} />
      </g>
    );
  }

  var msg = {
    denied: 'Compass permission denied. Allow motion & orientation access in your browser settings, or use your lensatic compass.',
    unsupported: 'No usable compass sensor on this device (or the browser is blocking it). Use your lensatic compass — the bearing numbers above are still good.',
  }[status];

  return (
    <div className="usmc-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>Compass</div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>
            {status === 'active' && liveHeading !== null
              ? Math.round(liveHeading) + '° MAG' + (headingTrue !== null ? '  ·  ' + Math.round(headingTrue) + '° TRUE' : '')
              : stale ? 'Signal lost — re-acquiring…'
              : 'Aid for pointing the antenna — works offline'}
          </div>
        </div>
        <button onClick={toggle} style={{ background: open ? T.accentDim : T.surfaceHi, color: T.textPrim, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 16px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer', flexShrink: 0 }}>
          {open ? 'CLOSE' : 'OPEN'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {msg && (
            <div style={{ color: T.warn, fontSize: '0.76rem', lineHeight: 1.55, marginBottom: 12 }}>{msg}</div>
          )}

          {status !== 'denied' && status !== 'unsupported' && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
              <svg width="200" height="215" viewBox="0 0 200 215">
                {/* fixed index — the direction the phone is pointing */}
                <polygon points={(CX - 9) + ',6 ' + (CX + 9) + ',6 ' + CX + ',20'} fill={T.warn} />
                <circle cx={CX} cy={CY} r={R} fill={T.bg} stroke={T.borderHi} strokeWidth="2" />
                <g transform={'rotate(' + (liveHeading === null ? 0 : -rotRef.current) + ' ' + CX + ' ' + CY + ')'}
                   style={{ transition: 'transform 120ms linear', opacity: liveHeading === null ? 0.25 : 1 }}>
                  {ticks}{cards}{targetMark}
                </g>
                <circle cx={CX} cy={CY} r="4" fill={T.textMute} />
                <text x={CX} y="207" textAnchor="middle" fontSize="12" fontWeight="700" fill={stale ? T.warn : T.textMute}>
                  {stale ? 'SIGNAL LOST — RE-ACQUIRING…'
                    : liveHeading === null ? 'ACQUIRING…'
                    : Math.round(liveHeading) + '° MAGNETIC'}
                </text>
              </svg>
            </div>
          )}

          {turn !== null && (
            <div style={{ background: T.bg, border: '1px solid ' + T.border, borderLeft: '3px solid ' + (Math.abs(turn) <= 5 ? T.accent : T.warn), borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ color: Math.abs(turn) <= 5 ? T.accent : T.textPrim, fontWeight: 700, fontSize: '0.86rem' }}>
                {Math.abs(turn) <= 5 ? 'ON BEARING — antenna points at the target'
                  : 'Turn ' + Math.abs(Math.round(turn)) + '° ' + (turn > 0 ? 'RIGHT' : 'LEFT')}
              </div>
              <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 3 }}>
                {'Target ' + Math.round(targetBearingTrue) + '° true = ' + Math.round(targetMag) + '° magnetic'}
              </div>
            </div>
          )}

          {targetMag === null && (
            <div style={{ color: T.textMute, fontSize: '0.74rem', lineHeight: 1.5, marginBottom: 10 }}>
              {hasDecl
                ? 'Run a calculation and the bearing to your target is marked on the dial with a turn-left / turn-right cue.'
                : 'Enter your location above to convert between true and magnetic north.'}
            </div>
          )}

          {hasDecl && (
            <div style={{ background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '9px 11px', marginBottom: 10 }}>
              <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em' }}>DECLINATION AT YOUR POSITION</div>
              <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.92rem', marginTop: 3 }}>{formatDeclination(decl)}</div>
              <div style={{ color: T.textSec, fontSize: '0.72rem', marginTop: 3, lineHeight: 1.5 }}>
                {decl >= 0
                  ? 'Magnetic north is ' + Math.abs(decl).toFixed(1) + '° east of true north — subtract it from a true bearing to get the compass number.'
                  : 'Magnetic north is ' + Math.abs(decl).toFixed(1) + '° west of true north — add it to a true bearing to get the compass number.'}
              </div>
              {!isDeclinationModelCurrent() && (
                <div style={{ color: T.warn, fontSize: '0.7rem', marginTop: 5 }}>
                  {'Magnetic model expired ' + WMM_VALID_UNTIL.toISOString().slice(0, 10)
                    + ' — declination may be off by a degree or more, and it will drift further. Update the app.'}
                </div>
              )}
            </div>
          )}

          <div style={{ background: '#2a1410', border: '1px solid #7a3428', borderLeft: '3px solid #c4442e', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ color: '#ff9b86', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>AID ONLY — NOT A LENSATIC</div>
            <div style={{ color: '#e0b5ab', fontSize: '0.74rem', lineHeight: 1.55 }}>
              A phone magnetometer is good to roughly ±5–15° and goes badly wrong near vehicles, radios, weapons, body armour and anything steel. Step well clear of metal, and confirm anything that matters with your lensatic compass.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
