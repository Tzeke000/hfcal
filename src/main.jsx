import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import HFCalc from './ui/HFCalc.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.js';

// Register the service worker so the app works offline after first load.
// Auto-update strategy: when a new version is deployed, fetch it in the
// background and reload on next launch.
if (typeof window !== 'undefined') {
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
