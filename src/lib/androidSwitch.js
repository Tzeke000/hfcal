// When to show the one-time Android signing-key notice (src/ui/AndroidSwitchNotice.jsx).
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

export var ANDROID_SWITCH_KEY = 'hfcalc_notice_android_switch_v1';
// After this the notice stops by itself: new users months from now do not
// need the history of a key change that happened before they arrived.
export var SHOW_UNTIL = '2027-03-01';

// Never inside the Android app (an APK new enough to show it is already the
// signed one), never once dismissed, never after SHOW_UNTIL.
export function shouldShowAndroidSwitch(now, native, dismissed) {
  if (native || dismissed) return false;
  return (now || new Date()).toISOString().slice(0, 10) < SHOW_UNTIL;
}
