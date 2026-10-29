// Where is this copy of the app running? (v1.63)
//
// The same build runs as the website (GitHub Pages) and inside the Android
// app (Capacitor). Inside the APK the page is served from https://localhost/
// with every file already on the phone, which the website code assumed never
// happens: a QR encoded "https://localhost/?from=…" (useless to whoever scans
// it), the offline-save worker copied 36 MB the APK already holds, the update
// banner asked the phone's own files whether they were out of date, and the
// header offered to INSTALL an app that was installed.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

// The public website — what a shared link or QR must point at.
export var SITE_URL = 'https://tzeke000.github.io/hfcal/';
// Where the Android app is downloaded (README "Android APK").
export var ANDROID_DOWNLOAD_URL = 'https://github.com/Tzeke000/hfcal/actions/workflows/build-android.yml';

// True inside the installed Android/iOS app. Capacitor's bridge defines
// window.Capacitor before any page script runs; a browser never has it.
export function isNativeApp() {
  try {
    var C = typeof window !== 'undefined' ? window.Capacitor : null;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  } catch (e) { return false; }
}

// Base URL for share links and QR codes. The page's own address only when it
// is a real web address someone else can open; the website otherwise.
export function shareBase() {
  try {
    if (isNativeApp()) return SITE_URL;
    var l = window.location;
    if (!/^https?:$/.test(l.protocol) || /(^|\.)localhost$/i.test(l.hostname)) return SITE_URL;
    return l.origin + l.pathname;
  } catch (e) { return SITE_URL; }
}
