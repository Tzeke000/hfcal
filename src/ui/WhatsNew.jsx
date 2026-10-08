// WHAT'S NEW — the last few updates and when each reached this device (v1.61).
//
// The release dates come from src/data/changelog.js. The INSTALLED dates are
// this device's own record: the first time each version opened here, kept in
// local storage. A version that predates the record says so plainly rather
// than guessing a date.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useState } from 'react';
import { T } from './theme.js';
import { CHANGELOG } from '../data/changelog.js';
import { loadVersionsSeen } from '../lib/versionsSeen.js';

var SHOW = 5;

function fmtDate(iso) {
  if (!iso) return null;
  var d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  if (isNaN(d.getTime())) return null;
  var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

export function WhatsNew({ appVersion }) {
  var [open, setOpen] = useState(false);
  var seen = loadVersionsSeen();
  var list = CHANGELOG.slice(0, SHOW);
  var btn = { border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 12px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer' };

  return (
    <div className="usmc-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>What’s New</div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>
            {'You are on v' + appVersion + ' · the last ' + list.length + ' updates and when they arrived here'}
          </div>
        </div>
        <button onClick={function() { setOpen(!open); }} style={{ ...btn, background: open ? T.accentDim : T.surfaceHi, color: T.textPrim, flexShrink: 0 }}>
          {open ? 'CLOSE' : 'OPEN'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {list.map(function(e) {
            var here = fmtDate(seen[e.version]);
            var current = e.version === appVersion;
            return (
              <div key={e.version} data-changelog-version={e.version}
                style={{ borderTop: '1px solid ' + T.border, padding: '10px 2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.78rem' }}>
                    {'v' + e.version + ' — ' + e.title}
                  </span>
                  {current && <span style={{ color: T.accentText, fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em' }}>CURRENT</span>}
                </div>
                <div style={{ color: T.textMute, fontSize: '0.64rem', marginTop: 3 }}>
                  {'Released ' + (fmtDate(e.date) || e.date) + ' · '
                    + (here ? 'installed on this device ' + here : 'before this device started keeping track')}
                </div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: T.textBody, fontSize: '0.74rem', lineHeight: 1.5 }}>
                  {e.notes.map(function(n, i) { return <li key={i}>{n}</li>; })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
