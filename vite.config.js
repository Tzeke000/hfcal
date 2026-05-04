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
        name: 'HF Field Antenna Calc — by Cpl Angeles-Gonzalez',
        short_name: 'HF Antenna',
        description: 'USMC Field Expedient HF Antenna Calculator. Original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC. Works fully offline.',
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
    // Use terser for aggressive minification + variable mangling.
    // This makes the deployed JS much harder to read than the source,
    // while keeping the attribution banner intact via the `format.preamble`.
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // keep our authorship console banner
        passes: 2,
      },
      mangle: {
        // Preserve attribution-related identifiers so they remain recognizable
        // in stack traces and console output.
        reserved: ['AUTHOR_NAME', 'AUTHOR_BRANCH', 'AUTHOR_LINE', 'APP_SIGNATURE'],
        toplevel: true,
      },
      format: {
        // Banner injected at the top of the bundled JS — survives minification.
        preamble: '/*! HF Field Antenna Calculator — Original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC. Project signature: HFCALC-AG-EZK-USMC-v1. Released under CC BY-NC-ND 4.0. Unauthorized redistribution or claim of authorship is prohibited. */',
        comments: /^!/,
      },
    },
  },
});
