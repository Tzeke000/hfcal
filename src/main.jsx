import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { isNativeApp } from './lib/platform.js';
import HFCalc from './ui/HFCalc.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.js';

// Register the service worker so the app works offline after first load.
// Auto-update strategy: when a new version is deployed, fetch it in the
// background and reload on next launch.
//
// Not inside the installed Android app: every file is already in the APK, and
// a worker there only made a second 36 MB copy — and kept serving the OLD
// copy after the APK was updated. Clear any worker an earlier APK registered.
if (typeof window !== 'undefined' && isNativeApp()) {
  // Unregister first, THEN clear: a worker still installing would otherwise
  // write its cache straight back.
  var clearCaches = function() {
    if (!window.caches || !caches.keys) return;
    caches.keys().then(function(keys) { keys.forEach(function(k) { caches.delete(k); }); })
      .catch(function() { /* no caches */ });
  };
  try {
    var sw = navigator.serviceWorker;
    if (sw && sw.getRegistrations) {
      sw.getRegistrations().then(function(regs) {
        return Promise.all(regs.map(function(r) { return r.unregister(); }));
      }).then(clearCaches, clearCaches);
    } else clearCaches();
  } catch (e) { /* nothing to clear */ }
} else if (typeof window !== 'undefined') {
  registerSW({
    onNeedRefresh() {
      // A new version is waiting. It does NOT auto-activate (registerType is
      // 'prompt'), so it cannot purge the running session's lazy chunks; the
      // in-app UpdateBanner applies it when the operator chooses.
    },
    onOfflineReady() {
      // The app is ready to work offline.
    },
  });
}

const root = createRoot(document.getElementById('root'));
root.render(
  <ErrorBoundary>
    <HFCalc />
  </ErrorBoundary>
);
