// A last line of defence around the whole app.
//
// The app reads saved shots and a remembered location pair straight out of
// localStorage at startup. One corrupt or partial entry — a shot written by an
// older version, storage truncated mid-write, a value hand-edited by a curious
// operator — used to throw during the first render, and with no boundary React
// unmounts everything: a white screen, on every launch, with no way out but
// clearing browser data most operators do not know how to reach.
//
// This catches any render-time throw and offers the one recovery an offline
// field app can offer: wipe the local state that most likely caused it and
// reload. It deliberately does NOT phone home or log anywhere — there is
// nowhere to phone from a mountainside.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, message: '' };
  }

  static getDerivedStateFromError(err) {
    return { failed: true, message: (err && err.message) ? String(err.message) : String(err) };
  }

  componentDidCatch() {
    // Intentionally no telemetry. An offline app has nowhere to report to,
    // and the recovery below does not need the stack.
  }

  clearAndReload() {
    // Wipe only this app's own keys, not the whole origin — the operator may
    // have unrelated things in storage. These are the keys the app writes.
    try {
      var keys = ['hfcalc_shots_v1', 'hfcalc_locs_v1', 'hfcalc_spacewx_v1'];
      for (var i = 0; i < keys.length; i++) {
        try { localStorage.removeItem(keys[i]); } catch (e) { /* keep going */ }
      }
    } catch (e) { /* localStorage itself unavailable — reload anyway */ }
    try { window.location.reload(); } catch (e) { /* nothing more we can do */ }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    var wrap = {
      minHeight: '100vh', background: '#080c07', color: '#f0f4ee',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', fontFamily: 'Inter, system-ui, sans-serif',
    };
    var card = {
      maxWidth: 460, background: '#0e1510', border: '1px solid #2e4422',
      borderRadius: 10, padding: '22px 24px',
    };
    var btn = {
      background: '#5a9e4b', color: '#0e1409', border: 'none', borderRadius: 6,
      padding: '11px 18px', fontSize: '0.8rem', fontWeight: 700,
      letterSpacing: '0.06em', cursor: 'pointer', marginTop: 16, width: '100%',
    };
    return (
      React.createElement('div', { style: wrap },
        React.createElement('div', { style: card },
          React.createElement('div', {
            style: { color: '#7dc86b', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.1em', marginBottom: 8 },
          }, 'HF FIELD ANTENNA — RECOVERY'),
          React.createElement('div', {
            style: { fontWeight: 700, fontSize: '1rem', marginBottom: 10 },
          }, 'The app hit a problem loading your saved data.'),
          React.createElement('div', {
            style: { color: '#c8d4c0', fontSize: '0.84rem', lineHeight: 1.6, marginBottom: 6 },
          }, 'This is almost always a saved shot or remembered location from an '
             + 'older version. Clearing that local data fixes it — your antenna '
             + 'and frequency calculations are not affected, only the saved list.'),
          React.createElement('div', {
            style: { color: '#445a38', fontSize: '0.68rem', fontFamily: 'monospace', marginTop: 8, wordBreak: 'break-word' },
          }, this.state.message),
          React.createElement('button', {
            style: btn, onClick: this.clearAndReload.bind(this),
          }, 'CLEAR SAVED DATA & RELOAD')
        )
      )
    );
  }
}
