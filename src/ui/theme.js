// Field palette and global stylesheet, plus the component that injects it.
//
// Split out of HFCalc.jsx in v1.26: every component in the app reads T, so
// while it lived inside the big file nothing else could be extracted.
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { useEffect } from 'react';

// ── THEME ─────────────────────────────────────────────────────────────────────
export const T = {
  bg:          '#080c07',
  surface:     '#0e1510',
  surfaceHi:   '#141e10',
  surfaceHov:  '#192413',
  border:      '#1f2e17',
  borderHi:    '#2e4422',
  accent:      '#5a9e4b',
  accentDim:   '#2e5228',
  accentText:  '#7dc86b',
  brown:       '#7a5230',
  brownSurf:   '#1a1008',
  brownBorder: '#3a2010',
  warn:        '#c87c3a',
  warnSurf:    '#1a0e06',
  textPrim:    '#f0f4ee',
  textSec:     '#8aaa7a',
  textMute:    '#445a38',
  textBody:    '#c8d4c0',
  textDim:     '#3a4e30',
  oliveDim:    '#192413',
};

const FONT_BASE = import.meta.env.BASE_URL + 'fonts/';

const USMC_CSS = [
  // Inter is served from public/fonts/ rather than Google Fonts. The remote
  // @import fired on every page load, which both leaked usage to a third
  // party (an EMCON/telemetry concern for a field tool) and left the app
  // dependent on a network it is designed to work without.
  "@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-display:swap;src:url('" + FONT_BASE + "inter-latin-400-normal.woff2') format('woff2');}",
  "@font-face{font-family:'Inter';font-style:normal;font-weight:500;font-display:swap;src:url('" + FONT_BASE + "inter-latin-500-normal.woff2') format('woff2');}",
  "@font-face{font-family:'Inter';font-style:normal;font-weight:600;font-display:swap;src:url('" + FONT_BASE + "inter-latin-600-normal.woff2') format('woff2');}",
  "@font-face{font-family:'Inter';font-style:normal;font-weight:700;font-display:swap;src:url('" + FONT_BASE + "inter-latin-700-normal.woff2') format('woff2');}",
  "*, *::before, *::after { box-sizing: border-box; }",
  "html { -webkit-text-size-adjust: 100%; }",
  "body { background: #080c07 !important; margin: 0; color: #c8d4c0; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }",

  /* Cards */
  ".usmc-card { background: #0e1510; border: 1px solid #1f2e17; border-radius: 8px; padding: 18px; transition: border-color 0.15s; }",
  ".usmc-card-flat { background: #0e1510; border: 1px solid #1f2e17; border-radius: 8px; padding: 0; overflow: hidden; }",
  ".usmc-section-label { font-family: 'Inter', sans-serif; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #445a38; margin-bottom: 14px; }",

  /* Inputs */
  ".usmc-input { background: #080c07; border: 1.5px solid #1f2e17; color: #f0f4ee; width: 100%; border-radius: 6px; padding: 11px 14px; font-family: 'Inter', sans-serif; font-size: 0.92rem; outline: none; display: block; transition: border-color 0.15s, box-shadow 0.15s; -webkit-appearance: none; }",
  ".usmc-input:focus { border-color: #5a9e4b; box-shadow: 0 0 0 3px rgba(90,158,75,0.12); }",
  ".usmc-input::placeholder { color: #2e4422; }",
  ".usmc-input-error { border-color: #7a3a20 !important; box-shadow: 0 0 0 3px rgba(122,58,32,0.12) !important; }",
  ".usmc-input-ok { border-color: #2e5228 !important; }",

  /* Chip / badge */
  ".usmc-chip { display: inline-flex; align-items: center; font-family: 'Inter', sans-serif; font-size: 0.62rem; font-weight: 700; padding: 3px 9px; border-radius: 4px; margin-bottom: 10px; background: #141e10; color: #7dc86b; border: 1px solid #2e4422; letter-spacing: 0.09em; text-transform: uppercase; }",
  ".usmc-chip-primary { background: #2e5228; color: #f0f4ee; border-color: #5a9e4b; }",

  /* Stat cells */
  ".usmc-stat { background: #080c07; border: 1px solid #1f2e17; border-radius: 6px; padding: 10px 12px; }",
  ".usmc-stat-label { font-family: 'Inter', sans-serif; font-size: 0.6rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #445a38; margin-bottom: 4px; }",
  ".usmc-stat-val { font-family: 'Inter', sans-serif; font-size: 1.05rem; font-weight: 700; color: #f0f4ee; line-height: 1.2; }",
  ".usmc-stat-sub { font-family: 'Inter', sans-serif; font-size: 0.78rem; color: #8aaa7a; margin-top: 2px; }",

  /* Divider */
  ".usmc-divider { border: none; border-top: 1px solid #1f2e17; margin: 16px 0; }",

  /* Carousel */
  ".usmc-carousel { position: relative; background: #050805; }",
  ".usmc-carousel-img { width: 100%; display: block; aspect-ratio: 1 / 1; object-fit: contain; background: #050805; }",
  ".usmc-carousel-btn { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 56px; min-width: 44px; min-height: 44px; background: rgba(8,12,7,0.55); border: 1px solid rgba(125,200,107,0.25); color: #f0f4ee; font-size: 1.4rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; border-radius: 6px; transition: background 0.15s, border-color 0.15s; -webkit-tap-highlight-color: rgba(90,158,75,0.3); user-select: none; }",
  ".usmc-carousel-btn:hover, .usmc-carousel-btn:active { background: rgba(46,82,40,0.85); border-color: #5a9e4b; }",
  ".usmc-carousel-btn-left { left: 8px; }",
  ".usmc-carousel-btn-right { right: 8px; }",
  ".usmc-carousel-counter { position: absolute; top: 8px; right: 8px; background: rgba(8,12,7,0.7); color: #7dc86b; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.1em; padding: 4px 9px; border-radius: 4px; border: 1px solid rgba(46,68,34,0.6); }",
  ".usmc-carousel-dots { display: flex; gap: 8px; justify-content: center; padding: 10px 0 6px 0; background: #0e1510; }",
  ".usmc-carousel-dot { width: 8px; height: 8px; border-radius: 50%; border: none; padding: 0; cursor: pointer; background: #2e4422; transition: background 0.15s, transform 0.15s; -webkit-tap-highlight-color: transparent; }",
  ".usmc-carousel-dot-active { background: #5a9e4b; transform: scale(1.25); }",
  ".usmc-carousel-dot-hit { padding: 12px 4px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }",

  /* Buttons */
  "button { font-family: 'Inter', sans-serif; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }",
  "input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }",
  "input[type=number] { -moz-appearance: textfield; }",
  "ol, ul { margin: 0; padding: 0; list-style: none; }",

  /* Install banner pulsing arrow */
  "@keyframes usmcArrowPulse { 0%,100% { transform: translateX(0); opacity: 1; } 50% { transform: translateX(4px); opacity: 0.6; } }",

  /* ── Night (red-light) mode ───────────────────────────────────────────────
     Toggled via data-night on <html>. Strip colour from the whole app, then
     multiply a red veil over it: white text -> red, black stays black, so the
     result is red-on-black that keeps a Marine\u2019s dark adaptation. Applied
     globally so it needs no change to the T palette every component reads. */
  "html[data-night] body { filter: grayscale(1) brightness(0.85) contrast(1.05); }",
  "html[data-night] body::after { content: \"\"; position: fixed; inset: 0; background: #ff1a00; mix-blend-mode: multiply; pointer-events: none; z-index: 2147483000; }"
].join("\n");

// ── STYLE INJECTOR ────────────────────────────────────────────────────────────
export function USMCStyleInjector() {
  useEffect(function() {
    // CSS
    var style = document.createElement('style');
    style.textContent = USMC_CSS;
    document.head.appendChild(style);

    // NOTE: icons, the PWA manifest, the title and theme-color are all owned
    // by index.html + vite-plugin-pwa. This effect used to inject its own
    // duplicates at runtime — including a second manifest whose start_url
    // ("/HFCalc") does not exist on any deployment — which competed with the
    // real manifest during "Add to Home Screen". Removed in v1.7; only the
    // stylesheet is injected here now.

    return function() {
      try { document.head.removeChild(style); } catch(e) {}
    };
  }, []);
  return null;
}
