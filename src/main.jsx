import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import HFCalc from './HFCalc.jsx';

// Register the service worker so the app works offline after first load.
// Auto-update strategy: when a new version is deployed, fetch it in the
// background and reload on next launch.
if (typeof window !== 'undefined') {
  registerSW({
    onNeedRefresh() {
      // A new version is available; it will activate on next launch.
    },
    onOfflineReady() {
      // The app is ready to work offline.
    },
  });
}

const root = createRoot(document.getElementById('root'));
root.render(<HFCalc />);
