// One-time notice about the Android APK changing signing keys (v1.64).
//
// Every APK before November 2026 was signed with a throwaway key, so none of
// them can update in place to the signed APK: those operators must export,
// uninstall and reinstall once. The old APKs never contact the website, so
// the app cannot tell them itself — this notice runs on the WEBSITE copy of
// the app (where most of the ~46 installs are, iPhone included) so word gets
// round, and says plainly that iPhone and web-app users have nothing to do.
// Not shown inside the Android app: an APK new enough to show it is already
// the signed one. Dismissed for good with GOT IT; stops by itself after
// SHOW_UNTIL so new users months from now are not told about old history.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useState } from 'react';
import { T } from './theme.js';
import { isInstalledApp, ANDROID_DOWNLOAD_URL } from '../lib/platform.js';
import { ANDROID_SWITCH_KEY, shouldShowAndroidSwitch } from '../lib/androidSwitch.js';

export function AndroidSwitchNotice() {
  var [dismissed, setDismissed] = useState(function() {
    try { return localStorage.getItem(ANDROID_SWITCH_KEY) === '1'; } catch (e) { return false; }
  });
  // Not inside an installed app: an Android app new enough to show it is
  // already the signed one, and the Windows app has nothing to switch.
  if (!shouldShowAndroidSwitch(new Date(), isInstalledApp(), dismissed)) return null;

  function dismiss() {
    try { localStorage.setItem(ANDROID_SWITCH_KEY, '1'); } catch (e) { /* hides for this visit */ }
    setDismissed(true);
  }
  var step = { color: T.textBody, fontSize: '0.76rem', lineHeight: 1.55, margin: '3px 0' };
  return (
    <div className="usmc-card" data-android-switch style={{ marginBottom: 16, borderLeft: '3px solid ' + T.warn }}>
      <div style={{ color: T.warn, fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.12em' }}>ANDROID APP USERS ONLY</div>
      <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', marginTop: 4, lineHeight: 1.45 }}>
        iPhone, or using the app from the website? Nothing to do — tap GOT IT.
      </div>
      <div style={{ color: T.textBody, fontSize: '0.76rem', lineHeight: 1.55, marginTop: 8 }}>
        If you installed the <strong>Android app from an APK file</strong> before November 2026, it cannot update itself to the new version. One time only:
      </div>
      <div style={step}>1. In that app: TOOLS → Saved Shots → EXPORT anything you want to keep. Uninstalling deletes saved shots and the truth log.</div>
      <div style={step}>2. Uninstall the old app (long-press its icon → Uninstall).</div>
      <div style={step}>3. Install the new APK from the download page. After this, updates install over the top and keep your data.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <a href={ANDROID_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer"
          style={{ background: T.surfaceHi, color: T.textPrim, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '9px 14px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textDecoration: 'none' }}>
          ANDROID DOWNLOAD PAGE
        </a>
        <button onClick={dismiss}
          style={{ background: T.accent, color: '#0e1409', border: 'none', borderRadius: 6, padding: '9px 16px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer' }}>
          GOT IT
        </button>
      </div>
    </div>
  );
}
