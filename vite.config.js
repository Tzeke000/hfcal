import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// When deployed to GitHub Pages the app lives at /hfcal/.
// When running locally (npm run dev) or in a Capacitor wrapper, it's at /.
// Use a build env flag so each context gets the right base.
const isPagesBuild = process.env.PWA_BASE === '/hfcal/';

export default defineConfig({
  base: isPagesBuild ? '/hfcal/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png'],
      manifest: {
        name: 'HF Field Antenna Calc',
        short_name: 'HF Antenna',
        description: 'USMC Field Expedient HF Antenna Calculator — works fully offline',
        theme_color: '#080c07',
        background_color: '#080c07',
        display: 'standalone',
        orientation: 'portrait',
        start_url: isPagesBuild ? '/hfcal/' : '/',
        scope: isPagesBuild ? '/hfcal/' : '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,ico,woff2}'],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2500,
  },
});
