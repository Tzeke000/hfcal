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
// Where the Android app is downloaded: the public release page the build
// publishes (no GitHub login, never expires — README "Android APK").
export var ANDROID_DOWNLOAD_URL = 'https://github.com/Tzeke000/hfcal/releases/tag/android';
// The same for the Windows installer (v1.65).
export var WINDOWS_DOWNLOAD_URL = 'https://github.com/Tzeke000/hfcal/releases/tag/windows';

// True inside the installed Android/iOS app. Capacitor's bridge defines
// window.Capacitor before any page script runs; a browser never has it.
export function isNativeApp() {
  try {
    var C = typeof window !== 'undefined' ? window.Capacitor : null;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  } catch (e) { return false; }
}

// True inside the Windows desktop app (Tauri), which serves the page from
// https://tauri.localhost/ (tauri://localhost on Mac/Linux) with every file
// already installed — the same position as the Android app, so it had the
// same blind spots: an update check that asked its own files, a second
// offline copy of itself, and an INSTALL offer. Tauri defines __TAURI_IPC__.
export function isDesktopApp() {
  try {
    var l = window.location;
    return l.protocol === 'tauri:' || l.hostname === 'tauri.localhost'
      || !!(window.__TAURI_IPC__ || window.__TAURI_METADATA__ || window.__TAURI__);
  } catch (e) { return false; }
}

// Installed as a real app (Android or Windows): every file ships inside it.
export function isInstalledApp() { return isNativeApp() || isDesktopApp(); }

// Where THIS kind of installed app gets its next version.
export function appDownloadUrl() { return isDesktopApp() ? WINDOWS_DOWNLOAD_URL : ANDROID_DOWNLOAD_URL; }

// Base URL for share links and QR codes. The page's own address only when it
// is a real web address someone else can open; the website otherwise.
export function shareBase() {
  try {
    if (isInstalledApp()) return SITE_URL;
    var l = window.location;
    if (!/^https?:$/.test(l.protocol) || /(^|\.)localhost$/i.test(l.hostname)) return SITE_URL;
    return l.origin + l.pathname;
  } catch (e) { return SITE_URL; }
}
