import { useState, useCallback, useRef, useEffect } from "react";
import {
  WIRE_GAUGES, WIRE_CORES, computeVF,
  wavelength, toLengths, apexHeightPlan,
} from "./antennaMath.js";
import {
  geodesics, propagationZone, bearingToCardinal,
  calcTakeoffAngle, groundWaveMultiplier, chordalHopPossible, HOP, calcHops,
} from "./propagation.js";
import {
  SWPC_FLUX_URL, SWPC_KINDEX_URL,
  parseFluxPayload, parseKIndexPayload,
  interpretSFI, interpretKp, spaceWxAdvice,
} from "./spacewx.js";
import { assessFrequency, frequencyForecast, bestBlocks } from "./freqAdvisor.js";
import { dtg, formatCommCard, shotLabel, commCardFilename } from "./commCard.js";
import { parseCoords, looksLikeMGRS } from "./coords.js";
// Single source of truth for the app version (also drives the icon badge —
// regenerate icons with scripts/generate-icons.py after bumping it).
import { version as APP_VERSION } from "../package.json";

// ── THEME ─────────────────────────────────────────────────────────────────────
const T = {
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
  "@keyframes usmcArrowPulse { 0%,100% { transform: translateX(0); opacity: 1; } 50% { transform: translateX(4px); opacity: 0.6; } }"
].join("\n");

// ── WIRE PHYSICS ──────────────────────────────────────────────────────────────
// At HF frequencies, RF current flows almost entirely on the surface of a
// conductor (skin effect). This means:
//   - Wire diameter (gauge) matters for losses, not much for resonant length
//   - Core material matters most: copper conducts beautifully, steel less so,
//     iron poorly. But field-expedient antennas use "whatever you got."
//
// Velocity factor (VF) here represents the standard amateur-radio "K factor"
// used to multiply 468/freq for dipole length. Values come from ARRL Antenna
// Book tables, MIL-HDBK-419A, and field-test data for steel/CCS lines.
//
// IMPORTANT: VF varies slightly with gauge (thicker = lower VF for same core
// because d/λ is bigger → more end effect). The gauge-correction term is
// small but real (~1-2% over the AWG range we care about).

// WIRE_GAUGES, WIRE_CORES, gaugeCorrection, and computeVF now live in
// antennaMath.js (imported above) so they can be unit-tested with npm test.

// (The VELOCITY_FACTOR proxy shim was removed in v1.7 — every caller now
// passes an explicit velocity factor computed by computeVF().)

// ── ATTRIBUTION ───────────────────────────────────────────────────────────────
// This application is the original work of Cpl Angeles-Gonzalez, Ezekiel S.,
// United States Marine Corps. Unauthorized redistribution, repackaging, or
// claiming authorship of this work is prohibited.
//
// Project signature: HFCALC-AG-EZK-USMC-v1
// SHA-256 fingerprint: a7f9c3e2b1d4f8a6c5e9b2d7f4a1c8e3 (truncated)
// First published: 2026-05 by Tzeke000 on GitHub
//
// Removing or altering these notices does not transfer ownership of this work.
const AUTHOR_NAME = 'Cpl Angeles-Gonzalez, Ezekiel S.';
const AUTHOR_BRANCH = 'USMC';
const AUTHOR_LINE = AUTHOR_NAME + ' \u00b7 ' + AUTHOR_BRANCH;
const APP_SIGNATURE = 'HFCALC-AG-EZK-USMC-v1';

// Console banner shown when developer tools are opened. The styling makes it
// hard to miss for anyone digging into the code.
function _emitConsoleAttribution() {
  if (typeof console === 'undefined' || !console.log) return;
  try {
    var bigStyle = 'font-size: 18px; font-weight: 700; color: #5a9e4b; padding: 8px 0;';
    var subStyle = 'font-size: 12px; color: #c8d4c0; padding: 2px 0;';
    var warnStyle = 'font-size: 11px; color: #c87c3a; padding: 4px 0;';
    console.log('%cHF Field Antenna Calculator', bigStyle);
    console.log('%cMade by ' + AUTHOR_NAME + ' \u00b7 ' + AUTHOR_BRANCH, subStyle);
    console.log('%cSignature: ' + APP_SIGNATURE, subStyle);
    console.log('%cThis application is the original work of the named author.', warnStyle);
    console.log('%cUnauthorized redistribution or claim of authorship is prohibited.', warnStyle);
  } catch (e) { /* noop */ }
}
if (typeof window !== 'undefined') {
  // Defer so it runs after React mounts; also persist a marker on window so
  // anyone inspecting can confirm authorship.
  setTimeout(_emitConsoleAttribution, 100);
  try { window.__HFCALC_AUTHOR__ = AUTHOR_LINE; window.__HFCALC_SIG__ = APP_SIGNATURE; } catch (e) {}
}


// ── EMBEDDED IMAGES (base64) ──────────────────────────────────────────────────
// Images are embedded directly so the app works fully offline.

// App icon for the in-app header. Served from public/ (regenerated with the
// version badge by scripts/generate-icons.py) rather than embedded base64.
const ICON_192 = import.meta.env.BASE_URL + 'icon-192.png';

// Antenna reference photos live in public/antenna/ (extracted from the
// bundle in v1.7 by scripts/extract-images.py). Paths resolve against
// BASE_URL so they work at both '/' (Tauri, dev) and '/hfcal/' (Pages),
// and the service worker precaches them so offline use is unchanged.
const ANTENNA_IMG_BASE = import.meta.env.BASE_URL + 'antenna/';
const ANTENNA_IMAGES = {
  dipole: [
    { url: ANTENNA_IMG_BASE + 'dipole-1.jpg', caption: "Side view — wire, supports, center feed point, coax to radio" },
    { url: ANTENNA_IMG_BASE + 'dipole-2.jpg', caption: "Perspective view — full field setup with Harris radio" },
    { url: ANTENNA_IMG_BASE + 'dipole-3.jpg', caption: "Overhead view — wire span, center feed point, end insulators, coax drop to radio" },
  ],
  invertedv: [
    { url: ANTENNA_IMG_BASE + 'invertedv-1.jpg', caption: "Side view — apex angle, leg slopes, stakes, coax" },
    { url: ANTENNA_IMG_BASE + 'invertedv-2.jpg', caption: "Perspective view — center pole, wire legs to stakes, radio" },
    { url: ANTENNA_IMG_BASE + 'invertedv-3.jpg', caption: "Front-on view — apex feed point, 45° leg angles, stakes at each side" },
  ],
  sloper: [
    { url: ANTENNA_IMG_BASE + 'sloper-1.jpg', caption: "Side view — slope angle, center feed, low end toward target" },
    { url: ANTENNA_IMG_BASE + 'sloper-2.jpg', caption: "Perspective view — tree support, slope direction, Harris radio" },
    { url: ANTENNA_IMG_BASE + 'sloper-3.jpg', caption: "Rear 3/4 view — high support, feed point, wire slope toward target bearing" },
  ],
  nvis_dipole: [
    { url: ANTENNA_IMG_BASE + 'nvis_dipole-1.jpg', caption: "Side view — wire very low (3-6 ft), vertical radiation, center feed" },
    { url: ANTENNA_IMG_BASE + 'nvis_dipole-2.jpg', caption: "Perspective view — low wire, signal radiates straight up" },
    { url: ANTENNA_IMG_BASE + 'nvis_dipole-3.jpg', caption: "Overhead view — wire 3-6 ft above ground, NVIS radiation pattern firing straight up" },
  ],
  nvis_invertedv: [
    { url: ANTENNA_IMG_BASE + 'nvis_invertedv-1.jpg', caption: "Side view — low center height, legs slope to ground stakes" },
    { url: ANTENNA_IMG_BASE + 'nvis_invertedv-2.jpg', caption: "Perspective view — single center support, legs to stakes" },
    { url: ANTENNA_IMG_BASE + 'nvis_invertedv-3.jpg', caption: "Front-on low view — short apex (~8-10 ft), steep leg drop, NVIS vertical radiation" },
  ],
  efhw: [
    { url: ANTENNA_IMG_BASE + 'efhw-1.jpg', caption: "Side view — 49:1 UNUN at feed end, full wire, end insulator" },
    { url: ANTENNA_IMG_BASE + 'efhw-2.jpg', caption: "Perspective view — Inverted-L config, UNUN at base, coax to radio" },
    { url: ANTENNA_IMG_BASE + 'efhw-3.jpg', caption: "Overhead view — Inverted-L wire layout, UNUN feed, horizontal and vertical runs" },
  ],
  vertical: [
    { url: ANTENNA_IMG_BASE + 'vertical-1.jpg', caption: "Side view — vertical element, 4 ground radials, feed point, coax" },
    { url: ANTENNA_IMG_BASE + 'vertical-2.jpg', caption: "Perspective 3/4 view — vertical element, radials, omnidirectional radiation pattern" },
    { url: ANTENNA_IMG_BASE + 'vertical-3.jpg', caption: "Overhead view — vertical element top, 4 radials in cross pattern, omnidirectional coverage" },
  ],
  longwire: [
    { url: ANTENNA_IMG_BASE + 'longwire-1.jpg', caption: "Side view — ATU at feed end, intermediate supports, termination resistor" },
    { url: ANTENNA_IMG_BASE + 'longwire-2.jpg', caption: "Overhead view — wire aimed at target bearing, full length layout" },
    { url: ANTENNA_IMG_BASE + 'longwire-3.jpg', caption: "Front perspective view — looking down wire toward target, ATU at near end, termination at far end" },
  ],
  delta_loop: [
    { url: ANTENNA_IMG_BASE + 'delta_loop-1.jpg', caption: "Apex up — full-wave delta loop, horizontal polarization, low takeoff for DX" },
    { url: ANTENNA_IMG_BASE + 'delta_loop-2.jpg', caption: "Apex down — vertical polarization, high takeoff angle for short-range NVIS" },
    { url: ANTENNA_IMG_BASE + 'delta_loop-3.jpg', caption: "Feed point detail — corner insulator, 4:1 balun, SO-239, coax to radio" },
  ],
};

// MGRS/DMS/decimal coordinate parsing now lives in coords.js (imported above).

function extractCoordFromOCR(text) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (looksLikeMGRS(line)) return line;
    var result = parseCoords(line);
    if (!isNaN(result.lat) && !isNaN(result.lon)) return line;
  }
  var combined = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  var result2 = parseCoords(combined);
  if (!isNaN(result2.lat) && !isNaN(result2.lon)) return combined.trim();
  return '';
}

// ── PHYSICS ────────────────────────────────────────────────────────────────────
// geodesics() now lives in propagation.js (imported above).

// wavelength() and toLengths() now live in antennaMath.js (imported above).

// propagationZone() now lives in propagation.js (imported above).

// bearingToCardinal() now lives in propagation.js (imported above).

// ══════════════════════════════════════════════════════════════════════════════
// EMBEDDED TERRAIN DATABASE
// All coordinates in decimal degrees (WGS-84).
// Each entry is a bounding box { latMin, latMax, lonMin, lonMax, type, name, elev? }
//   type: 'ocean' | 'lake' | 'mountain' | 'desert' | 'highland'
//   elev: approximate peak elevation in meters (mountains/highlands only)
// Points sampled along the great-circle path are classified using these boxes.
// When multiple boxes overlap, highest priority wins: mountain > lake > ocean > highland > desert
// ══════════════════════════════════════════════════════════════════════════════

var TERRAIN_DB = [
  // ── OCEANS & MAJOR SEAS ────────────────────────────────────────────────────
  { t:'ocean', n:'North Atlantic',       latMin:  0,  latMax: 65,  lonMin:-80,   lonMax:  0   },
  { t:'ocean', n:'South Atlantic',       latMin:-60,  latMax:  0,  lonMin:-65,   lonMax: 20   },
  { t:'ocean', n:'North Pacific',        latMin:  0,  latMax: 65,  lonMin:-180,  lonMax:-100  },
  { t:'ocean', n:'South Pacific',        latMin:-60,  latMax:  0,  lonMin:-180,  lonMax: -70  },
  { t:'ocean', n:'Indian Ocean',         latMin:-60,  latMax: 30,  lonMin: 20,   lonMax: 110  },
  { t:'ocean', n:'Southern Ocean',       latMin:-90,  latMax:-60,  lonMin:-180,  lonMax: 180  },
  { t:'ocean', n:'Arctic Ocean',         latMin: 70,  latMax: 90,  lonMin:-180,  lonMax: 180  },
  { t:'ocean', n:'Mediterranean Sea',    latMin: 30,  latMax: 47,  lonMin: -6,   lonMax:  42  },
  { t:'ocean', n:'Caribbean Sea',        latMin:  8,  latMax: 25,  lonMin:-90,   lonMax: -60  },
  { t:'ocean', n:'Gulf of Mexico',       latMin: 18,  latMax: 31,  lonMin:-100,  lonMax: -80  },
  { t:'ocean', n:'Arabian Sea',          latMin:  5,  latMax: 25,  lonMin: 50,   lonMax:  78  },
  { t:'ocean', n:'Bay of Bengal',        latMin:  5,  latMax: 25,  lonMin: 78,   lonMax: 100  },
  { t:'ocean', n:'South China Sea',      latMin:  0,  latMax: 25,  lonMin:100,   lonMax: 122  },
  { t:'ocean', n:'East China/Japan Sea', latMin: 25,  latMax: 45,  lonMin:120,   lonMax: 145  },
  { t:'ocean', n:'Philippine Sea',       latMin:  5,  latMax: 30,  lonMin:122,   lonMax: 145  },
  { t:'ocean', n:'Coral/Tasman Sea',     latMin:-45,  latMax:  0,  lonMin:145,   lonMax: 180  },
  { t:'ocean', n:'North Sea/Baltic',     latMin: 50,  latMax: 70,  lonMin: -5,   lonMax:  30  },
  { t:'ocean', n:'Black Sea',            latMin: 41,  latMax: 47,  lonMin: 27,   lonMax:  42  },
  { t:'ocean', n:'Caspian Sea',          latMin: 36,  latMax: 48,  lonMin: 49,   lonMax:  55  },
  { t:'ocean', n:'Red Sea',             latMin: 12,  latMax: 30,  lonMin: 32,   lonMax:  44  },
  { t:'ocean', n:'Persian Gulf',         latMin: 22,  latMax: 30,  lonMin: 48,   lonMax:  57  },
  { t:'ocean', n:'Gulf of Guinea',       latMin: -5,  latMax: 10,  lonMin: -5,   lonMax:  10  },
  { t:'ocean', n:'Sea of Okhotsk',       latMin: 44,  latMax: 62,  lonMin:135,   lonMax: 160  },
  { t:'ocean', n:'Bering Sea',           latMin: 50,  latMax: 68,  lonMin:-180,  lonMax:-157  },
  { t:'ocean', n:'Hudson Bay',           latMin: 50,  latMax: 65,  lonMin: -95,  lonMax: -75  },
  { t:'ocean', n:'Gulf of Alaska',       latMin: 54,  latMax: 62,  lonMin:-158,  lonMax:-135  },

  // ── MAJOR LAKES ───────────────────────────────────────────────────────────
  { t:'lake', n:'Lake Superior',         latMin: 46.4,latMax: 49.0,lonMin:-92.0, lonMax:-84.5 },
  { t:'lake', n:'Lake Michigan',         latMin: 41.6,latMax: 46.1,lonMin:-88.0, lonMax:-84.7 },
  { t:'lake', n:'Lake Huron',            latMin: 43.0,latMax: 46.2,lonMin:-84.7, lonMax:-79.5 },
  { t:'lake', n:'Lake Erie',             latMin: 41.4,latMax: 43.0,lonMin:-83.5, lonMax:-78.9 },
  { t:'lake', n:'Lake Ontario',          latMin: 43.2,latMax: 44.3,lonMin:-79.9, lonMax:-76.0 },
  { t:'lake', n:'Lake Victoria',         latMin: -3.0,latMax:  0.5,lonMin: 31.5, lonMax:  35.0},
  { t:'lake', n:'Lake Tanganyika',       latMin: -8.8,latMax: -3.5,lonMin: 28.8, lonMax:  31.2},
  { t:'lake', n:'Lake Malawi',           latMin:-14.5,latMax: -9.5,lonMin: 33.7, lonMax:  35.3},
  { t:'lake', n:'Lake Baikal',           latMin: 51.5,latMax: 55.8,lonMin:103.7, lonMax: 110.0},
  { t:'lake', n:'Aral Sea',             latMin: 43.0,latMax: 47.0,lonMin: 58.0, lonMax:  62.0},
  { t:'lake', n:'Lake Chad',             latMin: 12.0,latMax: 14.5,lonMin: 13.0, lonMax:  16.0},
  { t:'lake', n:'Lake Titicaca',         latMin:-16.5,latMax:-15.2,lonMin:-70.0, lonMax: -68.5},
  { t:'lake', n:'Great Bear Lake',       latMin: 64.5,latMax: 67.0,lonMin:-124,  lonMax:-118  },
  { t:'lake', n:'Great Slave Lake',      latMin: 60.8,latMax: 62.5,lonMin:-117,  lonMax:-109  },

  // ── MOUNTAIN RANGES ───────────────────────────────────────────────────────
  // elev = typical peak height in meters (used for propagation penalty)
  { t:'mountain', n:'Himalayas / Tibetan Plateau', latMin: 27, latMax: 38, lonMin:  73, lonMax:  97,  elev: 6500 },
  { t:'mountain', n:'Karakoram / Hindu Kush',      latMin: 33, latMax: 38, lonMin:  69, lonMax:  77,  elev: 7000 },
  { t:'mountain', n:'Pamir Knot',                  latMin: 36, latMax: 40, lonMin:  70, lonMax:  76,  elev: 5500 },
  { t:'mountain', n:'Alps',                         latMin: 44, latMax: 48, lonMin:   6, lonMax:  15,  elev: 3800 },
  { t:'mountain', n:'Pyrenees',                     latMin: 42, latMax: 43.5,lonMin: -2, lonMax:   3,  elev: 3400 },
  { t:'mountain', n:'Caucasus',                     latMin: 41, latMax: 44, lonMin:  39, lonMax:  49,  elev: 4500 },
  { t:'mountain', n:'Andes (Colombia–Venezuela)',   latMin:  4, latMax: 12, lonMin: -75, lonMax: -65,  elev: 4500 },
  { t:'mountain', n:'Andes (Ecuador–Peru)',         latMin:-14, latMax:  4, lonMin: -81, lonMax: -74,  elev: 5500 },
  { t:'mountain', n:'Andes (Bolivia–Chile)',        latMin:-34, latMax:-14, lonMin: -72, lonMax: -65,  elev: 6500 },
  { t:'mountain', n:'Andes (Patagonia)',            latMin:-56, latMax:-34, lonMin: -73, lonMax: -68,  elev: 3800 },
  { t:'mountain', n:'Rocky Mountains',              latMin: 35, latMax: 60, lonMin:-117, lonMax:-104,  elev: 3500 },
  { t:'mountain', n:'Sierra Nevada (CA)',           latMin: 36, latMax: 42, lonMin:-122, lonMax:-118,  elev: 3600 },
  { t:'mountain', n:'Cascade Range',                latMin: 42, latMax: 49, lonMin:-122, lonMax:-120,  elev: 3300 },
  { t:'mountain', n:'Appalachians',                 latMin: 33, latMax: 47, lonMin: -85, lonMax: -68,  elev:  900 },
  { t:'mountain', n:'Atlas Mountains',              latMin: 29, latMax: 37, lonMin:  -9, lonMax:   9,  elev: 3200 },
  { t:'mountain', n:'Ethiopian Highlands',          latMin:  6, latMax: 15, lonMin:  35, lonMax:  42,  elev: 3500 },
  { t:'mountain', n:'Drakensberg',                  latMin:-31, latMax:-27, lonMin:  27, lonMax:  31,  elev: 3400 },
  { t:'mountain', n:'Ural Mountains',               latMin: 50, latMax: 67, lonMin:  58, lonMax:  62,  elev: 1700 },
  { t:'mountain', n:'Altai Mountains',              latMin: 48, latMax: 52, lonMin:  83, lonMax:  90,  elev: 3500 },
  { t:'mountain', n:'Tian Shan',                    latMin: 39, latMax: 44, lonMin:  70, lonMax:  82,  elev: 5000 },
  { t:'mountain', n:'Zagros Mountains',             latMin: 28, latMax: 38, lonMin:  45, lonMax:  52,  elev: 4200 },
  { t:'mountain', n:'Pontic/Taurus',                latMin: 36, latMax: 42, lonMin:  30, lonMax:  44,  elev: 3800 },
  { t:'mountain', n:'Scandinavian Mountains',       latMin: 57, latMax: 71, lonMin:  12, lonMax:  28,  elev: 2400 },
  { t:'mountain', n:'New Guinea Highlands',         latMin: -8, latMax: -3, lonMin: 134, lonMax: 148,  elev: 4500 },
  { t:'mountain', n:'Southern Alps (NZ)',           latMin:-45, latMax:-43, lonMin: 167, lonMax: 172,  elev: 3700 },
  { t:'mountain', n:'Great Dividing Range (AU)',    latMin:-38, latMax:-16, lonMin: 146, lonMax: 153,  elev: 2200 },
  { t:'mountain', n:'Sierra Madre (Mexico)',        latMin: 20, latMax: 30, lonMin:-110, lonMax:-100,  elev: 3300 },
  { t:'mountain', n:'Brooks Range (Alaska)',        latMin: 67, latMax: 70, lonMin:-165, lonMax:-141,  elev: 2700 },
  { t:'mountain', n:'Alaska Range',                latMin: 61, latMax: 64, lonMin:-155, lonMax:-146,  elev: 5500 },
  { t:'mountain', n:'Coast Mountains (BC)',         latMin: 49, latMax: 60, lonMin:-133, lonMax:-122,  elev: 3500 },

  // ── DESERTS (affect conductivity negatively) ───────────────────────────────
  { t:'desert', n:'Sahara',             latMin: 15, latMax: 35, lonMin: -18, lonMax:  40, elev:  400 },
  { t:'desert', n:'Arabian Desert',     latMin: 20, latMax: 32, lonMin:  44, lonMax:  58, elev:  600 },
  { t:'desert', n:'Gobi Desert',        latMin: 38, latMax: 50, lonMin:  95, lonMax: 120, elev: 1200 },
  { t:'desert', n:'Karakum/Kyzylkum',   latMin: 37, latMax: 46, lonMin:  55, lonMax:  70, elev:  200 },
  { t:'desert', n:'Thar Desert',        latMin: 22, latMax: 30, lonMin:  68, lonMax:  76, elev:  200 },
  { t:'desert', n:'Atacama Desert',     latMin:-30, latMax:-18, lonMin: -72, lonMax: -67, elev: 2400 },
  { t:'desert', n:'Patagonian Desert',  latMin:-52, latMax:-38, lonMin: -70, lonMax: -63, elev:  600 },
  { t:'desert', n:'Great Basin (US)',   latMin: 35, latMax: 43, lonMin:-118, lonMax:-111, elev: 1500 },
  { t:'desert', n:'Mojave/Sonoran',     latMin: 30, latMax: 37, lonMin:-118, lonMax:-109, elev:  800 },
  { t:'desert', n:'Australian Outback', latMin:-33, latMax:-20, lonMin: 117, lonMax: 142, elev:  400 },
  { t:'desert', n:'Namib Desert',       latMin:-28, latMax:-17, lonMin:  11, lonMax:  17, elev:  700 },
  { t:'desert', n:'Kalahari',           latMin:-26, latMax:-20, lonMin:  20, lonMax:  27, elev: 1000 },

  // ── HIGHLANDS / PLATEAUS ──────────────────────────────────────────────────
  { t:'highland', n:'Tibetan Plateau',  latMin: 28, latMax: 38, lonMin:  78, lonMax: 100, elev: 4500 },
  { t:'highland', n:'East African Rift',latMin:-12, latMax: 15, lonMin:  29, lonMax:  38, elev: 2000 },
  { t:'highland', n:'Colombian Massif', latMin:  1, latMax:  6, lonMin: -78, lonMax: -74, elev: 3200 },
  { t:'highland', n:'Anatolian Plateau',latMin: 37, latMax: 42, lonMin:  30, lonMax:  44, elev: 1200 },
  { t:'highland', n:'Iranian Plateau',  latMin: 26, latMax: 40, lonMin:  52, lonMax:  62, elev: 1200 },
  { t:'highland', n:'Central Asian Steppe',latMin:44,latMax:56,lonMin:  55, lonMax:  90, elev:  500 },
  { t:'highland', n:'Greenland Ice Sheet',latMin:60,latMax:84,lonMin:-55,  lonMax: -18, elev: 2800 },
];

// Priority for overlap resolution
var TERRAIN_PRIORITY = { mountain: 5, lake: 4, ocean: 3, highland: 2, desert: 1 };

// Conductivity table (mS/m) per terrain type
var TERRAIN_COND = {
  ocean:    5000,   // seawater — near perfect
  lake:     3,      // freshwater — similar to wet land
  mountain: 1,      // rocky, thin soil — poor
  desert:   0.3,    // very dry — terrible
  highland: 2,      // mixed
  land:     3,      // average continental interior
};

// Classify a single lat/lon point — returns { type, name, elev }
function classifyPoint(lat, lon) {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  var best = null;
  var bestPri = -1;
  for (var i = 0; i < TERRAIN_DB.length; i++) {
    var e = TERRAIN_DB[i];
    if (lat >= e.latMin && lat <= e.latMax && lon >= e.lonMin && lon <= e.lonMax) {
      var pri = TERRAIN_PRIORITY[e.t] || 0;
      if (pri > bestPri) { bestPri = pri; best = e; }
    }
  }
  if (!best) return { type: 'land', name: null, elev: 0, cond: TERRAIN_COND.land };
  return { type: best.t, name: best.n, elev: best.elev || 0, cond: TERRAIN_COND[best.t] };
}

// ── GREAT-CIRCLE PATH SAMPLER ─────────────────────────────────────────────────
// Returns array of { lat, lon, frac, terrain }
function samplePath(lat1, lon1, lat2, lon2, n) {
  n = n || 32;
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var la1 = lat1 * D2R, lo1 = lon1 * D2R;
  var la2 = lat2 * D2R, lo2 = lon2 * D2R;
  var d = 2 * Math.asin(Math.sqrt(
    Math.pow(Math.sin((la2 - la1) / 2), 2) +
    Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2)
  ));
  var pts = [];
  for (var i = 0; i <= n; i++) {
    var f = i / n;
    var lat, lon;
    if (d < 1e-6) {
      lat = lat1; lon = lon1;
    } else {
      var A = Math.sin((1 - f) * d) / Math.sin(d);
      var B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      var y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      var z = A * Math.sin(la1) + B * Math.sin(la2);
      lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D;
      lon = Math.atan2(y, x) * R2D;
    }
    pts.push({ lat: lat, lon: lon, frac: f, terrain: classifyPoint(lat, lon) });
  }
  return pts;
}

// ── PATH TERRAIN SUMMARY ──────────────────────────────────────────────────────
function pathTerrainAnalysis(lat1, lon1, lat2, lon2, n) {
  var pts = samplePath(lat1, lon1, lat2, lon2, n || 32);
  var counts = { ocean: 0, lake: 0, mountain: 0, desert: 0, highland: 0, land: 0 };
  var names  = {};
  var maxElev = 0;
  var condSum = 0;
  var obstacleElevs = []; // elevations of mountain/highland hits

  pts.forEach(function(p) {
    var t = p.terrain;
    counts[t.type] = (counts[t.type] || 0) + 1;
    if (t.name) names[t.name] = (names[t.name] || 0) + 1;
    if (t.elev > maxElev) maxElev = t.elev;
    if (t.type === 'mountain' || t.type === 'highland') {
      obstacleElevs.push({ frac: p.frac, elev: t.elev, name: t.name });
    }
    condSum += Math.log(t.cond);
  });

  var total = pts.length;
  var fracs = {};
  Object.keys(counts).forEach(function(k) { fracs[k] = counts[k] / total; });

  // Geometric-mean effective conductivity (log-weighted)
  var condMSm = Math.exp(condSum / total);

  // Key obstacle: the highest point along the path (for takeoff angle calc)
  var keyObstacle = null;
  if (obstacleElevs.length > 0) {
    obstacleElevs.sort(function(a, b) { return b.elev - a.elev; });
    keyObstacle = obstacleElevs[0];
  }

  var namedBodies = Object.keys(names).filter(function(k) {
    return TERRAIN_DB.some(function(e) { return e.n === k && (e.t === 'ocean' || e.t === 'lake'); });
  });
  var namedMountains = Object.keys(names).filter(function(k) {
    return TERRAIN_DB.some(function(e) { return e.n === k && (e.t === 'mountain' || e.t === 'highland'); });
  });

  return {
    pts:           pts,
    fracs:         fracs,
    condMSm:       condMSm,
    maxElev:       maxElev,
    keyObstacle:   keyObstacle,
    namedBodies:   namedBodies,
    namedMountains:namedMountains,
    oceanFrac:     fracs.ocean || 0,
    landFrac:      (fracs.land || 0) + (fracs.highland || 0),
    mountainFrac:  fracs.mountain || 0,
    desertFrac:    fracs.desert || 0,
  };
}

// calcTakeoffAngle(), groundWaveMultiplier(), chordalHopPossible(), HOP,
// and calcHops() now live in propagation.js (imported above).

// ── ANTENNA DIRECTIVE ENGINE ──────────────────────────────────────────────────
// Given path analysis, produces a plain-English antenna setup directive
function antennaDirective(distKm, freqMHz, bearing, terrain, hopResults) {
  var cardinal = bearingToCardinal(bearing);
  var zone = propagationZone(distKm);
  var oceanFrac = terrain.oceanFrac || 0;
  var mountainFrac = terrain.mountainFrac || 0;

  // Best hop result (prefer F2)
  var bestHop = hopResults[hopResults.length - 1];
  var toa = bestHop.toa;
  var finalAngle = toa.finalDeg;

  // Antenna type recommendation based on zone + terrain
  var antennaType, whichWay, physGeometry, whyAngle;

  if (zone === 'groundwave') {
    antennaType = 'Low horizontal dipole or longwire';
    whichWay = 'Orient wire perpendicular to ' + cardinal + ' (broadside toward target)';
    physGeometry = 'Keep wire 3\u20136 ft above ground. No angle needed \u2014 ground wave follows surface.';
    whyAngle = 'Ground wave \u2014 signal travels along the Earth surface. Height and angle are irrelevant; maximize wire length and minimize height.';
  } else if (zone === 'nvis') {
    antennaType = 'NVIS horizontal dipole';
    whichWay = 'Wire orientation does not matter \u2014 NVIS is omnidirectional';
    physGeometry = 'Hang wire 3\u20136 ft above ground (0.05\u20130.15\u03bb). Signal fires straight up at ~80\u201390\u00b0.';
    whyAngle = 'NVIS \u2014 signal goes nearly vertical, bounces off ionosphere. Low height is the requirement, not direction.';
  } else {
    // Skywave \u2014 use takeoff angle geometry
    if (zone === 'singlehop' || zone === 'mediumdx') {
      antennaType = oceanFrac > 0.5 ? 'Sloper or inverted-V aimed toward coast' : 'Inverted-V dipole or sloper';
    } else {
      antennaType = terrain.chordal ? 'Low horizontal dipole or vertical' : 'Sloper or longwire aimed toward target';
    }

    whichWay = 'From your station, point antenna (or sloper low end) toward ' + bearing.toFixed(0) + '\u00b0 (' + cardinal + ') \u2014 the bearing to the target';

    // Physical angle geometry: for a sloper the wire angle from horizontal = 90 - takeoff_angle
    var wireAngleFromHoriz = 90 - finalAngle;
    physGeometry = 'Takeoff angle: ' + finalAngle + '\u00b0. '
      + 'For a sloper: slope wire ' + wireAngleFromHoriz.toFixed(0) + '\u00b0 from horizontal toward target. '
      + 'For an inverted-V: apex height determines angle \u2014 raise apex until leg-to-ground angle equals ' + wireAngleFromHoriz.toFixed(0) + '\u00b0.';

    // Why this angle
    var parts = ['Baseline for ' + distKm.toFixed(0) + ' km path: ' + toa.baseDeg + '\u00b0'];
    toa.adjustments.forEach(function(a) {
      if (a.delta !== null) {
        parts.push((a.delta > 0 ? '+' + a.delta : a.delta) + '\u00b0: ' + a.note);
      } else {
        parts.push(a.note);
      }
    });
    parts.push('\u2192 Final recommended angle: ' + finalAngle + '\u00b0');
    whyAngle = parts.join('\n');
  }

  // Terrain path summary
  var terrainParts = [];
  if (oceanFrac > 0.05) terrainParts.push(Math.round(oceanFrac * 100) + '% ocean');
  if ((terrain.landFrac || 0) > 0.05) terrainParts.push(Math.round((terrain.landFrac) * 100) + '% land');
  if (mountainFrac > 0.05) terrainParts.push(Math.round(mountainFrac * 100) + '% mountains');
  if ((terrain.desertFrac || 0) > 0.05) terrainParts.push(Math.round((terrain.desertFrac || 0) * 100) + '% desert');
  var pathSummary = terrainParts.join(', ');

  return {
    bearing:      bearing,
    cardinal:     cardinal,
    takeoffDeg:   finalAngle,
    antennaType:  antennaType,
    whichWay:     whichWay,
    physGeometry: physGeometry,
    whyAngle:     whyAngle,
    pathSummary:  pathSummary,
    chordal:      toa.chordal,
    adjustments:  toa.adjustments,
    zone:         zone,
  };
}

// ── PATH TERRAIN SVG MAP ──────────────────────────────────────────────────────
// Renders a color-coded horizontal strip showing terrain along the path
var TERRAIN_COLORS = {
  ocean:    '#1a3a6a',
  lake:     '#1a4a6a',
  mountain: '#6a4a1a',
  desert:   '#8a6a20',
  highland: '#4a4a2a',
  land:     '#1a2e10',
};

function TerrainStripSVG({ pts }) {
  var W = 320, H = 24;
  var n = pts.length;
  if (!n) return null;
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', display: 'block', borderRadius: 4 }}>
      {pts.map(function(p, i) {
        if (i >= n - 1) return null;
        var x1 = (i / (n - 1)) * W;
        var x2 = ((i + 1) / (n - 1)) * W;
        var color = TERRAIN_COLORS[p.terrain.type] || TERRAIN_COLORS.land;
        return <rect key={i} x={x1} y={0} width={Math.max(1, x2 - x1)} height={H} fill={color} />;
      })}
      {/* TX label */}
      <text x={4} y={H - 4} fontSize="8" fill="#7dc86b" fontWeight="700">TX</text>
      <text x={W - 4} y={H - 4} fontSize="8" fill="#c87c3a" fontWeight="700" textAnchor="end">RX</text>
    </svg>
  );
}

function TerrainLegend() {
  var items = [
    { color: TERRAIN_COLORS.ocean,    label: 'Ocean/Sea' },
    { color: TERRAIN_COLORS.lake,     label: 'Lake' },
    { color: TERRAIN_COLORS.mountain, label: 'Mountains' },
    { color: TERRAIN_COLORS.desert,   label: 'Desert' },
    { color: TERRAIN_COLORS.highland, label: 'Highlands' },
    { color: TERRAIN_COLORS.land,     label: 'Land' },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 6 }}>
      {items.map(function(item) {
        return (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 8, borderRadius: 2, background: item.color, border: '1px solid rgba(255,255,255,0.1)' }} />
            <span style={{ fontSize: '0.62rem', color: T.textMute }}>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── HOP ARC SVG ───────────────────────────────────────────────────────────────
function HopArcSVG({ hops, pts }) {
  var W = 300, H = 80, padX = 18, groundY = H - 14, arcH = 44;
  var innerW = W - 2 * padX;

  // Terrain underlay from pts
  var terrainSegs = [];
  if (pts && pts.length > 1) {
    for (var i = 0; i < pts.length - 1; i++) {
      var x1t = padX + (i / (pts.length - 1)) * innerW;
      var x2t = padX + ((i + 1) / (pts.length - 1)) * innerW;
      terrainSegs.push({ x1: x1t, x2: x2t, color: TERRAIN_COLORS[pts[i].terrain.type] || TERRAIN_COLORS.land });
    }
  }

  var arcs = [];
  for (var j = 0; j < hops; j++) {
    var ax1 = padX + (j / hops) * innerW;
    var ax2 = padX + ((j + 1) / hops) * innerW;
    arcs.push({ x1: ax1, x2: ax2, mx: (ax1 + ax2) / 2, topY: groundY - arcH });
  }

  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', display: 'block' }}>
      {terrainSegs.map(function(s, i) {
        return <rect key={i} x={s.x1} y={groundY} width={Math.max(0.5, s.x2 - s.x1)} height={5} fill={s.color} />;
      })}
      <line x1={padX} y1={groundY} x2={W - padX} y2={groundY} stroke="#2e4422" strokeWidth="1" />
      <line x1={padX} y1={arcs[0].topY} x2={W - padX} y2={arcs[0].topY} stroke="#2e4422" strokeWidth="1" strokeDasharray="3 3" />
      <text x={W - padX - 2} y={arcs[0].topY - 4} textAnchor="end" fontSize="7" fill="#3a5030">IONOSPHERE</text>
      <circle cx={padX} cy={groundY} r="3.5" fill="#5a9e4b" />
      <text x={padX} y={groundY + 11} textAnchor="middle" fontSize="7" fill="#7dc86b">TX</text>
      <circle cx={W - padX} cy={groundY} r="3.5" fill="#7a5230" />
      <text x={W - padX} y={groundY + 11} textAnchor="middle" fontSize="7" fill="#c87c3a">RX</text>
      {arcs.map(function(arc, i) {
        var d = 'M ' + arc.x1 + ' ' + groundY + ' Q ' + arc.mx + ' ' + arc.topY + ' ' + arc.x2 + ' ' + groundY;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke="#5a9e4b" strokeWidth="1.5" opacity="0.9" />
            {i > 0 && <circle cx={arc.x1} cy={groundY} r="3" fill="#0e1510" stroke="#5a9e4b" strokeWidth="1.2" />}
          </g>
        );
      })}
    </svg>
  );
}

// ── HOP DIAGRAM COMPONENT ──────────────────────────────────────────────────────
function HopDiagram({ distKm, freqMHz, lat1, lon1, lat2, lon2 }) {
  if (distKm < 500) return null;
  var terrain = pathTerrainAnalysis(lat1, lon1, lat2, lon2, 32);
  var hops    = calcHops(distKm, freqMHz, terrain);
  var distMi  = distKm * 0.621371;

  return (
    <div className="usmc-card" style={{ marginBottom: 14 }}>
      <div className="usmc-section-label">Ionosphere Hop Analysis</div>
      <div style={{ color: T.textSec, fontSize: '0.78rem', marginBottom: 10, lineHeight: 1.55 }}>
        {'Signal path: ' + distKm.toFixed(0) + ' km (' + distMi.toFixed(0) + ' mi). Ground strip shows actual terrain.'}
      </div>
      <TerrainStripSVG pts={terrain.pts} />
      <TerrainLegend />

      {hops.map(function(h, hi) {
        return (
          <div key={h.layer} style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid ' + T.border }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ background: T.accentDim, border: '1px solid ' + T.borderHi, borderRadius: 5, padding: '3px 10px', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', color: T.accentText }}>{h.layer}</div>
              <div style={{ color: T.textMute, fontSize: '0.68rem' }}>{h.height + '  \u00b7  ' + h.note}</div>
            </div>

            <HopArcSVG hops={h.hops} pts={terrain.pts} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
              <div className="usmc-stat" style={{ padding: '7px 10px' }}>
                <div className="usmc-stat-label">Hops</div>
                <div className="usmc-stat-val">{h.hops}</div>
              </div>
              <div className="usmc-stat" style={{ padding: '7px 10px' }}>
                <div className="usmc-stat-label">Per-Hop</div>
                <div className="usmc-stat-val">{h.hopDistKm.toFixed(0) + ' km'}</div>
              </div>
              <div className="usmc-stat" style={{ padding: '7px 10px' }}>
                <div className="usmc-stat-label">Takeoff Angle</div>
                <div className="usmc-stat-val" style={{ color: T.accentText }}>{'~' + h.toa.finalDeg + '\u00b0'}</div>
                {h.toa.finalDeg !== h.toa.baseDeg && <div className="usmc-stat-sub">{'base ' + h.toa.baseDeg + '\u00b0'}</div>}
              </div>
            </div>

            {/* Angle adjustments */}
            {h.toa.adjustments.length > 0 && (
              <div style={{ marginTop: 8, background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Terrain Adjustments</div>
                {h.toa.adjustments.map(function(a, ai) {
                  return (
                    <div key={ai} style={{ fontSize: '0.73rem', color: T.textSec, paddingBottom: 4, lineHeight: 1.45 }}>
                      {a.delta !== null ? <span style={{ color: a.delta > 0 ? T.warn : '#4a8aaa', fontWeight: 700, marginRight: 6 }}>{a.delta > 0 ? '+' + a.delta + '\u00b0' : a.delta + '\u00b0'}</span> : null}
                      {a.note}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Chordal hop */}
            {h.toa.chordal && (
              <div style={{ marginTop: 8, background: '#0a1420', border: '1px solid #1a3a5a', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ color: '#4a8aaa', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 3 }}>CHORDAL HOP POSSIBLE</div>
                <div style={{ color: T.textSec, fontSize: '0.74rem', lineHeight: 1.5 }}>High ocean fraction + this distance + frequency allows signal to stay within ionosphere between hops. Less ground-reflection loss. Effective angle reduced ~30%.</div>
              </div>
            )}

            {/* Bounce terrain */}
            {h.bounceTerrainNote && h.hops > 1 && (
              <div style={{ marginTop: 8, background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '7px 10px', color: T.textSec, fontSize: '0.74rem', lineHeight: 1.5 }}>
                {h.bounceTerrainNote}
              </div>
            )}

            {/* Bounce points */}
            {h.reflectFracs.length > 0 && (
              <div style={{ marginTop: 8, background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Ground Reflection Points</div>
                {h.reflectFracs.map(function(frac, i) {
                  var km = frac * distKm;
                  var mi = km * 0.621371;
                  var bPt = terrain.pts[Math.round(frac * (terrain.pts.length - 1))];
                  var bTerrain = bPt ? bPt.terrain : { type: 'land', name: null };
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.74rem', paddingBottom: 3 }}>
                      <span style={{ color: T.textSec }}>{'Bounce ' + (i + 1)}</span>
                      <span style={{ color: T.textBody }}>{km.toFixed(0) + ' km / ' + mi.toFixed(0) + ' mi'}</span>
                      <span style={{
                        color: bTerrain.type === 'ocean' ? '#4a8aaa' : bTerrain.type === 'mountain' ? T.warn : T.textMute,
                        fontSize: '0.67rem', fontWeight: 600
                      }}>{bTerrain.name || bTerrain.type}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── ANTENNA DIRECTIVE CARD ────────────────────────────────────────────────────
function AntennaDirectiveCard({ directive }) {
  if (!directive) return null;
  var d = directive;
  return (
    <div className="usmc-card" style={{ marginBottom: 14, borderLeft: '3px solid ' + T.accentText }}>
      <div className="usmc-section-label" style={{ color: T.accentText }}>Antenna Directive</div>

      {/* Big bearing + angle */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div style={{ background: T.bg, border: '1px solid ' + T.borderHi, borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
          <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>Point Toward Target</div>
          <div style={{ color: T.accentText, fontWeight: 900, fontSize: '1.6rem', lineHeight: 1 }}>{d.bearing.toFixed(0) + '\u00b0'}</div>
          <div style={{ color: T.textSec, fontWeight: 700, fontSize: '0.85rem', marginTop: 3 }}>{d.cardinal}</div>
        </div>
        <div style={{ background: T.bg, border: '1px solid ' + T.borderHi, borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
          <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>{d.zone === 'groundwave' || d.zone === 'nvis' ? 'Wire Height' : 'Takeoff Angle'}</div>
          <div style={{ color: T.warn, fontWeight: 900, fontSize: '1.6rem', lineHeight: 1 }}>
            {d.zone === 'groundwave' ? '3\u20136 ft' : d.zone === 'nvis' ? '3\u20136 ft' : d.takeoffDeg + '\u00b0'}
          </div>
          <div style={{ color: T.textSec, fontWeight: 400, fontSize: '0.72rem', marginTop: 3 }}>
            {d.zone === 'groundwave' || d.zone === 'nvis' ? 'above ground' : 'from horizontal'}
          </div>
        </div>
      </div>

      {/* Antenna type */}
      <div style={{ background: T.surfaceHi, border: '1px solid ' + T.border, borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
        <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Recommended Antenna</div>
        <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.88rem' }}>{d.antennaType}</div>
      </div>

      {/* Direction */}
      <div style={{ background: T.surfaceHi, border: '1px solid ' + T.border, borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
        <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Direction</div>
        <div style={{ color: T.textBody, fontSize: '0.82rem', lineHeight: 1.55 }}>{d.whichWay}</div>
      </div>

      {/* Physical geometry */}
      <div style={{ background: T.surfaceHi, border: '1px solid ' + T.border, borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
        <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Setup Geometry</div>
        <div style={{ color: T.textBody, fontSize: '0.82rem', lineHeight: 1.55 }}>{d.physGeometry}</div>
      </div>

      {/* Why this angle */}
      <div style={{ background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
        <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Why This Angle (Terrain Math)</div>
        {d.whyAngle.split('\n').map(function(line, i) {
          return <div key={i} style={{ color: T.textSec, fontSize: '0.76rem', lineHeight: 1.5, paddingBottom: 3 }}>{line}</div>;
        })}
      </div>

      {/* Path summary */}
      <div style={{ color: T.textMute, fontSize: '0.68rem', marginTop: 4 }}>
        {'Path terrain: ' + d.pathSummary}
        {d.chordal && <span style={{ color: '#4a8aaa', marginLeft: 8, fontWeight: 700 }}>· CHORDAL HOP POSSIBLE</span>}
      </div>
    </div>
  );
}

// ── LONGWIRE GEOMETRY ──────────────────────────────────────────────────────────
// For a longwire strung horizontally at height H over length L:
//   takeoff angle = atan(H / (L/2)) in degrees  (main lobe approx)
//   max intermediate support spacing for <X ft sag under wire weight:
//     sag = (w * s^2) / (8 * T)  => s = sqrt(8*T*sag/w)  -- simplified to rule of thumb
//   In field conditions: intermediate supports every 50-100 ft to keep wire taut
// Support heights:
//   Feed end (near radio): min 15 ft (Army FM / MCRP 3-40.3C)
//   End support (far end): same height for horizontal; can be slightly lower
//   For directional gain: keep wire level ±2 ft across its length
function calcLongwireGeo(wireLenMeters, feedHeightFt) {
  var wireLenFt = wireLenMeters * 3.28084;
  var feedHeightM = feedHeightFt / 3.28084;
  // Takeoff angle — main radiation lobe (broadside to wire axis, elevation)
  // For horizontal wire at height H, main lobe elevation = arcsin(lambda/2H) -- simplified
  // More practical: low-angle broadside. Use atan(H / half-wire-length) for end-fire
  var takeoffDeg = Math.atan2(feedHeightM, wireLenMeters / 2) * 180 / Math.PI;
  // Intermediate supports: every ~75 ft (23 m) is field-practical
  var supportSpacingFt = 75;
  var numIntermediate = Math.max(0, Math.floor(wireLenFt / supportSpacingFt) - 1);
  // Each intermediate support same height as feed end
  return {
    wireLenFt: wireLenFt,
    feedHeightFt: feedHeightFt,
    feedHeightM: feedHeightM,
    endHeightFt: feedHeightFt, // keep level
    endHeightM: feedHeightM,
    takeoffDeg: takeoffDeg,
    supportSpacingFt: supportSpacingFt,
    supportSpacingM: supportSpacingFt / 3.28084,
    numIntermediate: numIntermediate,
    totalSupports: numIntermediate + 2,
  };
}

// ── LONGWIRE GEO COMPONENT ─────────────────────────────────────────────────────
function LongwireGeoCalc({ wireLenMeters }) {
  var wireLenFt = wireLenMeters * 3.28084;
  var minFeedFt = 15;
  var recFeedFt = Math.min(30, Math.max(15, Math.round(wireLenFt / 20)));
  var [feedFtStr, setFeedFtStr] = useState(String(recFeedFt));
  var feedFt = parseFloat(feedFtStr);
  var valid = !isNaN(feedFt) && feedFt >= 8 && feedFt <= 60;
  var geo = valid ? calcLongwireGeo(wireLenMeters, feedFt) : null;

  var cellStyle = { background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '9px 11px' };

  var statusColor = valid
    ? (feedFt < 15 ? T.warn : T.accentText)
    : T.textMute;
  var statusMsg = !valid
    ? 'Enter height 8–60 ft'
    : feedFt < 15
      ? 'WARNING: Below 15 ft minimum. Low gain, increased interference risk.'
      : 'GOOD — wire at ' + feedFt + ' ft clears terrain. Takeoff angle ≈' + geo.takeoffDeg.toFixed(1) + '°.';

  return (
    <div style={{ borderTop: '1px solid ' + T.border, padding: '16px 18px 18px', background: T.bg }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textMute, marginBottom: 12 }}>
        Wire Support Geometry
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ color: T.textSec, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 6, textTransform: 'uppercase' }}>
          Feed-End Support Height (ft)
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="number" min="8" max="60"
            value={feedFtStr}
            onChange={function(e) { setFeedFtStr(e.target.value); }}
            className="usmc-input"
            style={{ maxWidth: 110 }}
            placeholder={String(recFeedFt)}
          />
          {valid && <div style={{ color: T.textSec, fontSize: '0.78rem' }}>{'= ' + geo.feedHeightM.toFixed(2) + ' m'}</div>}
        </div>
        <div style={{ fontSize: '0.7rem', marginTop: 5, color: statusColor, lineHeight: 1.5 }}>{statusMsg}</div>
      </div>

      {geo && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div style={cellStyle}>
              <div style={{ color: T.textMute, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>Feed-End Height</div>
              <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.95rem' }}>{geo.feedHeightFt.toFixed(0) + ' ft'}</div>
              <div style={{ color: T.textSec, fontSize: '0.78rem', marginTop: 2 }}>{geo.feedHeightM.toFixed(2) + ' m'}</div>
            </div>
            <div style={cellStyle}>
              <div style={{ color: T.textMute, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>End Support Height</div>
              <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.95rem' }}>{geo.endHeightFt.toFixed(0) + ' ft'}</div>
              <div style={{ color: T.textSec, fontSize: '0.78rem', marginTop: 2 }}>{geo.endHeightM.toFixed(2) + ' m (match feed)'}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div style={cellStyle}>
              <div style={{ color: T.textMute, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>Takeoff Angle</div>
              <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.95rem' }}>{'~' + geo.takeoffDeg.toFixed(1) + '°'}</div>
              <div style={{ color: T.textSec, fontSize: '0.78rem', marginTop: 2 }}>elevation above horizon</div>
            </div>
            <div style={cellStyle}>
              <div style={{ color: T.textMute, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>Total Supports Needed</div>
              <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.95rem' }}>{geo.totalSupports}</div>
              <div style={{ color: T.textSec, fontSize: '0.78rem', marginTop: 2 }}>feed + end + {geo.numIntermediate} intermediate</div>
            </div>
          </div>
          <div style={cellStyle}>
            <div style={{ color: T.textMute, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>Intermediate Support Spacing</div>
            <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.95rem' }}>{geo.supportSpacingFt + ' ft'}</div>
            <div style={{ color: T.textSec, fontSize: '0.78rem', marginTop: 2 }}>{geo.supportSpacingM.toFixed(1) + ' m  ·  same height as feed end  ·  keep wire level'}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ANTENNA RECOMMENDATIONS ────────────────────────────────────────────────────

function getAntennaRecommendations(distKm, freqMHz, vf) {
  var zone = propagationZone(distKm);
  // Use the caller's effective velocity factor so the cut lengths quoted in
  // build steps match the wire-length tables shown on the same card.
  var wl = wavelength(freqMHz, vf === undefined ? 1 : vf);
  var qwFt = (wl / 4) * 3.28084;
  var qwM = wl / 4;
  var hwFt = (wl / 2) * 3.28084;

  var zoneNames = {
    groundwave: 'GROUND WAVE (0-80 km)',
    nvis: 'NVIS (80-500 km)',
    singlehop: 'SINGLE-HOP SKYWAVE (500-2000 km)',
    mediumdx: 'MEDIUM DX (2000-4000 km)',
    longdx: 'LONG DX (4000+ km)',
  };

  var zoneNotes = {
    groundwave: 'Signal travels along the earth surface. Use 2-10 MHz. Lower = farther. Keep antenna low and horizontal.',
    nvis: 'Signal goes nearly straight up, bounces off ionosphere. Use 2-10 MHz (lower at night). Keep antenna LOW (0.1-0.25 wavelength above ground).',
    singlehop: 'Signal leaves at 15-30 degree angle, bounces off F-layer once. 7-21 MHz. Day: 14-21 MHz, Night: 7 MHz.',
    mediumdx: 'Need lower takeoff angles (10-20 deg). Use 14-21 MHz during day. NVIS will NOT reach this distance.',
    longdx: 'Need very low takeoff angles (3-10 deg) and multi-hop. Use 14-28 MHz day, 7-14 MHz night.',
  };

  var allAntennas = {
    invertedv: {
      name: 'INVERTED-V DIPOLE',
      imageKey: 'invertedv',
      description: 'Center-fed dipole with legs sloping down at ~45 deg from a single center support. Compact, easy to erect with one mast or tree.',
      pros: 'Easy single-support setup. Good all-around radiation. Works well for skywave.',
      cons: 'Requires a center support (height computed below for your path). Reduced bandwidth vs flat dipole.',
      angleNote: 'Legs slope ~45 deg from apex. Signal radiates upward and outward from both sides.',
      height: qwFt.toFixed(1) + ' ft (' + qwM.toFixed(2) + ' m) per leg — center support height computed per path',
      buildSteps: [
        'Cut two wire legs each ' + qwFt.toFixed(1) + ' ft long. Use copper or steel wire.',
        'Connect both legs to center SO-239 feed point. Attach balun if available.',
        'Run coax from feed point down mast to Harris radio.',
        'Raise center support (tree, mast, or pole) to the apex height shown in the Optimal Apex Height box above.',
        'Stake both leg ends to ground using insulators. Aim legs away from each other.',
        'Trim legs for best SWR. Check with radio before transmitting.',
      ],
    },
    dipole: {
      name: 'HALF-WAVE DIPOLE',
      imageKey: 'dipole',
      description: 'Classic horizontal wire dipole suspended between two supports. Each element is 1/4 wavelength. Fed at center with coax via balun.',
      pros: 'Simple construction. Predictable broadside radiation. Good for fixed stations.',
      cons: 'Requires two support points. Needs balun for best performance.',
      angleNote: 'Radiates broadside (perpendicular to wire). Orient wire 90 deg from target.',
      height: hwFt.toFixed(1) + ' ft (' + (wl / 2).toFixed(2) + ' m) total — each element ' + qwFt.toFixed(1) + ' ft',
      buildSteps: [
        'Cut two elements each ' + qwFt.toFixed(1) + ' ft. Total wire = ' + hwFt.toFixed(1) + ' ft.',
        'Connect to center SO-239 feed point. Use 1:1 balun to reduce feed line radiation.',
        'String wire between two trees or poles at equal height.',
        'Run coax down from center feed to Harris radio.',
        'Add end insulators to prevent detuning from supports.',
        'Orient the dipole wire 90 degrees toward your target for best signal.',
      ],
    },
    sloper: {
      name: 'SLOPER (SLANT DIPOLE)',
      imageKey: 'sloper',
      description: '1/2-wave wire fed at top of a high support, sloping down at 30-45 deg toward target. Low takeoff angle favors DX.',
      pros: 'Low radiation angle for DX. One high support only. Directional toward low end.',
      cons: 'Needs tall support (≥¼ λ = ' + qwFt.toFixed(0) + ' ft). Directional — aim low end at target.',
      angleNote: 'Wire slopes 30-45 deg. Low end points toward target. Low-angle radiation pattern.',
      height: hwFt.toFixed(1) + ' ft (' + (wl / 2).toFixed(2) + ' m) wire — high end ≥¼ λ ≈ ' + qwFt.toFixed(0) + ' ft (higher is better), aim toward target',
      buildSteps: [
        'Cut wire to ' + hwFt.toFixed(1) + ' ft total.',
        'Attach SO-239 feed point at top of tree or mast — at least ¼ λ up (' + qwFt.toFixed(0) + ' ft); higher gives a lower takeoff angle.',
        'Run coax down the mast to Harris radio at base.',
        'Slope wire at 30-45 deg toward target bearing.',
        'Stake low end with end insulator.',
        'Aim the low end of the wire toward target. Low end = beam direction.',
      ],
    },
    nvis_dipole: {
      name: 'NVIS DIPOLE',
      imageKey: 'nvis_dipole',
      description: 'Horizontal dipole hung intentionally very low (3-6 ft above ground). Signal shoots straight up, bounces off ionosphere for regional coverage 50-500 km.',
      pros: 'Excellent regional coverage 50-500 km. Hard to DF. Simple build.',
      cons: 'Useless beyond 500 km. Inefficient if raised too high.',
      angleNote: 'Keep wire 3-6 ft above ground. Signal radiates STRAIGHT UP (NVIS). Low supports only.',
      height: hwFt.toFixed(1) + ' ft (' + (wl / 2).toFixed(2) + ' m) total — hung 3-6 ft above ground only',
      buildSteps: [
        'Cut two elements each ' + qwFt.toFixed(1) + ' ft.',
        'Connect to SO-239 center feed. No balun required for NVIS.',
        'Stake wire between two LOW supports — 3 to 6 feet only. Do NOT raise higher.',
        'Run coax horizontally from center to Harris radio.',
        'Orient wire in any direction — NVIS is omnidirectional.',
        'Use 2-10 MHz. Lower freq at night. Confirm ionosphere supports NVIS before transmitting.',
      ],
    },
    nvis_invertedv: {
      name: 'NVIS INVERTED-V',
      imageKey: 'nvis_invertedv',
      description: 'Low inverted-V variant for NVIS. Center raised slightly, legs slope to ground stakes. Keeps wire low enough for vertical radiation.',
      pros: 'Single center support. Compact footprint. Good NVIS performance.',
      cons: 'Center must remain low (~8-10 ft max). Reduces performance if raised too high.',
      angleNote: 'Center height 8-10 ft max. Legs slope to ground. Signal radiates upward for ionosphere bounce.',
      height: qwFt.toFixed(1) + ' ft per leg — center NO higher than 10 ft for NVIS',
      buildSteps: [
        'Cut two legs each ' + qwFt.toFixed(1) + ' ft.',
        'Connect to SO-239 center feed point.',
        'Raise center support to 8-10 ft MAX. Higher defeats NVIS.',
        'Stake both legs to ground with insulators.',
        'Run coax from center feed to Harris radio.',
        'Use 2-10 MHz. Confirm target is within 500 km for NVIS to work.',
      ],
    },
    efhw: {
      name: 'END-FED HALF WAVE (EFHW)',
      imageKey: 'efhw',
      description: 'Single wire half-wavelength antenna fed at one end via 49:1 UNUN impedance transformer. No balun. Can be configured as sloper, inverted-L, or horizontal.',
      pros: 'Single feed point. No balun. Flexible deployment (sloper, L, horizontal). No counterpoise needed.',
      cons: 'Requires 49:1 UNUN. High impedance at feed — sensitive to routing.',
      angleNote: 'Deploy as inverted-L (up then out) or sloper toward target. UNUN at base, coax to radio.',
      height: hwFt.toFixed(1) + ' ft (' + (wl / 2).toFixed(2) + ' m) total wire — 49:1 UNUN at feed end',
      buildSteps: [
        'Cut wire to ' + hwFt.toFixed(1) + ' ft.',
        'Attach 49:1 UNUN transformer at one end (feed end).',
        'Run coax from UNUN to Harris radio.',
        'Deploy wire as inverted-L: run up tree/mast then horizontally, or as sloper toward target.',
        'Add end insulator at far end. No ground radials required.',
        'Tune with ATU if available. Use 3-30 MHz.',
      ],
    },
    vertical: {
      name: 'QUARTER-WAVE VERTICAL',
      imageKey: 'vertical',
      description: 'Vertical radiating element 1/4 wave tall with 4 ground radials. Omnidirectional. Low-angle radiation for DX.',
      pros: 'Omnidirectional. Low takeoff angle. Good for DX when elevation is limited.',
      cons: 'Requires 4 ground radials. Vertical orientation — visible and tall.',
      angleNote: 'Radiates omnidirectionally at low angle. Ground radials are critical — no radials = poor performance.',
      height: qwFt.toFixed(1) + ' ft (' + qwM.toFixed(2) + ' m) vertical element + 4 radials each ' + qwFt.toFixed(1) + ' ft',
      buildSteps: [
        'Cut vertical element to ' + qwFt.toFixed(1) + ' ft.',
        'Cut 4 radials each ' + qwFt.toFixed(1) + ' ft. Lay flat on ground, 90 deg apart.',
        'Connect vertical element and radials to SO-239 feed at base.',
        'Run coax to Harris radio.',
        'Keep vertical element straight up — use guy wires if needed.',
        'Radials are critical. At minimum, use 2 radials. 4 is optimal.',
      ],
    },
    longwire: {
      name: 'LONG WIRE',
      imageKey: 'longwire',
      description: 'Single wire 1–2+ wavelengths long, fed at one end via ATU. Strung horizontally between supports aimed at target. Low takeoff angle for DX.',
      pros: 'High directional gain toward target. Excellent for DX and multi-hop. Uses available trees and terrain.',
      cons: 'Requires ATU. Wire up to 300 ft. Multiple supports needed. Must be aimed at target bearing.',
      angleNote: 'Aim wire directly at target bearing. ATU at feed end (near radio). Support heights determine takeoff angle. Use geometry planner below.',
      height: 'Wire 1–2 full wavelengths: ' + (wl * 3.28084).toFixed(0) + '–' + (wl * 2 * 3.28084).toFixed(0) + ' ft (' + wl.toFixed(2) + '–' + (wl * 2).toFixed(2) + ' m)',
      buildSteps: [
        'Cut wire to at least 1 full wavelength: ' + (wl * 3.28084).toFixed(0) + ' ft (' + wl.toFixed(1) + ' m). Two wavelengths preferred: ' + (wl * 2 * 3.28084).toFixed(0) + ' ft.',
        'Set up feed-end support (tree, mast) — minimum 15 ft, 25–30 ft preferred. Connect ATU at base of this support.',
        'Run wire from ATU up to feed-end support, then horizontally toward target bearing.',
        'Place intermediate supports every ~75 ft (23 m) at the same height as the feed end. Keep wire level.',
        'Set far-end support at same height as feed end. Stake wire with end insulator.',
        'Optional: connect 300–600 ohm resistor from far end to ground to make antenna unidirectional.',
        'Connect coax from ATU to Harris radio. Tune ATU for minimum SWR before transmitting.',
      ],
    },
    delta_loop: {
      name: 'DELTA LOOP (FULL WAVE)',
      imageKey: 'delta_loop',
      // Full-wave loop: total perimeter = 1 wavelength × 1.005 (loop correction factor)
      // Each side of equilateral triangle = perimeter / 3
      description: 'Closed full-wave loop in equilateral triangle shape. Apex up = horizontal polarization, low takeoff (DX). Apex down = vertical pol, even lower angle. Quiet on receive — rejects local QRM well.',
      pros: 'Very low noise (closed loop rejects local interference). Wide bandwidth. Bidirectional. Good for both DX and NVIS depending on orientation. Forgiving of geometry.',
      cons: 'Three support points needed. Total wire is more than dipole. Slightly tricky to feed (75-ohm match or 4:1 balun + 50 ohm coax).',
      angleNote: 'Apex up + corner-fed = horizontal polarization, low takeoff for DX. Apex up + side-fed = vertical pol. Apex down = strong NVIS performance. Each side = 1/3 of full wavelength × 1.005 loop factor.',
      // Equilateral triangle: apex sits side × sin(60°) above the bottom corners
      height: 'Apex ≈ ' + (wl * 1.005 / 3 * Math.sin(Math.PI / 3) * 3.28084 + 5).toFixed(0) + '–' + (wl * 1.005 / 3 * Math.sin(Math.PI / 3) * 3.28084 + 10).toFixed(0) + ' ft (corners at 5–10 ft), base ' + (wl * 1.005 / 3 * 3.28084).toFixed(0) + ' ft per side · total wire ' + (wl * 1.005 * 3.28084).toFixed(0) + ' ft',
      buildSteps: [
        'Cut total wire = perimeter of full-wave loop: ' + (wl * 1.005 * 3.28084).toFixed(1) + ' ft (' + (wl * 1.005).toFixed(2) + ' m). This is the full wavelength × 1.005 loop correction.',
        'Each side of the equilateral triangle = ' + (wl * 1.005 / 3 * 3.28084).toFixed(1) + ' ft (' + (wl * 1.005 / 3).toFixed(2) + ' m).',
        'Choose orientation: APEX UP (most common) for DX with horizontal polarization, or APEX DOWN for NVIS.',
        'Hoist apex point to ≈' + (wl * 1.005 / 3 * Math.sin(Math.PI / 3) * 3.28084 + 5).toFixed(0) + '–' + (wl * 1.005 / 3 * Math.sin(Math.PI / 3) * 3.28084 + 10).toFixed(0) + ' ft (side length × sin 60° above the bottom corners) using a single tall support (tree, mast).',
        'Anchor the two bottom corners to ground stakes spaced ' + (wl * 1.005 / 3 * 3.28084).toFixed(1) + ' ft apart, each ~5–10 ft above ground.',
        'Form the triangle. Use insulators at all 3 corners.',
        'Feed point options: at a bottom corner = horizontal polarization (good DX); at middle of bottom side = vertical polarization (good NVIS for apex-down config).',
        'Use 4:1 balun (loop impedance ~120 ohms) → 50 ohm coax. Or use 75-ohm coax direct with 1:1 choke balun.',
        'Connect coax from balun to Harris radio. Tune ATU if SWR > 2:1.',
      ],
    },
  };

  var zoneAntennas = {
    groundwave: ['invertedv', 'nvis_dipole', 'delta_loop'],
    nvis: ['nvis_dipole', 'nvis_invertedv', 'delta_loop'],
    singlehop: ['invertedv', 'dipole', 'sloper', 'efhw', 'delta_loop'],
    mediumdx: ['sloper', 'efhw', 'longwire', 'delta_loop'],
    longdx: ['longwire', 'vertical', 'efhw', 'delta_loop'],
  };

  var keys = zoneAntennas[zone] || [];
  var antennas = keys.map(function(k) { return allAntennas[k]; });

  return {
    zone: zone,
    zoneName: zoneNames[zone],
    propagationNote: zoneNotes[zone],
    antennas: antennas,
  };
}

// ── PWA HOOK ───────────────────────────────────────────────────────────────────
function usePWA() {
  var [deferredPrompt, setDeferredPrompt] = useState(null);
  var [isInstalled, setIsInstalled] = useState(false);
  var isIOS = /iphone|ipad|ipod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  var isAndroid = /android/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');

  useEffect(function() {
    function handler(e) { e.preventDefault(); setDeferredPrompt(e); }
    window.addEventListener('beforeinstallprompt', handler);
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) setIsInstalled(true);
    return function() { window.removeEventListener('beforeinstallprompt', handler); };
  }, []);

  function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function() { setDeferredPrompt(null); setIsInstalled(true); });
    }
  }

  return { isIOS: isIOS, isAndroid: isAndroid, deferredPrompt: deferredPrompt, isInstalled: isInstalled, install: install };
}




// ── STYLE INJECTOR ────────────────────────────────────────────────────────────
function USMCStyleInjector() {
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

// ── INSTALL BANNER ─────────────────────────────────────────────────────────────
// Always-visible install card (unless app is already installed). Tries the
// native browser install prompt first, falls back to clear instructions when
// the browser won't auto-prompt (already-dismissed prompts, Firefox, etc.)
function InstallBanner({ pwa }) {
  var [showInstructions, setShowInstructions] = useState(false);

  if (pwa.isInstalled) return null;

  // Detect platform / browser to give the right instructions
  var ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isAndroid = /android/i.test(ua);
  var isMobile = isIOS || isAndroid || /Mobi/i.test(ua);
  var isFirefox = /firefox/i.test(ua);
  var isSafari = /safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua);
  var isChromeOrEdge = /chrome|chromium|edg/i.test(ua) && !isFirefox;
  var isDesktop = !isMobile;

  // Click handler: try native prompt, fall back to instructions
  function handleInstallClick() {
    if (pwa.deferredPrompt) {
      pwa.install();
    } else {
      setShowInstructions(true);
    }
  }

  // Build the right "how to install" text for this user's situation
  function instructionsFor() {
    if (isIOS) {
      return [
        'Tap the Share button at the bottom of Safari (square with up arrow)',
        'Scroll down in the share menu',
        'Tap "Add to Home Screen"',
        'Tap "Add" in the top right'
      ];
    }
    if (isAndroid && isChromeOrEdge) {
      return [
        'Tap the three-dot menu in the top right of Chrome',
        'Tap "Install app" or "Add to Home Screen"',
        'Confirm install'
      ];
    }
    if (isAndroid && isFirefox) {
      return [
        'Tap the three-dot menu in Firefox',
        'Tap "Install" or "Add to Home Screen"'
      ];
    }
    if (isDesktop && isChromeOrEdge) {
      return [
        'Look at the right end of your address bar (next to the bookmark star)',
        'Click the install icon — it looks like a small monitor with a down arrow',
        'Click "Install" in the popup',
        'OR: click the three-dot menu (top right) → "Install HF Field Antenna..."'
      ];
    }
    if (isDesktop && isFirefox) {
      return [
        'Firefox does not support PWA install on desktop',
        'Open this page in Chrome or Edge instead',
        'Or use the bookmark — Firefox can still run the app, just not install it'
      ];
    }
    if (isDesktop && isSafari) {
      return [
        'On Safari for Mac: File menu → "Add to Dock"',
        'The app installs as a real Mac app',
        'Or use Chrome/Edge for a more standard install'
      ];
    }
    return [
      'Use your browser menu to find "Install app" or "Add to Home Screen"',
      'If your browser does not support this, try Chrome or Edge'
    ];
  }

  var instructions = instructionsFor();
  var icon = isMobile ? '\uD83D\uDCF1' : '\uD83D\uDCBB'; // phone or laptop emoji
  var titleText = isMobile ? 'INSTALL ON YOUR PHONE' : 'INSTALL ON DESKTOP';
  var subText = isMobile
    ? 'Get a real app icon. Works offline in the field. No app store needed.'
    : 'Get a real desktop app icon. Works offline. Opens in its own window.';

  return (
    <div style={{ marginBottom: 16, background: T.surface, border: '2px solid ' + T.accent, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.86rem', letterSpacing: '0.04em', marginBottom: 2 }}>{titleText}</div>
          <div style={{ color: T.textSec, fontSize: '0.74rem', lineHeight: 1.4 }}>{subText}</div>
        </div>
        <button onClick={handleInstallClick} style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.08em', cursor: 'pointer', flexShrink: 0 }}>
          INSTALL
        </button>
      </div>

      {showInstructions && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + T.border }}>

          {/* Visual arrow callout for desktop Chrome/Edge — the most common case */}
          {isDesktop && isChromeOrEdge && (
            <div style={{ background: '#0d1409', border: '1px solid ' + T.accent, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ color: T.accentText, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>
                LOOK AT YOUR ADDRESS BAR
              </div>
              <div style={{ color: T.textBody, fontSize: '0.78rem', lineHeight: 1.5, marginBottom: 10 }}>
                Find the install icon at the right end of the address bar (next to the bookmark star). It looks like a small monitor with a down arrow:
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#000', border: '1px solid ' + T.borderHi, borderRadius: 6 }}>
                <div style={{ flex: 1, fontFamily: 'monospace', color: '#aab', fontSize: '0.74rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  tzeke000.github.io/hfcal/
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ color: T.accentText, fontSize: '1.4rem', fontWeight: 700, animation: 'usmcArrowPulse 1.5s ease-in-out infinite' }}>{'\u2192'}</div>
                  <div style={{ width: 26, height: 26, borderRadius: 4, border: '2px solid ' + T.accentText, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a2410' }}>
                    <span style={{ fontSize: '1rem' }}>{'\u2B73'}</span>
                  </div>
                  <div style={{ color: T.textMute, fontSize: '0.68rem' }}>{'\u2606'}</div>
                </div>
              </div>
              <div style={{ color: T.textMute, fontSize: '0.7rem', marginTop: 10, fontStyle: 'italic' }}>
                Click that icon → click "Install" in the popup.
              </div>
              <div style={{ color: T.textMute, fontSize: '0.7rem', marginTop: 4, fontStyle: 'italic' }}>
                Don't see the icon? Try the three-dot menu (top right) → look for "Install HF Field Antenna...".
              </div>
            </div>
          )}

          {/* Windows .exe download alternative for desktop users */}
          {isDesktop && (
            <div style={{ background: '#0d1409', border: '1px solid ' + T.borderHi, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ color: T.accentText, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>
                OR DOWNLOAD THE WINDOWS INSTALLER
              </div>
              <div style={{ color: T.textBody, fontSize: '0.76rem', lineHeight: 1.5, marginBottom: 8 }}>
                Get a real <code style={{ background: '#000', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.75rem' }}>.exe</code> installer that installs HF Field Antenna as a standalone Windows app. No browser needed after install.
              </div>
              <a href="https://github.com/Tzeke000/hfcal/releases/latest" target="_blank" rel="noopener" style={{ display: 'inline-block', background: T.accent, color: '#fff', textDecoration: 'none', padding: '8px 14px', borderRadius: 5, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.06em' }}>
                DOWNLOAD .EXE FROM GITHUB
              </a>
              <div style={{ color: T.textMute, fontSize: '0.66rem', marginTop: 8, fontStyle: 'italic' }}>
                Heads-up: the installer is unsigned. Windows may show "Windows protected your PC" — click "More info" → "Run anyway".
              </div>
            </div>
          )}

          {/* Numbered fallback instructions, always shown */}
          <div style={{ color: T.accentText, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>
            STEP-BY-STEP
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, color: T.textBody, fontSize: '0.78rem', lineHeight: 1.6 }}>
            {instructions.map(function(step, i) {
              return <li key={i} style={{ marginBottom: 4 }}>{step}</li>;
            })}
          </ol>
          <div style={{ marginTop: 10, color: T.textMute, fontSize: '0.68rem', fontStyle: 'italic' }}>
            Already installed? You can close this and just launch the app from your {isMobile ? 'home screen' : 'Start menu / Dock'}.
          </div>
          <button onClick={function() { setShowInstructions(false); }} style={{ marginTop: 10, background: 'transparent', color: T.textMute, border: '1px solid ' + T.border, borderRadius: 4, padding: '4px 10px', fontSize: '0.68rem', cursor: 'pointer' }}>
            HIDE
          </button>
        </div>
      )}
    </div>
  );
}

// ── ABOUT / ATTRIBUTION BANNER ────────────────────────────────────────────────
// Always-visible attribution card. Expandable to show full credits and license.
// True when semver string `remote` is newer than `local` (major.minor.patch).
function isNewerVersion(remote, local) {
  var r = String(remote).split('.').map(function(x) { return parseInt(x, 10) || 0; });
  var l = String(local).split('.').map(function(x) { return parseInt(x, 10) || 0; });
  for (var i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

// ── UPDATE BANNER ─────────────────────────────────────────────────────────────
// Checks the server's version.json (emitted at build time) against the
// version baked into this bundle. If the server is ahead, shows an alert at
// the top with a one-tap update plus DAGR-style manual steps. Offline or
// same-version → renders nothing; never interferes with field use.
function UpdateBanner() {
  var [remoteVer, setRemoteVer] = useState(null);
  var [stepsOpen, setStepsOpen] = useState(false);
  var [busy, setBusy] = useState(false);

  useEffect(function() {
    var cancelled = false;
    function check() {
      try {
        fetch(import.meta.env.BASE_URL + 'version.json?t=' + Date.now(), { cache: 'no-store' })
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(j) { if (!cancelled && j && j.version) setRemoteVer(String(j.version)); })
          .catch(function() { /* offline — stay quiet */ });
      } catch (e) { /* no fetch available — stay quiet */ }
    }
    check();
    function onVis() { if (document.visibilityState === 'visible') check(); }
    document.addEventListener('visibilitychange', onVis);
    return function() { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, []);

  if (!remoteVer || !isNewerVersion(remoteVer, APP_VERSION)) return null;

  function doUpdate() {
    if (busy) return;
    setBusy(true);
    var reload = function() { try { window.location.reload(); } catch (e) {} };
    try {
      var jobs = [];
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function(regs) {
          return Promise.all(regs.map(function(r) { return r.unregister(); }));
        }));
      }
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function(keys) {
          return Promise.all(keys.map(function(k) { return caches.delete(k); }));
        }));
      }
      Promise.all(jobs).then(reload, reload);
      setTimeout(reload, 4000); // safety net if a promise hangs
    } catch (e) { reload(); }
  }

  var stepRow = function(n, bold, desc, key) {
    return (
      <div key={key} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 22, height: 22, background: T.accentDim, border: '1px solid ' + T.borderHi, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.accentText, fontWeight: 700, fontSize: '0.68rem', flexShrink: 0 }}>{n}</div>
        <div style={{ paddingTop: 2 }}>
          <span style={{ color: T.textPrim, fontWeight: 600, fontSize: '0.82rem' }}>{bold}</span>
          <span style={{ color: T.textBody, fontSize: '0.82rem' }}>{' — ' + desc}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="usmc-card" style={{ marginBottom: 16, borderLeft: '3px solid ' + T.warn }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: T.warn, fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.12em' }}>UPDATE AVAILABLE</div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.9rem', marginTop: 3 }}>
            {'v' + APP_VERSION + ' → v' + remoteVer}
          </div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>You are running an older version of this app.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={doUpdate} disabled={busy} style={{ background: T.accent, color: '#0e1409', border: 'none', borderRadius: 6, padding: '9px 16px', fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'UPDATING…' : 'UPDATE NOW'}
          </button>
          <button onClick={function() { setStepsOpen(!stepsOpen); }} style={{ background: stepsOpen ? T.accentDim : T.surfaceHi, color: T.textPrim, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '9px 12px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer' }}>
            {stepsOpen ? 'HIDE STEPS' : 'STEPS'}
          </button>
        </div>
      </div>

      {stepsOpen && (
        <div style={{ marginTop: 14 }}>
          {stepRow(1, 'Tap UPDATE NOW', 'the app clears its stored copy and reloads with the new version. Usually this is all you need.', 'u1')}
          {stepRow(2, 'Verify', 'this banner disappears and the footer shows v' + remoteVer + '. If so — done.', 'u2')}
          {stepRow(3, 'Still old? Refresh the actual website', 'open https://tzeke000.github.io/hfcal/ in your phone browser (Safari / Chrome) and pull down to refresh the page.', 'u3')}
          {stepRow(4, 'Remove the old app icon', 'press and hold the HF Antenna icon on your home screen → Remove App / Uninstall. Your data is not affected.', 'u4')}
          {stepRow(5, 'Save the refreshed page as the app', 'in the browser: iPhone — Share → Add to Home Screen. Android — menu ⋮ → Install app / Add to Home screen. The refreshed page becomes the new app, new icon included.', 'u5')}
        </div>
      )}
    </div>
  );
}

// Read the last space-weather reading the app cached (written by SpaceWxCard).
// Returns null when the app has never been online — callers fall back to the
// documented default solar activity so everything still works offline.
function cachedSFI() {
  try {
    var raw = localStorage.getItem(SPACEWX_CACHE_KEY);
    if (!raw) return null;
    var v = JSON.parse(raw);
    return (v && typeof v.sfi === 'number') ? v.sfi : null;
  } catch (e) { return null; }
}

// ── FREQUENCY CHECK PANEL ─────────────────────────────────────────────────────
// Units are normally ASSIGNED their frequencies, so this is a check rather
// than a picker: "will the frequency I was given actually close this path at
// this time?" Collapsed by default — it is an aid, not part of the main flow.
// Runs entirely offline (see freqAdvisor.js).
function FreqCheckPanel({ results, freqStr }) {
  var [open, setOpen] = useState(false);
  var [hourMode, setHourMode] = useState('now');

  var freqMHz = parseFloat(freqStr);
  var nowUTC = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  var utcHour = hourMode === 'now' ? nowUTC : parseFloat(hourMode);

  var assess = null;
  if (results) {
    assess = assessFrequency({
      takeoffDeg: results.directive.takeoffDeg,
      layerKm: HOP.F2.hKm,
      midLon: (results.p1.lon + results.p2.lon) / 2,
      utcHour: utcHour,
      sfi: cachedSFI(),
      freqMHz: isNaN(freqMHz) ? null : freqMHz,
    });
  }

  var v = assess && assess.verdict;
  var statusColor = !v ? T.textMute : (v.ok ? (v.code === 'good' ? T.accent : '#c8a24a') : T.warn);

  var hourOpts = [{ v: 'now', l: 'Now (' + String(Math.floor(nowUTC)).padStart(2, '0') + 'Z)' }];
  for (var h = 0; h < 24; h++) hourOpts.push({ v: String(h), l: String(h).padStart(2, '0') + '00Z' });

  var cell = { background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '8px 10px', textAlign: 'center' };
  var cellLbl = { color: T.textMute, fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.08em' };
  var cellVal = { color: T.textPrim, fontWeight: 700, fontSize: '0.95rem', marginTop: 2 };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid ' + T.border, paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textSec, fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Frequency Check
          </div>
          <div style={{ color: T.textMute, fontSize: '0.66rem', marginTop: 2 }}>
            {v ? 'Assigned freq vs path conditions — ' : 'Optional — '}
            {v ? <span style={{ color: statusColor, fontWeight: 700 }}>{v.label}</span> : 'will this frequency close the path?'}
          </div>
        </div>
        <button onClick={function() { setOpen(!open); }} style={{ background: open ? T.accentDim : T.surfaceHi, color: T.textPrim, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 14px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer', flexShrink: 0 }}>
          {open ? 'CLOSE' : 'OPEN'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <label style={{ color: T.textSec, fontWeight: 600, fontSize: '0.68rem', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Time of Day (UTC / Zulu)
          </label>
          <select
            value={hourMode}
            onChange={function(e) { setHourMode(e.target.value); }}
            style={{ width: '100%', padding: '9px 10px', background: T.bg, color: T.textPrim, border: '1.5px solid ' + T.border, borderRadius: 5, fontSize: '0.8rem', marginBottom: 10 }}
          >
            {hourOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option>; })}
          </select>

          {!assess && (
            <div style={{ color: T.textMute, fontSize: '0.74rem', lineHeight: 1.5 }}>
              Enter both locations and press CALCULATE — the check needs the path geometry.
            </div>
          )}

          {assess && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={cell}>
                  <div style={cellLbl}>LUF</div>
                  <div style={cellVal}>{assess.luf.toFixed(1)}</div>
                  <div style={{ color: T.textDim, fontSize: '0.55rem' }}>MHz min</div>
                </div>
                <div style={{ ...cell, borderColor: T.accent }}>
                  <div style={{ ...cellLbl, color: T.accentText }}>FOT</div>
                  <div style={cellVal}>{assess.fot.toFixed(1)}</div>
                  <div style={{ color: T.textDim, fontSize: '0.55rem' }}>MHz best</div>
                </div>
                <div style={cell}>
                  <div style={cellLbl}>MUF</div>
                  <div style={cellVal}>{assess.muf.toFixed(1)}</div>
                  <div style={{ color: T.textDim, fontSize: '0.55rem' }}>MHz max</div>
                </div>
              </div>

              {v && (
                <div style={{ background: T.bg, border: '1px solid ' + T.border, borderLeft: '3px solid ' + statusColor, borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ color: statusColor, fontWeight: 700, fontSize: '0.74rem', letterSpacing: '0.06em', marginBottom: 3 }}>
                    {freqMHz + ' MHz — ' + v.label}
                  </div>
                  <div style={{ color: T.textBody, fontSize: '0.76rem', lineHeight: 1.55 }}>{v.note}</div>
                  {!v.ok && (
                    <div style={{ color: T.accentText, fontSize: '0.76rem', marginTop: 5 }}>
                      {'Best available right now: ≈' + assess.suggestedMHz.toFixed(1) + ' MHz. Request an alternate near this if the assigned frequency fails.'}
                    </div>
                  )}
                </div>
              )}

              <div style={{ color: T.textMute, fontSize: '0.66rem', lineHeight: 1.5 }}>
                {'Local solar time at path midpoint ' + String(Math.floor(assess.localSolarHour)).padStart(2, '0')
                  + ':' + String(Math.round((assess.localSolarHour % 1) * 60)).padStart(2, '0')
                  + ' · foF2 ≈ ' + assess.foF2.toFixed(1) + ' MHz · SSN '
                  + assess.ssn + (assess.usingDefaultSolar ? ' (default — connect once to refine)' : ' (from NOAA)')}
              </div>
              <div style={{ color: T.textDim, fontSize: '0.62rem', marginTop: 6, lineHeight: 1.45 }}>
                Planning aid — statistical model, ±15% vs VOACAP. Your SOI/JCEOI assignment governs.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SPACE WEATHER CARD ────────────────────────────────────────────────────────
// Optional live solar/geomagnetic conditions from NOAA SWPC. Fetches when
// online (throttled to 30 min), caches to localStorage, shows cached data
// with an age label when offline, renders nothing when no data has ever
// been fetched. Advisory only — no core calculation depends on it.
var SPACEWX_CACHE_KEY = 'hfcalc_spacewx_v1';
var SPACEWX_FRESH_MS = 30 * 60 * 1000;

function SpaceWxCard({ freqMHz, zone }) {
  var [wx, setWx] = useState(function() {
    try {
      var raw = localStorage.getItem(SPACEWX_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  });

  useEffect(function() {
    var cancelled = false;
    function refresh() {
      try {
        var raw = localStorage.getItem(SPACEWX_CACHE_KEY);
        var cached = raw ? JSON.parse(raw) : null;
        if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < SPACEWX_FRESH_MS) return;
      } catch (e) { /* cache unreadable — fetch anyway */ }
      if (typeof fetch !== 'function') return;
      Promise.allSettled([
        fetch(SWPC_FLUX_URL, { cache: 'no-store' }).then(function(r) { return r.ok ? r.json() : null; }),
        fetch(SWPC_KINDEX_URL, { cache: 'no-store' }).then(function(r) { return r.ok ? r.json() : null; }),
      ]).then(function(res) {
        if (cancelled) return;
        var flux = res[0].status === 'fulfilled' ? parseFluxPayload(res[0].value) : null;
        var kidx = res[1].status === 'fulfilled' ? parseKIndexPayload(res[1].value) : null;
        if (!flux && !kidx) return; // offline/blocked — keep whatever we had
        setWx(function(prev) {
          var next = {
            sfi: flux ? flux.sfi : (prev ? prev.sfi : null),
            kp: kidx ? kidx.kp : (prev ? prev.kp : null),
            fetchedAt: Date.now(),
          };
          try { localStorage.setItem(SPACEWX_CACHE_KEY, JSON.stringify(next)); } catch (e) {}
          return next;
        });
      });
    }
    refresh();
    function onVis() { if (document.visibilityState === 'visible') refresh(); }
    document.addEventListener('visibilitychange', onVis);
    return function() { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, []);

  if (!wx || (wx.sfi == null && wx.kp == null)) return null;

  var sfiInfo = wx.sfi != null ? interpretSFI(wx.sfi) : null;
  var kpInfo = wx.kp != null ? interpretKp(wx.kp) : null;
  var advice = spaceWxAdvice({ sfi: wx.sfi, kp: wx.kp, freqMHz: freqMHz, zone: zone });
  var degraded = (kpInfo && kpInfo.degraded) || advice.length > 0;

  var ageMin = wx.fetchedAt ? (Date.now() - wx.fetchedAt) / 60000 : null;
  var ageLabel = ageMin == null ? 'NOAA SWPC'
    : ageMin < 45 ? 'LIVE · NOAA SWPC'
    : ageMin < 120 ? 'CACHED ' + Math.round(ageMin) + ' MIN AGO · NOAA SWPC'
    : 'CACHED ' + Math.round(ageMin / 60) + ' H AGO · NOAA SWPC';

  var cellStyle = { background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '9px 12px' };

  return (
    <div className="usmc-card" style={{ marginBottom: 14, borderLeft: '3px solid ' + (degraded ? T.warn : T.accent) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
        <div className="usmc-section-label" style={{ marginBottom: 8 }}>Space Weather</div>
        <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em' }}>{ageLabel}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        {wx.sfi != null && (
          <div style={cellStyle}>
            <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Solar Flux (SFI)</div>
            <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '1.05rem' }}>{Math.round(wx.sfi)}</div>
            <div style={{ color: T.accentText, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em' }}>{sfiInfo.label}</div>
          </div>
        )}
        {wx.kp != null && (
          <div style={cellStyle}>
            <div style={{ color: T.textMute, fontSize: '0.58rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Geomagnetic (Kp)</div>
            <div style={{ color: kpInfo.degraded ? T.warn : T.textPrim, fontWeight: 700, fontSize: '1.05rem' }}>{wx.kp.toFixed(1)}</div>
            <div style={{ color: kpInfo.degraded ? T.warn : T.accentText, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em' }}>{kpInfo.label}</div>
          </div>
        )}
      </div>
      <div style={{ color: T.textBody, fontSize: '0.78rem', lineHeight: 1.55 }}>
        {sfiInfo && <div>{sfiInfo.note}</div>}
        {kpInfo && <div style={{ marginTop: 3, color: kpInfo.degraded ? T.warn : T.textBody }}>{kpInfo.note}</div>}
      </div>
      {advice.map(function(a, i) {
        return (
          <div key={i} style={{ marginTop: 8, background: T.bg, border: '1px solid ' + T.border, borderLeft: '3px solid ' + T.warn, borderRadius: 6, padding: '9px 12px', color: T.warn, fontSize: '0.76rem', lineHeight: 1.55 }}>
            {a}
          </div>
        );
      })}
      <div style={{ color: T.textDim, fontSize: '0.6rem', marginTop: 8, letterSpacing: '0.04em' }}>
        Advisory only — antenna calculations do not depend on this data. Card is hidden when no data is available.
      </div>
    </div>
  );
}

function AboutBanner() {
  var [open, setOpen] = useState(false);
  var [tab, setTab] = useState(0);

  var tabBtn = function(label, idx) {
    return (
      <button onClick={function() { setTab(idx); }} style={{ flex: 1, padding: '7px 2px', background: tab === idx ? T.oliveDim : '#0a0e08', color: tab === idx ? T.textPrim : T.textMute, border: '1px solid #2a3a1a', borderRadius: 3, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em' }}>
        {label}
      </button>
    );
  };
  var box = { background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '10px 12px', marginBottom: 10 };
  var boxLabel = { color: T.textMute, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 };
  var body = { color: T.textBody, fontSize: '0.78rem', lineHeight: 1.6 };

  // Feature line: name + what it actually does for the operator
  var feat = function(name, desc, key) {
    return (
      <div key={key} style={{ display: 'flex', gap: 9, marginBottom: 9 }}>
        <div style={{ color: T.accent, fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>▸</div>
        <div style={{ fontSize: '0.78rem', lineHeight: 1.55 }}>
          <span style={{ color: T.textPrim, fontWeight: 700 }}>{name}</span>
          <span style={{ color: T.textBody }}>{' — ' + desc}</span>
        </div>
      </div>
    );
  };

  // Comparison row: what exists, and the gap this fills
  var cmp = function(what, isWhat, gap, key) {
    return (
      <div key={key} style={{ ...box, borderLeft: '3px solid ' + T.borderHi }}>
        <div style={{ color: T.accentText, fontSize: '0.74rem', fontWeight: 700, marginBottom: 3 }}>{what}</div>
        <div style={{ color: T.textMute, fontSize: '0.72rem', lineHeight: 1.5, marginBottom: 5 }}>{isWhat}</div>
        <div style={{ color: T.textBody, fontSize: '0.74rem', lineHeight: 1.55 }}>
          <span style={{ color: T.textSec, fontWeight: 700 }}>{'Gap this fills: '}</span>{gap}
        </div>
      </div>
    );
  };

  return (
    <div className="usmc-card" style={{ marginBottom: 16, borderLeft: '3px solid ' + T.accent }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: T.accentText, fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.06em' }}>MADE BY {AUTHOR_NAME.toUpperCase()}</div>
          <div style={{ color: T.textMute, fontSize: '0.68rem', marginTop: 3, letterSpacing: '0.06em' }}>{AUTHOR_BRANCH} · ORIGINAL WORK · {APP_SIGNATURE}</div>
        </div>
        <button onClick={function() { setOpen(!open); }} style={{ background: open ? T.accentDim : T.surfaceHi, color: T.textPrim, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 14px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em' }}>
          {open ? 'CLOSE' : 'ABOUT'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + T.border }}>
          <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
            {tabBtn('About', 0)}
            {tabBtn('What It Does', 1)}
            {tabBtn('Vs. Fielded Tools', 2)}
          </div>

          {tab === 0 && (
            <div>
              <div style={{ color: T.textPrim, fontSize: '0.84rem', fontWeight: 700, marginBottom: 6 }}>
                HF Field Antenna Calculator
              </div>
              <div style={{ ...body, marginBottom: 12 }}>
                This application is the original work of <strong style={{ color: T.accentText }}>{AUTHOR_NAME}</strong>, {AUTHOR_BRANCH}.
                All calculation logic, antenna deployment guidance, terrain modeling, and visual design are the author's own.
              </div>
              <div style={box}>
                <div style={boxLabel}>License</div>
                <div style={{ color: T.textSec, fontSize: '0.74rem', lineHeight: 1.55 }}>
                  Released under <strong>CC BY-NC-ND 4.0</strong> — free to share with attribution, no commercial use, no derivative works without permission.
                </div>
              </div>
              <div style={box}>
                <div style={boxLabel}>Project Signature</div>
                <div style={{ color: T.textSec, fontSize: '0.74rem', fontFamily: 'monospace' }}>{APP_SIGNATURE}</div>
              </div>
              <div style={{ color: T.textMute, fontSize: '0.7rem', lineHeight: 1.55, fontStyle: 'italic' }}>
                Wire lengths and propagation guidance are estimates — always trim antennas for SWR before transmitting. Use at your own risk.
              </div>
            </div>
          )}

          {tab === 1 && (
            <div>
              <div style={{ ...box, borderLeft: '3px solid ' + T.accent }}>
                <div style={boxLabel}>What this is for</div>
                <div style={{ color: T.textBody, fontSize: '0.76rem', lineHeight: 1.6 }}>
                  Building a working HF wire antenna in the field, fast, with whatever wire you have — and knowing whether the frequency you were assigned will actually close the path. Everything runs on the device with no signal.
                </div>
              </div>

              <div style={{ ...boxLabel, marginTop: 12, marginBottom: 8 }}>Path &amp; propagation</div>
              {feat('Distance and bearing', 'from two grids. Accepts MGRS, DMS, or decimal lat/lon — or photograph the DAGR screen and let it read the grid.', 'f1')}
              {feat('Bearing to target', 'plus the back azimuth the distant station aims at you.', 'f2')}
              {feat('Propagation mode', 'ground wave, NVIS, single-hop or multi-hop DX, chosen from the path length.', 'f3')}
              {feat('Terrain-aware takeoff angle', 'raised to clear a ridgeline near your position, flattened over ocean, adjusted for desert.', 'f4')}
              {feat('Hop analysis', 'which layer, how many hops, where the bounce points fall.', 'f5')}

              <div style={{ ...boxLabel, marginTop: 12, marginBottom: 8 }}>Antenna build</div>
              {feat('Nine antenna types', 'dipole, inverted-V, NVIS variants, sloper, EFHW, vertical, longwire, delta loop — each with build steps and reference photos.', 'f6')}
              {feat('Cut lengths for your wire', 'velocity factor by conductor material AND gauge — bare, stranded, insulated, CCS, galvanized, stainless, salvage iron, even speaker wire.', 'f7')}
              {feat('Computed apex height', 'the mast height that puts your radiation where this path needs it — checked against whether quarter-wave legs can physically reach it, with what to do when they cannot.', 'f8')}
              {feat('Geometry planner', 'apex angle, leg slope, stake distances and total footprint.', 'f9')}

              <div style={{ ...boxLabel, marginTop: 12, marginBottom: 8 }}>Frequency</div>
              {feat('Frequency check', 'MUF, FOT and LUF for this path and hour, and a verdict on the frequency you were assigned — with an alternate to request if it will not propagate.', 'f10')}
              {feat('24-hour forecast', 'the same numbers in 4-hour Zulu blocks so comm windows can be planned a day out.', 'f11')}
              {feat('Space weather', 'live solar flux and Kp from NOAA when a signal exists; falls back to cached or default values when it does not.', 'f12')}

              <div style={{ ...boxLabel, marginTop: 12, marginBottom: 8 }}>Field workflow</div>
              {feat('Saved shots', 'keep the day\u2019s link plans on the device.', 'f13')}
              {feat('Comm-card export', 'any plan as a plain-text card — DTG, grids, distance, bearing, wire, geometry, frequency window.', 'f14')}
              {feat('Works with the radio off', 'installs to the home screen and runs with no account, no telemetry and no connection.', 'f15')}

              <div style={{ ...box, marginTop: 12, borderLeft: '3px solid ' + T.warn }}>
                <div style={{ ...boxLabel, color: T.warn }}>What it is not</div>
                <div style={{ color: T.textBody, fontSize: '0.74rem', lineHeight: 1.55 }}>
                  Not a link-budget or full ionospheric model, and not a substitute for your SOI/JCEOI assignment. Propagation figures are statistical monthly-median estimates, not a forecast for one specific hour. Trim for SWR and confirm with the radio before you rely on anything here.
                </div>
              </div>
            </div>
          )}

          {tab === 2 && (
            <div>
              <div style={{ ...box, borderLeft: '3px solid ' + T.accent }}>
                <div style={boxLabel}>The honest framing</div>
                <div style={{ color: T.textBody, fontSize: '0.76rem', lineHeight: 1.6 }}>
                  The tools the military already has are good — they are just not where the antenna is. This does not claim to beat them. It claims to match the standard where the standard has never been able to go: offline, in your hand, at the point of construction.
                </div>
              </div>

              {cmp('VOACAP', 'The government-standard HF prediction engine since the 1980s. Accurate and trusted.',
                'Desktop software for a trained analyst. Nobody runs VOACAP kneeling next to a wire spool. This app\u2019s takeoff angles agree with VOACAP within about 1\u00b0 across 250\u20136000 km, and its MUF within about 15% \u2014 offline, on a phone. Study and reproduction scripts ship with the source.', 'c1')}

              {cmp('Comm planning suites', 'Planner-grade propagation and link tools at the S-6 level.',
                'Laptop tools for planners. Their output reaches the operator as a frequency assignment \u2014 not as \u201ccut 19 ft 8 in per leg, apex at 16 ft.\u201d', 'c2')}

              {cmp('The Antenna Handbook', 'The doctrinal antenna reference. Excellent theory.',
                'A static book of formulas and generic figures \u2014 \u201c468/f\u201d, \u201c30\u201340 ft\u201d. No path-specific computation, no wire-material correction, no check that what it tells you to build is physically buildable. This app is that math, executed for your exact path and your exact wire.', 'c3')}

              {cmp('ALE / 3G HF radios', 'The radio finds a workable frequency automatically.',
                'ALE optimises whatever the antenna hands it. It cannot fix a wire cut wrong, hung at the wrong height, or made from uncorrected steel. Antenna geometry is the input ALE depends on \u2014 and the part still done from memory.', 'c4')}

              {cmp('Senior operator experience', 'The real legacy system, and still the best one.',
                'Non-scalable, unevenly distributed, and thinning after twenty years of leaning on satellites. This is that experience written down, tested, and issued to everyone.', 'c5')}

              <div style={{ ...boxLabel, marginTop: 14, marginBottom: 8 }}>Where it genuinely leads</div>
              {feat('Point of need', 'the only one of these that works at the antenna site: phone, offline, grids to cut lengths in under a minute.', 'w1')}
              {feat('Field-expedient wire', 'velocity factor for salvage iron, galvanized fence wire, speaker wire, by core and gauge. Planning tools assume catalog antennas.', 'w2')}
              {feat('Buildability check', 'it does not just give the radiation-optimal height \u2014 it checks whether your legs can reach it, and tells you the buildable maximum and what you lose.', 'w3')}
              {feat('EMCON-clean', 'no account, no telemetry, no server, no third-party CDN. The OCR engine and fonts are bundled, not fetched.', 'w4')}
              {feat('It teaches', 'formulas are shown, not hidden \u2014 the same tool trains and fields.', 'w5')}

              <div style={{ color: T.textMute, fontSize: '0.7rem', lineHeight: 1.55, marginTop: 10, fontStyle: 'italic' }}>
                Validation methodology, comparison data and reproduction scripts are published with the source at github.com/Tzeke000/hfcal.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DAGR INSTRUCTIONS ─────────────────────────────────────────────────────────
function DAGRInstructions() {
  var [open, setOpen] = useState(false);
  var [tab, setTab] = useState(0);

  var tabBtn = function(label, idx) {
    return (
      <button onClick={function() { setTab(idx); }} style={{ flex: 1, padding: '6px 0', background: tab === idx ? T.oliveDim : '#0a0e08', color: tab === idx ? T.textPrim : T.textMute, border: '1px solid #2a3a1a', borderRadius: 3, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>
        {label}
      </button>
    );
  };

  var stepRow = function(n, bold, desc, key) {
    return (
      <div key={key} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 22, height: 22, background: T.accentDim, border: '1px solid ' + T.borderHi, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.accentText, fontWeight: 700, fontSize: '0.68rem', flexShrink: 0 }}>{n}</div>
        <div style={{ paddingTop: 2 }}>
          <span style={{ color: T.textPrim, fontWeight: 600, fontSize: '0.82rem' }}>{bold}</span>
          <span style={{ color: T.textBody, fontSize: '0.82rem' }}>{' — ' + desc}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="usmc-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>Get Coords From Your DAGR</div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>Step-by-step button sequence</div>
        </div>
        <button onClick={function() { setOpen(!open); }} style={{ background: open ? T.accentDim : T.surfaceHi, color: T.textPrim, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 16px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em' }}>
          {open ? 'CLOSE' : 'OPEN'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {tabBtn('Switch DAGR to Lat/Lon', 0)}
            {tabBtn('All Accepted Formats', 1)}
          </div>

          {tab === 0 && (
            <div>
              <div style={{ background: T.bg, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '10px 12px', marginBottom: 14, fontSize: '0.8rem', color: T.textSec, borderLeft: '3px solid ' + T.accent }}>
                <span style={{ color: T.accentText, fontWeight: 700 }}>SHORTCUT:</span> You don't have to switch the DAGR at all — just paste the MGRS grid (e.g. 15T XG 11897e 53935n) directly into the location field. This app converts it automatically.
              </div>
              {stepRow(1, 'Hold POS/PAGE', 'Hold the POS/PAGE key until the Present Position page appears.', 's1')}
              {stepRow(2, 'Press BRT/MENU', 'Press BRT/MENU to open the page menu.', 's2')}
              {stepRow(3, 'Select Coord/Grid', 'Use arrows to highlight "Select Coord/Grid", press WP/ENTER.', 's3')}
              {stepRow(4, 'Choose your format', 'Scroll to format, press WP/ENTER. Three lat/lon options available.', 's4')}
              {stepRow(5, 'Done — read your coords', 'Present Position now shows lat/lon. Keep datum WGS-84.', 's5')}
              <div style={{ padding: '16px 18px 18px' }}>
                {[
                  { label: 'L/L DMS', sub: 'Degrees, Minutes, Seconds', ex: 'N34 25 12 W112 30 15', rec: true },
                  { label: 'L/L dm', sub: 'Degrees, Decimal Minutes', ex: 'N34 25.200 W112 30.250', rec: false },
                  { label: 'L/L Deg', sub: 'Decimal Degrees', ex: 'N34.42000 W112.50417', rec: false },
                ].map(function(f) {
                  return (
                    <div key={f.label} style={{ background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '9px 12px', marginBottom: 8, fontSize: '0.8rem' }}>
                      <span style={{ color: T.textPrim, fontWeight: 700 }}>{f.label}</span>
                      {f.rec && <span style={{ marginLeft: 8, background: T.accentDim, color: T.accentText, fontSize: '0.6rem', padding: '2px 7px', borderRadius: 4, fontWeight: 700, letterSpacing: '0.07em' }}>RECOMMENDED</span>}
                      <span style={{ color: T.textMute, marginLeft: 6 }}>{f.sub}</span>
                      <div style={{ color: T.textSec, marginTop: 3, fontFamily: 'monospace' }}>{f.ex}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ color: T.textMute, fontSize: '0.75rem', marginTop: 8 }}>Keep datum on WGS-84. Check via BRT/MENU → "Select Datum" → scroll to WGS-84.</div>
            </div>
          )}

          {tab === 1 && (
            <div style={{ fontSize: '0.8rem' }}>
              <div style={{ color: T.textBody, marginBottom: 10 }}>All formats below work in the location fields — paste directly or type.</div>
              <div style={{ background: T.bg, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '10px 12px', marginBottom: 12, color: T.textSec, borderLeft: '3px solid ' + T.accent }}>
                <span style={{ color: T.accent, fontWeight: 700 }}>DAGR:</span> Defaults to MGRS (e.g. 15T XG 11897e 53935n). Paste directly. In lat/lon mode, colons between D:M:S. East-only lon over 180 auto-converts.
              </div>
              {[
                { src: 'MGRS / DAGR', rows: ['15T XG 11897e 53935n', '15T XG 11897 53935', '15TXG1189753935'] },
                { src: 'DAGR Lat/Lon Modes', rows: ['N 39:11:24.3 W 077:30:15.0', 'N 39:11:24.3 E 236:50:10.0', 'N 39:11.405 W 077:30.250', 'N 39.19008 E 282.49583'] },
                { src: 'Standard DMS', rows: ['34 25 12 N, 112 30 15 W', '34 25.200 N, 112 30.250 W'] },
                { src: 'Decimal Degrees', rows: ['25.00000 N, 77.40000 W', '25.00000, -77.40000'] },
              ].map(function(group) {
                return (
                  <div key={group.src} style={{ marginBottom: 10 }}>
                    <div style={{ color: T.accentText, fontWeight: 600, fontSize: '0.78rem', marginBottom: 6, letterSpacing: '0.04em' }}>{group.src}</div>
                    {group.rows.map(function(r) {
                      return <div key={r} style={{ fontFamily: 'monospace', color: T.textSec, background: T.bg, padding: '5px 10px', borderRadius: 4, marginBottom: 4, fontSize: '0.82rem', border: '1px solid ' + T.border }}>{r}</div>;
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── LOCATION INPUT ─────────────────────────────────────────────────────────────
function LocationInput({ label, value, onChange, parsed, error }) {
  var fileRef = useRef(null);
  var [scanning, setScanning] = useState(false);
  // Feedback for the OCR path. It used to fail completely silently: offline,
  // the button said "Scanning..." then reverted with no coordinate and no
  // explanation, which is the worst possible behaviour in the field.
  var [scanMsg, setScanMsg] = useState(null);

  function handleScan() {
    setScanMsg(null);
    if (fileRef.current) fileRef.current.click();
  }

  function handleFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setScanning(true);
    setScanMsg(null);
    // The OCR engine, its WASM core and the English model are all vendored in
    // public/ocr/ and precached by the service worker, so scanning works with
    // no network — same as every other feature. (It used to be pulled from a
    // CDN at first use, which meant the one thing you would reach for in the
    // field was the one thing that did not work there.)
    var ocrBase = new URL(import.meta.env.BASE_URL + 'ocr/', window.location.href).href;
    var _worker = null;
    import('tesseract.js').then(function(mod) {
      var Tesseract = mod.default || mod;
      // createWorker (not the recognize() shorthand) is the API that honours
      // local asset paths — the shorthand silently falls back to the CDN.
      return Tesseract.createWorker('eng', 1, {
        workerPath: ocrBase + 'worker.min.js',
        // Pin the universal (non-SIMD) LSTM core explicitly. Left as a
        // directory, tesseract probes for a relaxed-SIMD build we do not
        // ship and 404s; one core keeps the offline payload to a single
        // file that runs on any device.
        corePath: ocrBase + 'tesseract-core-lstm.wasm.js',
        langPath: ocrBase,
        gzip: true,
        logger: function() {},
      });
    }).then(function(worker) {
      _worker = worker;
      return worker.recognize(file);
    }).then(function(result) {
      if (_worker) { try { _worker.terminate(); } catch (e) {} _worker = null; }
      var text = result && result.data && result.data.text ? result.data.text : '';
      var coord = extractCoordFromOCR(text);
      if (coord) {
        onChange(coord);
        setScanMsg({ ok: true, text: 'Read from image — check it against the DAGR before transmitting.' });
      } else {
        setScanMsg({ ok: false, text: 'No grid found in that image. Type or paste it instead.' });
      }
      setScanning(false);
    }).catch(function() {
      if (_worker) { try { _worker.terminate(); } catch (e) {} _worker = null; }
      setScanMsg({ ok: false, text: 'Could not read that image. Type or paste the grid instead.' });
      setScanning(false);
    });
    e.target.value = '';
  }

  var inputClass = 'usmc-input' + (error ? ' usmc-input-error' : (parsed && !isNaN(parsed.lat) ? ' usmc-input-ok' : ''));

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</label>
        <button onClick={handleScan} style={{ background: T.oliveDim, color: T.textSec, border: '1px solid #2a3a1a', borderRadius: 3, padding: '3px 10px', fontSize: '0.75rem', cursor: 'pointer' }}>
          {scanning ? 'Scanning...' : 'Scan DAGR'}
        </button>
      </div>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        className={inputClass}
        type="text"
        value={value}
        onChange={function(e) { onChange(e.target.value); }}
        placeholder="e.g. 15T XG 11897e 53935n or N 39:11:24.3 W 077:30:15"
      />
      {error && <div style={{ color: T.warn, fontSize: '0.72rem', marginTop: 5, letterSpacing: '0.02em' }}>{error}</div>}
      {scanMsg && (
        <div style={{ color: scanMsg.ok ? T.accentText : T.warn, fontSize: '0.72rem', marginTop: 5, lineHeight: 1.45 }}>
          {scanMsg.text}
        </div>
      )}
      {!error && parsed && !isNaN(parsed.lat) && (
        <div style={{ color: T.textSec, fontSize: '0.72rem', marginTop: 6, fontFamily: 'monospace', letterSpacing: '0.02em' }}>
          {/* Hemisphere from the sign — this line used to hardcode N/E, which
              mislabelled every southern latitude and western longitude. */}
          {Math.abs(parsed.lat).toFixed(5) + (parsed.lat >= 0 ? ' N, ' : ' S, ')
            + Math.abs(parsed.lon).toFixed(5) + (parsed.lon >= 0 ? ' E' : ' W')}
        </div>
      )}
    </div>
  );
}

// ── LENGTH TABLE ───────────────────────────────────────────────────────────────
function LengthTable({ label, meters }) {
  var l = toLengths(meters);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: T.textMute, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="usmc-stat">
          <div className="usmc-stat-label">Feet / Inches</div>
          <div className="usmc-stat-val">{l.ftIn}</div>
        </div>
        <div className="usmc-stat">
          <div className="usmc-stat-label">Meters</div>
          <div className="usmc-stat-val">{l.m + ' m'}</div>
        </div>
      </div>
    </div>
  );
}



// ── IMAGE CAROUSEL ─────────────────────────────────────────────────────────────
// Reliable carousel with:
//  - Always 3 images per antenna (looping if fewer)
//  - Left/right arrow buttons with 44px+ touch targets
//  - Counter pill (e.g. "2 / 3") in upper right
//  - Tappable dot indicators with 44px hit areas
//  - Touch swipe support
//  - Caption rendered below
//  - Lazy-loaded images for perf
function ImageCarousel({ imageKey }) {
  var images = ANTENNA_IMAGES[imageKey] || [];
  var [idx, setIdx] = useState(0);
  var touchStartX = useRef(null);
  var touchStartY = useRef(null);

  if (!images.length) return null;

  var n = images.length;
  var safeIdx = ((idx % n) + n) % n;
  var img = images[safeIdx];

  var go = function(delta) {
    setIdx(function(prev) { return ((prev + delta) % n + n) % n; });
  };
  var goTo = function(i) { setIdx(i); };

  var onTouchStart = function(e) {
    if (e.touches && e.touches[0]) {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
    }
  };
  var onTouchEnd = function(e) {
    if (touchStartX.current === null) return;
    var endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : null;
    var endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : null;
    if (endX === null) return;
    var dx = endX - touchStartX.current;
    var dy = endY !== null ? Math.abs(endY - touchStartY.current) : 0;
    // Only treat as swipe if horizontal motion dominates and exceeds threshold
    if (Math.abs(dx) > 40 && Math.abs(dx) > dy) {
      if (dx < 0) go(1); else go(-1);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  return (
    <div style={{ borderTop: '1px solid ' + T.border, background: T.surface }}>
      <div
        className="usmc-carousel"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          key={img.url + '-' + safeIdx}
          src={img.url}
          alt={img.caption}
          className="usmc-carousel-img"
          loading="lazy"
          draggable={false}
        />

        {n > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              className="usmc-carousel-btn usmc-carousel-btn-left"
              onClick={function() { go(-1); }}
            >
              {'\u2039'}
            </button>
            <button
              type="button"
              aria-label="Next image"
              className="usmc-carousel-btn usmc-carousel-btn-right"
              onClick={function() { go(1); }}
            >
              {'\u203A'}
            </button>
            <div className="usmc-carousel-counter">
              {(safeIdx + 1) + ' / ' + n}
            </div>
          </>
        )}
      </div>

      {n > 1 && (
        <div className="usmc-carousel-dots" role="tablist" aria-label="Image navigation">
          {images.map(function(_, i) {
            return (
              <button
                key={i}
                type="button"
                className="usmc-carousel-dot-hit"
                aria-label={'Show image ' + (i + 1) + ' of ' + n}
                aria-current={i === safeIdx ? 'true' : 'false'}
                onClick={function() { goTo(i); }}
              >
                <span
                  className={'usmc-carousel-dot' + (i === safeIdx ? ' usmc-carousel-dot-active' : '')}
                />
              </button>
            );
          })}
        </div>
      )}

      <div style={{ padding: '8px 14px 14px', color: T.textMute, fontSize: '0.72rem', lineHeight: 1.5, fontStyle: 'italic' }}>
        {img.caption}
      </div>
    </div>
  );
}


// ── INVERTED-V GEOMETRY CALCULATOR ────────────────────────────────────────────
function InvVGeoCalc({ legMeters, isNVIS, suggestedApexFt }) {
  // Apex height drives everything.
  // leg angle from horizontal = asin(apexH / legLen)
  // stake distance from pole base = cos(legAngle) * legLen
  // apex angle (between legs) = 180 - 2*legAngle (deg from horiz)
  // takeoff angle: for wire antennas roughly 90 - legAngle (elevation above horizon)

  var legFt = legMeters * 3.28084;
  var defaultApexFt = isNVIS ? 9 : 25;
  // Seed with the path-optimized apex when the card computed one, clamped
  // below the leg length so the planner starts in its valid range.
  if (typeof suggestedApexFt === 'number' && isFinite(suggestedApexFt) && suggestedApexFt > 0) {
    defaultApexFt = Math.min(Math.round(suggestedApexFt), Math.floor(legFt - 1));
  }
  var [apexFtStr, setApexFtStr] = useState(String(defaultApexFt));
  // Re-seed when the path-optimized apex changes (frequency/location edits
  // recompute live, and this component stays mounted across those changes).
  // Only overwrite while the field still holds a previously seeded value, so
  // a number the operator typed is never clobbered.
  var seededRef = useRef(String(defaultApexFt));
  useEffect(function() {
    var next = String(defaultApexFt);
    if (next === seededRef.current) return;
    setApexFtStr(function(cur) { return cur === seededRef.current ? next : cur; });
    seededRef.current = next;
  }, [defaultApexFt]);

  var apexFt = parseFloat(apexFtStr);
  var apexM = apexFt / 3.28084;
  var valid = !isNaN(apexFt) && apexFt > 0 && apexFt < legFt;

  var legAngleDeg = valid ? (Math.asin(apexM / legMeters) * 180 / Math.PI) : null;
  var apexAngleDeg = valid ? (180 - 2 * legAngleDeg) : null;
  var stakeFt = valid ? (Math.cos(legAngleDeg * Math.PI / 180) * legFt) : null;
  var stakeM = valid ? (Math.cos(legAngleDeg * Math.PI / 180) * legMeters) : null;
  var spreadFt = valid ? stakeFt * 2 : null;
  var spreadM = valid ? stakeM * 2 : null;
  var takeoffDeg = valid ? (90 - legAngleDeg) : null;

  // Status
  var status = null;
  if (valid) {
    if (isNVIS) {
      if (apexFt > 12) status = { color: T.warn, msg: 'WARNING: Apex too high for NVIS. Max ~10-12 ft. Signal will NOT go straight up.' };
      else if (apexAngleDeg < 70) status = { color: '#a87a4a', msg: 'Apex angle < 70° — legs too steep, signal cancellation risk.' };
      else status = { color: T.accent, msg: 'GOOD — apex angle ' + apexAngleDeg.toFixed(1) + '°. Steep legs push signal straight up (≈' + takeoffDeg.toFixed(0) + '° takeoff). NVIS effective.' };
    } else {
      if (apexAngleDeg < 70) status = { color: T.warn, msg: 'Apex angle < 70° — legs near-vertical, signal cancellation risk. Raise apex or shorten leg ends.' };
      else if (apexAngleDeg > 110) status = { color: T.textMute, msg: 'Apex angle > 110° — nearly flat dipole. Increase apex height.' };
      else status = { color: T.accent, msg: 'GOOD — apex angle ' + apexAngleDeg.toFixed(1) + '° (≈' + takeoffDeg.toFixed(0) + '° takeoff). Optimal 90°.' };
    }
  }

  var rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 };
  var cellStyle = { background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '9px 10px' };
  var labelStyle = { color: T.textMute, fontSize: '0.58rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 };
  var valStyle = { color: T.textPrim, fontWeight: 700, fontSize: '0.95rem' };

  return (
    <div style={{ borderTop: '1px solid ' + T.border, padding: '16px 18px 18px', background: T.bg }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textMute, marginBottom: 12 }}>
        {'Geometry Planner'}
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: T.textSec, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 6, textTransform: 'uppercase' }}>Apex Height (ft)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            min="1"
            max={Math.floor(legFt - 0.1)}
            value={apexFtStr}
            onChange={function(e) { setApexFtStr(e.target.value); }}
            className="usmc-input"
            style={{ maxWidth: 120 }}
            placeholder={'e.g. ' + defaultApexFt}
          />
          <div style={{ color: T.textSec, fontSize: '0.78rem' }}>
            {valid ? '= ' + apexM.toFixed(2) + ' m' : ''}
          </div>
        </div>
        {!valid && apexFtStr !== '' && (
          <div style={{ color: T.warn, fontSize: '0.72rem', marginTop: 5 }}>
            {'Must be between 1 ft and ' + Math.floor(legFt) + ' ft (leg length)'}
          </div>
        )}
      </div>

      {valid && (
        <div>
          <div style={rowStyle}>
            <div style={cellStyle}>
              <div style={labelStyle}>APEX ANGLE</div>
              <div style={valStyle}>{apexAngleDeg.toFixed(1) + '°'}</div>
              <div style={{ color: T.textMute, fontSize: '0.6rem' }}>between legs</div>
            </div>
            <div style={cellStyle}>
              <div style={labelStyle}>LEG SLOPE</div>
              <div style={valStyle}>{legAngleDeg.toFixed(1) + '°'}</div>
              <div style={{ color: T.textMute, fontSize: '0.6rem' }}>from horizontal</div>
            </div>
            <div style={cellStyle}>
              <div style={labelStyle}>TAKEOFF ANGLE</div>
              <div style={valStyle}>{'~' + takeoffDeg.toFixed(0) + '°'}</div>
              <div style={{ color: T.textMute, fontSize: '0.6rem' }}>above horizon</div>
            </div>
          </div>
          <div style={rowStyle}>
            <div style={{ ...cellStyle }}>
              <div style={labelStyle}>STAKE DIST (each side)</div>
              <div style={valStyle}>{stakeFt.toFixed(1) + ' ft'}</div>
              <div style={{ color: T.textSec, fontSize: '0.78rem', marginTop: 2 }}>{stakeM.toFixed(2) + ' m'}</div>
            </div>
            <div style={{ ...cellStyle, gridColumn: 'span 2' }}>
              <div style={labelStyle}>TOTAL SPREAD (tip to tip)</div>
              <div style={valStyle}>{spreadFt.toFixed(1) + ' ft'}</div>
              <div style={{ color: T.textSec, fontSize: '0.78rem', marginTop: 2 }}>{spreadM.toFixed(2) + ' m'}</div>
            </div>
          </div>
          {status && (
            <div style={{ background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '10px 12px', fontSize: '0.78rem', color: status.color, lineHeight: 1.55, marginTop: 4 }}>
              {status.msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FREQUENCY FORECAST CARD ───────────────────────────────────────────────────
// 24-hour MUF / FOT / LUF in 4-hour Zulu blocks, so an operator can plan comm
// windows instead of only checking the current moment. Same collapsible
// pattern as the DAGR and About cards. Fully offline.
function FreqForecastCard({ results, freqStr }) {
  var [open, setOpen] = useState(false);
  var freqMHz = parseFloat(freqStr);
  var hasFreq = !isNaN(freqMHz) && freqMHz > 0;

  var blocks = null, best = null, usingDefault = true;
  if (results) {
    var now = new Date();
    blocks = frequencyForecast({
      takeoffDeg: results.directive.takeoffDeg,
      layerKm: HOP.F2.hKm,
      midLon: (results.p1.lon + results.p2.lon) / 2,
      sfi: cachedSFI(),
      freqMHz: hasFreq ? freqMHz : null,
      blockHours: 4,
      nowUtcHour: now.getUTCHours() + now.getUTCMinutes() / 60,
    });
    usingDefault = cachedSFI() === null;
    if (blocks && hasFreq) best = bestBlocks(blocks, freqMHz);
  }

  // Device offset so each Zulu block can also be shown in the operator's local time
  var offset = -new Date().getTimezoneOffset() / 60;
  function localOf(z) { return ((z + offset) % 24 + 24) % 24; }
  function hh(h) { return String(Math.floor(h)).padStart(2, '0'); }

  var SHORT = { good: 'GOOD', near_muf: 'NEAR MUF', low: 'ABSORB', above_muf: 'ABOVE MUF', below_luf: 'BELOW LUF' };
  function vColor(c) {
    return c === 'good' ? T.accent : c === 'near_muf' ? '#c8a24a'
         : c === 'low' ? '#a8a86a' : T.warn;
  }

  var cell = { fontSize: '0.78rem', fontWeight: 700, textAlign: 'center' };

  return (
    <div className="usmc-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>24-Hour Frequency Forecast</div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>
            {best && best.length
              ? 'Best window for ' + freqMHz + ' MHz: ' + hh(best[0].startZ) + '–' + hh(best[0].endZ) + 'Z'
              : 'MUF / FOT / LUF in 4-hour blocks'}
          </div>
        </div>
        <button onClick={function() { setOpen(!open); }} style={{ background: open ? T.accentDim : T.surfaceHi, color: T.textPrim, border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 16px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer', flexShrink: 0 }}>
          {open ? 'CLOSE' : 'OPEN'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {!blocks && (
            <div style={{ color: T.textMute, fontSize: '0.76rem', lineHeight: 1.5 }}>
              Enter both locations and press CALCULATE — the forecast needs the path geometry.
            </div>
          )}

          {blocks && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '86px 1fr 1fr 1fr 84px', gap: 4, padding: '0 6px 6px', color: T.textMute, fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.08em' }}>
                <div>ZULU / LOCAL</div>
                <div style={{ textAlign: 'center' }}>LUF</div>
                <div style={{ textAlign: 'center' }}>FOT</div>
                <div style={{ textAlign: 'center' }}>MUF</div>
                <div style={{ textAlign: 'right' }}>{hasFreq ? freqMHz + ' MHz' : ''}</div>
              </div>

              {blocks.map(function(b) {
                return (
                  <div key={b.startZ} style={{
                    display: 'grid', gridTemplateColumns: '86px 1fr 1fr 1fr 84px', gap: 4, alignItems: 'center',
                    background: b.isNow ? T.accentDim : T.bg,
                    border: '1px solid ' + (b.isNow ? T.accent : T.border),
                    borderRadius: 6, padding: '8px 6px', marginBottom: 5,
                  }}>
                    <div>
                      <div style={{ color: T.textPrim, fontSize: '0.74rem', fontWeight: 700 }}>
                        {hh(b.startZ) + '–' + hh(b.endZ) + 'Z'}
                      </div>
                      <div style={{ color: b.isNow ? T.accentText : T.textMute, fontSize: '0.6rem', fontWeight: b.isNow ? 700 : 400 }}>
                        {b.isNow ? 'NOW · ' : ''}{hh(localOf(b.startZ)) + '–' + hh(localOf(b.endZ)) + 'L'}
                      </div>
                    </div>
                    <div style={{ ...cell, color: T.textMute }}>{b.luf.toFixed(1)}</div>
                    <div style={{ ...cell, color: T.accentText }}>{b.fot.toFixed(1)}</div>
                    <div style={{ ...cell, color: T.textSec }}>{b.muf.toFixed(1)}</div>
                    <div style={{ textAlign: 'right' }}>
                      {b.verdict
                        ? <span style={{ color: vColor(b.verdict.code), fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.04em' }}>{SHORT[b.verdict.code]}</span>
                        : <span style={{ color: T.textDim, fontSize: '0.6rem' }}>{'aim ' + b.suggestedMHz.toFixed(1)}</span>}
                    </div>
                  </div>
                );
              })}

              {hasFreq && !best && (
                <div style={{ color: T.warn, fontSize: '0.74rem', marginTop: 8, lineHeight: 1.5 }}>
                  {freqMHz + ' MHz does not work on this path at any hour. Aim near the FOT column — request a frequency around ' + blocks[0].suggestedMHz.toFixed(1) + '–' + Math.max.apply(null, blocks.map(function(b) { return b.fot; })).toFixed(1) + ' MHz depending on the hour.'}
                </div>
              )}

              <div style={{ color: T.textDim, fontSize: '0.62rem', marginTop: 8, lineHeight: 1.45 }}>
                {'Aim at FOT. Above MUF the signal passes into space (more power will not help); below LUF it is absorbed (more power does help). Blocks evaluated at their midpoint · '
                  + (usingDefault ? 'default solar activity — connect once to refine' : 'solar activity from NOAA')
                  + ' · ±15% vs VOACAP.'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SAVED SHOTS ───────────────────────────────────────────────────────────────
// Field workflow: you plan several links in a day. Save each one, export any
// of them later as a plain-text comm card (copy to clipboard, or download as
// a .txt when the clipboard API is unavailable). All local storage — nothing
// leaves the device.
// Last-used station locations. Prefilled on next launch so a Marine working
// the same link (or the same OP) does not retype grids every time — the same
// idea as the 7.3 MHz and 3-inch leg-end defaults. Written only after a
// calculation succeeds, so the cache always holds a known-good pair.
// Cleared via "CLEAR SAVED DATA" in Saved Shots or window.HFCalc.reset().
var LOCS_KEY = 'hfcalc_locs_v1';
// Home-station default for "Your Location", in the same spirit as the 7.3 MHz
// and 3-inch leg-end defaults: MCAS Cherry Point, Havelock NC. Used until the
// operator runs a calculation from somewhere else, after which the last
// known-good pair is remembered instead.
var DEFAULT_STATION = '34.9008,-76.8806';   // MCAS Cherry Point, NC
var DEFAULT_LOC1 = DEFAULT_STATION;
var DEFAULT_LOC2 = DEFAULT_STATION;
function defaultLocs() { return { loc1: DEFAULT_LOC1, loc2: DEFAULT_LOC2 }; }
function loadCachedLocs() {
  try {
    var raw = localStorage.getItem(LOCS_KEY);
    var v = raw ? JSON.parse(raw) : null;
    return (v && typeof v.loc1 === 'string' && typeof v.loc2 === 'string') ? v : defaultLocs();
  } catch (e) { return defaultLocs(); }
}
function saveCachedLocs(loc1, loc2) {
  try { localStorage.setItem(LOCS_KEY, JSON.stringify({ loc1: loc1, loc2: loc2 })); } catch (e) {}
}
function clearCachedLocs() {
  try { localStorage.removeItem(LOCS_KEY); } catch (e) {}
}

var SHOTS_KEY = 'hfcalc_shots_v1';
var SHOTS_MAX = 25;

function loadShots() {
  try {
    var raw = localStorage.getItem(SHOTS_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function persistShots(list) {
  try { localStorage.setItem(SHOTS_KEY, JSON.stringify(list.slice(0, SHOTS_MAX))); } catch (e) {}
}

// Copy text to the clipboard, falling back to a .txt download when the
// clipboard API is missing or blocked (common in webviews / non-HTTPS).
function exportText(text, filename, onDone) {
  function download() {
    try {
      var blob = new Blob([text], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      onDone('DOWNLOADED');
    } catch (e) { onDone('EXPORT FAILED'); }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() { onDone('COPIED'); }, download);
      return;
    }
  } catch (e) { /* fall through */ }
  download();
}

function SavedShots({ currentShot, onClearStored }) {
  var [shots, setShots] = useState(loadShots);
  var [open, setOpen] = useState(false);
  var [flash, setFlash] = useState(null);

  function note(msg) {
    setFlash(msg);
    setTimeout(function() { setFlash(null); }, 1800);
  }
  function saveCurrent() {
    if (!currentShot) return;
    var next = [currentShot].concat(shots).slice(0, SHOTS_MAX);
    setShots(next); persistShots(next); setOpen(true); note('SAVED');
  }
  function doExport(shot) {
    exportText(formatCommCard(shot), commCardFilename(shot), note);
  }
  function remove(id) {
    var next = shots.filter(function(s) { return s.id !== id; });
    setShots(next); persistShots(next);
  }

  var btn = { border: '1px solid ' + T.borderHi, borderRadius: 6, padding: '6px 12px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer' };

  return (
    <div className="usmc-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.04em' }}>Saved Shots &amp; Export</div>
          <div style={{ color: T.textMute, fontSize: '0.72rem', marginTop: 2 }}>
            {shots.length ? shots.length + ' saved · export any as a comm card' : 'Save this plan, export as a comm card'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {flash && <span style={{ color: T.accentText, fontSize: '0.64rem', fontWeight: 700 }}>{flash}</span>}
          <button onClick={function() { setOpen(!open); }} style={{ ...btn, background: open ? T.accentDim : T.surfaceHi, color: T.textPrim }}>
            {open ? 'CLOSE' : 'OPEN'}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={saveCurrent} disabled={!currentShot}
              style={{ ...btn, flex: 1, minWidth: 130, padding: '10px 12px', background: currentShot ? T.accent : T.surfaceHi, color: currentShot ? '#0e1409' : T.textDim, border: 'none', opacity: currentShot ? 1 : 0.6 }}>
              SAVE CURRENT
            </button>
            <button onClick={function() { if (currentShot) doExport(currentShot); }} disabled={!currentShot}
              style={{ ...btn, flex: 1, minWidth: 130, padding: '10px 12px', background: T.surfaceHi, color: currentShot ? T.textPrim : T.textDim, opacity: currentShot ? 1 : 0.6 }}>
              EXPORT CURRENT
            </button>
          </div>
          {!currentShot && (
            <div style={{ color: T.textMute, fontSize: '0.72rem', marginBottom: 12 }}>
              Run a calculation to enable saving and exporting the current plan.
            </div>
          )}

          {shots.length === 0 && (
            <div style={{ color: T.textMute, fontSize: '0.74rem' }}>No saved shots yet.</div>
          )}

          {shots.map(function(s) {
            return (
              <div key={s.id} style={{ background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '9px 11px', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: T.textPrim, fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shotLabel(s)}
                  </div>
                  <div style={{ color: T.textMute, fontSize: '0.64rem', marginTop: 2 }}>{s.dtg}</div>
                </div>
                <button onClick={function() { doExport(s); }} style={{ ...btn, background: T.surfaceHi, color: T.textPrim, flexShrink: 0 }}>EXPORT</button>
                <button onClick={function() { remove(s.id); }} title="Delete"
                  style={{ ...btn, background: 'transparent', color: T.textDim, borderColor: T.border, padding: '6px 9px', flexShrink: 0 }}>✕</button>
              </div>
            );
          })}

          <div style={{ color: T.textDim, fontSize: '0.62rem', marginTop: 8, lineHeight: 1.45 }}>
            Stored on this device only. Export copies the comm card to the clipboard (or downloads a .txt if the clipboard is unavailable).
          </div>
          <button
            onClick={function() {
              setShots([]); persistShots([]);
              clearCachedLocs();
              if (onClearStored) onClearStored();
              note('CLEARED');
            }}
            style={{ ...btn, background: 'transparent', color: T.warn, borderColor: T.border, marginTop: 10, width: '100%', padding: '8px 0' }}>
            CLEAR SAVED DATA (SHOTS + REMEMBERED LOCATIONS)
          </button>
        </div>
      )}
    </div>
  );
}

// ── ANTENNA CARD ───────────────────────────────────────────────────────────────
function AntennaCard({ antenna, freq, wireType, wireLabel, vf, primary, distKm, legEndHeight, takeoffDeg, zone }) {
  var [stepsOpen, setStepsOpen] = useState(false);
  // vf and wireLabel are the new "core × gauge" values; fall back to legacy
  // wireType-based VF if a caller hasn't been updated yet.
  var actualVF = (typeof vf === 'number') ? vf : 0.95;
  var actualLabel = wireLabel || wireType;
  var wl = wavelength(freq, actualVF);
  var qw = wl / 4;
  var hw = wl / 2;

  // ── Auto-computed optimal apex / support height ───────────────────────────
  // The physics lives in apexHeightPlan (antennaMath.js): first-lobe height
  // for the path's takeoff angle, checked against inverted-V leg geometry.
  // The takeoff angle comes from the terrain-aware directive (per-hop,
  // obstacle-adjusted) so this box and the Antenna Directive card agree.
  // NVIS variants get an NVIS height note instead; on ground-wave paths the
  // optimizer is suppressed (height is irrelevant — keep the wire low).
  var isInvV = antenna.imageKey === 'invertedv';
  var isFlatDipole = antenna.imageKey === 'dipole';
  var isNVISType = antenna.imageKey === 'nvis_invertedv' || antenna.imageKey === 'nvis_dipole';
  var isGroundwavePath = zone === 'groundwave';
  var plan = null;
  if (typeof distKm === 'number' && isFinite(distKm) && distKm > 0 && !isGroundwavePath) {
    plan = apexHeightPlan({
      kind: isNVISType ? 'nvis' : (isInvV ? 'invertedv' : (isFlatDipole ? 'dipole' : null)),
      wlMeters: wl,
      distKm: distKm,
      legEndM: legEndHeight,
      takeoffDeg: takeoffDeg,
    });
  }
  var apexInfo = plan && plan.kind === 'apex' ? plan : null;
  var nvisInfo = plan && plan.kind === 'nvis' ? plan : null;
  var showGroundwaveNote = isGroundwavePath && (isInvV || isFlatDipole || isNVISType);
  var apexLabel = isInvV ? 'Apex height' : 'Support height';
  var apexTitle = isInvV ? 'Optimal Apex Height' : 'Optimal Support Height';

  return (
    <div style={{ background: T.surface, border: '1px solid ' + (primary ? T.borderHi : T.border), borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          {primary && <span className="usmc-chip usmc-chip-primary">PRIMARY</span>}
          <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.96rem', letterSpacing: '0.04em', flex: 1 }}>{antenna.name}</div>
        </div>
        <div style={{ color: T.textBody, fontSize: '0.84rem', lineHeight: 1.6, marginBottom: 14 }}>{antenna.description}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div style={{ background: T.bg, border: '1px solid ' + T.border, borderLeft: '3px solid ' + T.accent, borderRadius: 6, padding: '9px 12px' }}>
            <div style={{ color: T.accentText, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>PROS</div>
            <div style={{ color: T.textBody, fontSize: '0.78rem', lineHeight: 1.5 }}>{antenna.pros}</div>
          </div>
          <div style={{ background: T.bg, border: '1px solid ' + T.border, borderLeft: '3px solid ' + T.brown, borderRadius: 6, padding: '9px 12px' }}>
            <div style={{ color: T.warn, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>CONS</div>
            <div style={{ color: T.textBody, fontSize: '0.78rem', lineHeight: 1.5 }}>{antenna.cons}</div>
          </div>
        </div>

        <div style={{ color: T.textSec, fontSize: '0.78rem', lineHeight: 1.55, background: T.bg, padding: '9px 12px', borderRadius: 6, border: '1px solid ' + T.border, marginBottom: 14 }}>
          {antenna.angleNote}
        </div>

        <LengthTable label={"1/4-WAVE LEG · " + freq + " MHz · " + actualLabel} meters={qw} />
        <LengthTable label={"1/2-WAVE TOTAL · " + freq + " MHz · " + actualLabel} meters={hw} />
        <LengthTable label={"FULL WAVE · " + freq + " MHz · " + actualLabel} meters={wl} />

        {apexInfo && (
          <div style={{ marginTop: 12, background: T.bg, border: '1px solid ' + T.border, borderLeft: '3px solid ' + (apexInfo.feasible ? T.accent : T.warn), borderRadius: 6, padding: '11px 13px' }}>
            <div style={{ color: T.accentText, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase' }}>
              {apexTitle}
            </div>
            <div style={{ color: T.textBody, fontSize: '0.82rem', lineHeight: 1.7 }}>
              <div>{apexLabel + ': '}<span style={{ color: T.textPrim, fontWeight: 700 }}>{apexInfo.apexFt.toFixed(0) + ' ft (' + apexInfo.apexM.toFixed(1) + ' m)'}</span></div>
              <div>{'Each leg: '}<span style={{ color: T.textPrim, fontWeight: 700 }}>{apexInfo.legFt.toFixed(1) + ' ft (' + apexInfo.legM.toFixed(1) + ' m)'}</span></div>
              <div>{'Leg end height: '}<span style={{ color: T.textPrim, fontWeight: 700 }}>{apexInfo.endIn.toFixed(1) + ' in / ' + apexInfo.endM.toFixed(3) + ' m'}</span></div>
              <div style={{ color: T.textMute, fontSize: '0.74rem', marginTop: 3 }}>
                {'Optimized for: ' + Math.round(distKm) + ' km path, F2 '
                  + (apexInfo.hops > 1 ? apexInfo.hops + '-hop' : 'single-hop')
                  + ' (≈' + apexInfo.takeoffDeg.toFixed(0) + '° takeoff, terrain-adjusted)'}
              </div>
              {!apexInfo.feasible && (
                <div style={{ color: T.warn, fontSize: '0.74rem', marginTop: 6, lineHeight: 1.55 }}>
                  {'Radiation-optimal height is ' + apexInfo.optFt.toFixed(0) + ' ft, but ¼-wave legs with ends at '
                    + apexInfo.endIn.toFixed(1) + ' in max out at ' + apexInfo.apexFt.toFixed(0) + ' ft (legs ≤55° slope). '
                    + 'At ' + apexInfo.apexFt.toFixed(0) + ' ft the takeoff is ≈' + apexInfo.actualTakeoffDeg.toFixed(0) + '° — still usable, just higher-angle than ideal. '
                    + 'To reach ' + apexInfo.optFt.toFixed(0) + ' ft, raise the leg ends to ≈' + apexInfo.endNeededFt.toFixed(0) + ' ft (elevated inverted-V) or use a flat dipole between two supports.'}
                </div>
              )}
              {apexInfo.feasible && !apexInfo.practical && (
                <div style={{ color: T.warn, fontSize: '0.74rem', marginTop: 6, lineHeight: 1.55 }}>
                  {apexInfo.apexFt.toFixed(0) + ' ft is beyond typical field mast/tree reach. '
                    + 'If you can’t get this high, mount as high as you can — or use a sloper or EFHW from the list below, which reach low takeoff angles from lower supports.'}
                </div>
              )}
            </div>
          </div>
        )}

        {showGroundwaveNote && (
          <div style={{ marginTop: 12, background: T.bg, border: '1px solid ' + T.border, borderLeft: '3px solid ' + T.accent, borderRadius: 6, padding: '11px 13px' }}>
            <div style={{ color: T.accentText, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase' }}>
              Ground-Wave Height
            </div>
            <div style={{ color: T.textBody, fontSize: '0.82rem', lineHeight: 1.7 }}>
              <div>{'Keep the wire '}<span style={{ color: T.textPrim, fontWeight: 700 }}>3–6 ft</span>{' above ground.'}</div>
              <div style={{ color: T.textMute, fontSize: '0.74rem', marginTop: 3 }}>
                {Math.round(distKm) + ' km path is ground-wave range: the signal follows the surface, so takeoff-angle height optimization does not apply. Maximize wire length, minimize height.'}
              </div>
            </div>
          </div>
        )}

        {nvisInfo && (
          <div style={{ marginTop: 12, background: T.bg, border: '1px solid ' + T.border, borderLeft: '3px solid ' + T.accent, borderRadius: 6, padding: '11px 13px' }}>
            <div style={{ color: T.accentText, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase' }}>
              NVIS Height
            </div>
            <div style={{ color: T.textBody, fontSize: '0.82rem', lineHeight: 1.7 }}>
              <div>{'Keep center at '}<span style={{ color: T.textPrim, fontWeight: 700 }}>8–10 ft</span>{' — do not raise higher.'}</div>
              <div style={{ color: T.textMute, fontSize: '0.74rem', marginTop: 3 }}>
                {Math.round(distKm) + ' km path is NVIS range: the signal must go nearly straight up. '
                  + 'Distance-based height optimization does not apply — stay well under 0.1 λ (≈' + nvisInfo.tenthWlFt.toFixed(0) + ' ft) so vertical radiation dominates.'}
              </div>
            </div>
          </div>
        )}
      </div>

      {(antenna.imageKey === 'invertedv' || antenna.imageKey === 'nvis_invertedv') && (
        <InvVGeoCalc legMeters={qw} isNVIS={antenna.imageKey === 'nvis_invertedv'} suggestedApexFt={apexInfo ? apexInfo.apexFt : null} />
      )}

      {antenna.imageKey === 'longwire' && (
        <LongwireGeoCalc wireLenMeters={wl * 2} />
      )}

      <button onClick={function() { setStepsOpen(!stepsOpen); }} style={{ width: '100%', background: stepsOpen ? T.accentDim : 'transparent', color: stepsOpen ? T.textPrim : T.textMute, border: 'none', borderTop: '1px solid ' + T.border, padding: '12px 0', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {stepsOpen ? 'HIDE BUILD STEPS' : 'SHOW BUILD STEPS'}
      </button>

      {stepsOpen && (
        <div style={{ padding: '16px 18px 18px', borderTop: '1px solid ' + T.border }}>
          {antenna.buildSteps.map(function(step, i) {
            return (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ minWidth: 24, height: 24, background: T.accentDim, border: '1px solid ' + T.borderHi, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.accentText, fontWeight: 700, fontSize: '0.7rem', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ color: T.textBody, fontSize: '0.82rem', lineHeight: 1.65, paddingTop: 3 }}>{step}</div>
              </div>
            );
          })}
        </div>
      )}

      <ImageCarousel imageKey={antenna.imageKey} />
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function HFCalc() {
  var pwa = usePWA();
  var _cachedLocs = loadCachedLocs();
  var [loc1, setLoc1] = useState(_cachedLocs.loc1);
  var [loc2, setLoc2] = useState(_cachedLocs.loc2);
  var [freq, setFreq] = useState('7.3');
  // wireType is kept for legacy state shape compatibility, but the source of
  // truth for the new physics is (wireCore, wireGauge).
  var [wireType, setWireType] = useState('copper');
  var [wireCore, setWireCore] = useState('copper_bare');
  var [wireGauge, setWireGauge] = useState('14');
  var [customGauge, setCustomGauge] = useState(''); // user-typed AWG value
  // Leg-end height: how high the inverted-V / dipole leg ends sit above ground.
  // Stored as a raw input string + unit; the canonical value (legEndHeight, in
  // meters) is derived below and fed into the per-antenna apex-height optimizer.
  // Default 3 inches (0.0762 m).
  var [legEndStr, setLegEndStr] = useState('3');
  var [legEndUnit, setLegEndUnit] = useState('in'); // 'in' | 'ft'
  var [results, setResults] = useState(null);
  var [errors, setErrors] = useState({ loc1: '', loc2: '', freq: '' });

  // The gauge actually used: customGauge if set, otherwise the tab-selected gauge
  var effectiveGauge = customGauge.trim() !== '' ? customGauge.trim() : wireGauge;

  // Canonical leg-end height in meters (default 0.0762 m = 3 in).
  var legEndHeight = (function() {
    var v = parseFloat(legEndStr);
    if (isNaN(v) || v < 0) return 0;
    return legEndUnit === 'ft' ? v / 3.28084 : v * 0.0254;
  })();

  var parsed1 = loc1.trim() ? parseCoords(loc1) : null;
  var parsed2 = loc2.trim() ? parseCoords(loc2) : null;

  // Snapshot of the current plan in the shape SavedShots/commCard.js expect.
  // Built from the primary (first) recommended antenna — the one the operator
  // is most likely to actually build.
  var currentShot = null;
  if (results) {
    var _a = results.antennaData.antennas[0];
    var _wl = wavelength(results.freq, results.vf);
    var _kind = (_a.imageKey === 'nvis_invertedv' || _a.imageKey === 'nvis_dipole') ? 'nvis'
              : _a.imageKey === 'invertedv' ? 'invertedv'
              : _a.imageKey === 'dipole' ? 'dipole' : null;
    var _plan = (_kind && results.directive.zone !== 'groundwave')
      ? apexHeightPlan({ kind: _kind, wlMeters: _wl, distKm: results.geo.distKm,
                         legEndM: legEndHeight, takeoffDeg: results.directive.takeoffDeg })
      : null;
    var _fc = assessFrequency({
      takeoffDeg: results.directive.takeoffDeg, layerKm: HOP.F2.hKm,
      midLon: (results.p1.lon + results.p2.lon) / 2,
      utcHour: new Date().getUTCHours() + new Date().getUTCMinutes() / 60,
      sfi: cachedSFI(), freqMHz: results.freq,
    });
    currentShot = {
      id: 'shot_' + Date.now(),
      dtg: dtg(new Date()),
      p1: { lat: results.p1.lat, lon: results.p1.lon },
      p2: { lat: results.p2.lat, lon: results.p2.lon },
      distKm: results.geo.distKm, distMi: results.geo.distMi,
      bearing: results.geo.bearing, cardinal: bearingToCardinal(results.geo.bearing),
      backBearing: results.geo.backBearing, backCardinal: bearingToCardinal(results.geo.backBearing),
      freqMHz: results.freq,
      zoneName: results.antennaData.zoneName,
      takeoffDeg: results.directive.takeoffDeg,
      wireLabel: (WIRE_CORES[results.wireCore] ? WIRE_CORES[results.wireCore].short : results.wireType) + ' ' + results.wireGauge + ' AWG',
      vf: results.vf,
      legEndM: legEndHeight,
      antenna: {
        name: _a.name, key: _a.imageKey,
        legFtIn: toLengths(_wl / 4).ftIn, legM: _wl / 4,
        totalFtIn: toLengths(_wl / 2).ftIn, totalM: _wl / 2,
        apexFt: _plan && _plan.kind === 'apex' ? _plan.apexFt : null,
        apexM: _plan && _plan.kind === 'apex' ? _plan.apexM : null,
        feasible: _plan && _plan.kind === 'apex' ? _plan.feasible : null,
      },
      freqCheck: _fc ? { luf: _fc.luf, muf: _fc.muf, fot: _fc.fot,
                         verdictLabel: _fc.verdict ? _fc.verdict.label : null } : null,
      appVersion: APP_VERSION,
    };
  }

  // Tracks whether the user has run a calculation at least once. After that,
  // results recompute live (debounced) as inputs change — see the effect below.
  var hasCalculatedRef = useRef(false);
  // The AI-integration effect re-binds on every state change; this guard keeps
  // the URL-parameter import to a single application per page load so it
  // can't clobber user edits on re-binds.
  var urlAppliedRef = useRef(false);

  // Build the full results object from already-validated inputs. Shared by the
  // CALCULATE button and the live auto-recompute effect so both stay in sync.
  function buildResults(p1, p2, fMHz) {
    var geo = geodesics(p1.lat, p1.lon, p2.lat, p2.lon);
    // Compute VF from selected core + gauge using new physics
    var vf = computeVF(wireCore, effectiveGauge);
    var wl = wavelength(fMHz, vf);
    var lengths = { qw: toLengths(wl / 4), hw: toLengths(wl / 2), full: toLengths(wl) };
    var antennaData = getAntennaRecommendations(geo.distKm, fMHz, vf);
    var terrain = pathTerrainAnalysis(p1.lat, p1.lon, p2.lat, p2.lon, 32);
    var hopsForDirective = calcHops(geo.distKm, fMHz, terrain);
    var directive = antennaDirective(geo.distKm, fMHz, geo.bearing, terrain, hopsForDirective);
    return {
      geo: geo, lengths: lengths, antennaData: antennaData,
      freq: fMHz, wireType: wireType,
      wireCore: wireCore, wireGauge: effectiveGauge, vf: vf,
      p1: p1, p2: p2, terrain: terrain, directive: directive
    };
  }

  var calculate = useCallback(function() {
    var errs = { loc1: '', loc2: '', freq: '' };
    var p1 = parseCoords(loc1);
    var p2 = parseCoords(loc2);
    var fMHz = parseFloat(freq);

    if (!loc1.trim() || isNaN(p1.lat)) errs.loc1 = p1.error || 'Invalid location';
    if (!loc2.trim() || isNaN(p2.lat)) errs.loc2 = p2.error || 'Invalid location';
    if (isNaN(fMHz) || fMHz < 1 || fMHz > 30) errs.freq = 'Enter frequency 1-30 MHz';

    setErrors(errs);
    if (errs.loc1 || errs.loc2 || errs.freq) return null;

    var newResults = buildResults(p1, p2, fMHz);
    hasCalculatedRef.current = true;
    setResults(newResults);
    return newResults;
  }, [loc1, loc2, freq, wireType, wireCore, effectiveGauge]);

  // Remember the last known-good station pair (see LOCS_KEY above).
  useEffect(function() {
    if (results) saveCachedLocs(loc1, loc2);
  }, [results]);

  // Live auto-recompute: once the user has calculated once, any change to the
  // locations, frequency, or wire selection re-runs the analysis (debounced)
  // so the path, antenna picks, and optimal apex height always reflect the
  // current target — no need to press CALCULATE again. Invalid input is left
  // alone (no error flashing) and simply keeps the last good result.
  useEffect(function() {
    if (!hasCalculatedRef.current) return;
    var p1 = parseCoords(loc1);
    var p2 = parseCoords(loc2);
    var fMHz = parseFloat(freq);
    if (!loc1.trim() || isNaN(p1.lat)) return;
    if (!loc2.trim() || isNaN(p2.lat)) return;
    if (isNaN(fMHz) || fMHz < 1 || fMHz > 30) return;
    var t = setTimeout(function() {
      setResults(buildResults(p1, p2, fMHz));
    }, 250);
    return function() { clearTimeout(t); };
  }, [loc1, loc2, freq, wireType, wireCore, effectiveGauge]);

  // ── AI / EXTERNAL INTEGRATION LAYER ─────────────────────────────────────────
  // Lets external agents (Ava, Claude Code, browser-automation tools, or any
  // other AI) drive the calculator without manual user input. Three channels:
  //
  //   1. URL parameters — visit ?from=lat,lon&to=lat,lon&freq=14.2 to auto-fill
  //   2. window.HFCalc.* — JS API for browser-control agents and devtools
  //   3. window.postMessage — for AI hosts that embed the app in an iframe
  //
  // Full docs: see AI-INTEGRATION.md in the repo.
  useEffect(function() {
    if (typeof window === 'undefined') return;

    // 1. URL parameter support — applied once per page load (see urlAppliedRef)
    if (!urlAppliedRef.current) try {
      urlAppliedRef.current = true;
      var url = new URL(window.location.href);
      var qFrom = url.searchParams.get('from');
      var qTo = url.searchParams.get('to');
      var qFreq = url.searchParams.get('freq');
      var qWire = url.searchParams.get('wire');
      var qAuto = url.searchParams.get('auto');
      var didSet = false;
      if (qFrom) { setLoc1(qFrom); didSet = true; }
      if (qTo) { setLoc2(qTo); didSet = true; }
      if (qFreq) { setFreq(qFreq); didSet = true; }
      if (qWire === 'copper' || qWire === 'steel') {
        setWireType(qWire);
        if (qWire === 'copper') setWireCore('copper_bare');
        else if (qWire === 'steel') setWireCore('galvanized_steel');
        didSet = true;
      }
      var qCore = url.searchParams.get('core');
      if (qCore && WIRE_CORES[qCore]) { setWireCore(qCore); didSet = true; }
      var qGauge = url.searchParams.get('gauge');
      if (qGauge) {
        if (WIRE_GAUGES[qGauge]) { setWireGauge(qGauge); setCustomGauge(''); didSet = true; }
        else if (!isNaN(parseFloat(qGauge))) { setCustomGauge(qGauge); didSet = true; }
      }
      // ?legend=3 | 3in | 0.5ft | 0.08m — leg end height (bare number = inches)
      var qLegEnd = url.searchParams.get('legend');
      if (qLegEnd) {
        var lm = String(qLegEnd).trim().match(/^([\d.]+)\s*(in|ft|m)?$/i);
        if (lm && !isNaN(parseFloat(lm[1]))) {
          var lu = (lm[2] || 'in').toLowerCase();
          if (lu === 'm') { setLegEndStr(String(parseFloat(lm[1]) * 3.28084)); setLegEndUnit('ft'); }
          else { setLegEndStr(lm[1]); setLegEndUnit(lu); }
          didSet = true;
        }
      }
      // ?auto=1 (or omitted with both from+to+freq) auto-runs calculate:
      // marking the session as "has calculated" lets the live-recompute effect
      // produce results as soon as the state set above flushes — no DOM poking.
      if (didSet && qFrom && qTo && qFreq && qAuto !== '0') {
        hasCalculatedRef.current = true;
      }
    } catch (e) { /* malformed URL, ignore */ }

    // 2. window.HFCalc.* — programmatic API
    var api = {
      version: APP_VERSION,
      author: AUTHOR_LINE,
      signature: APP_SIGNATURE,

      // Set inputs without auto-calculating
      setFromLocation: function(value) { setLoc1(String(value || '')); },
      setToLocation: function(value) { setLoc2(String(value || '')); },
      setFrequency: function(value) { setFreq(String(value)); },
      setWireType: function(value) {
        // Legacy: 'copper'/'steel' still work
        if (value === 'copper' || value === 'steel') {
          setWireType(value);
          if (value === 'copper') setWireCore('copper_bare');
          else if (value === 'steel') setWireCore('galvanized_steel');
        }
      },
      setWireCore: function(value) {
        if (WIRE_CORES[value]) setWireCore(value);
      },
      setWireGauge: function(value) {
        // Accept either a gauge from WIRE_GAUGES or a custom number
        if (WIRE_GAUGES[String(value)]) {
          setWireGauge(String(value));
          setCustomGauge('');
        } else if (!isNaN(parseFloat(value))) {
          setCustomGauge(String(value));
        }
      },
      setLegEndHeight: function(value, unit) {
        // unit: 'in' (default) | 'ft' | 'm'
        var v = parseFloat(value);
        if (isNaN(v) || v < 0) return;
        var u = String(unit || 'in').toLowerCase();
        if (u === 'm') { setLegEndStr(String(v * 3.28084)); setLegEndUnit('ft'); }
        else if (u === 'ft') { setLegEndStr(String(v)); setLegEndUnit('ft'); }
        else { setLegEndStr(String(v)); setLegEndUnit('in'); }
      },

      // Read current state and results
      getInputs: function() {
        return {
          from: loc1, to: loc2, freq: freq,
          wireType: wireType,
          wireCore: wireCore,
          wireGauge: effectiveGauge,
          velocityFactor: computeVF(wireCore, effectiveGauge),
          legEndHeightM: legEndHeight,
        };
      },
      getResults: function() {
        // Returns a JSON-safe snapshot of the latest calculation, or null
        if (!results) return null;
        return JSON.parse(JSON.stringify({
          distance: { km: results.geo.distKm, mi: results.geo.distMi },
          bearing: { deg: results.geo.bearing, cardinal: bearingToCardinal(results.geo.bearing) },
          frequency_mhz: results.freq,
          wire_type: results.wireType,
          wire_core: results.wireCore,
          wire_core_label: WIRE_CORES[results.wireCore] ? WIRE_CORES[results.wireCore].label : results.wireCore,
          wire_gauge_awg: results.wireGauge,
          velocity_factor: results.vf,
          zone: results.antennaData.zone,
          zone_label: results.antennaData.zoneName,
          propagation_note: results.antennaData.propagationNote,
          directive: {
            takeoff_deg: results.directive.takeoffDeg,
            antenna_type: results.directive.antennaType,
            point_toward: results.directive.bearing,
            cardinal: results.directive.cardinal,
            geometry: results.directive.physGeometry,
            why_this_angle: results.directive.whyAngle,
            path_summary: results.directive.pathSummary,
            chordal_hop_possible: !!results.directive.chordal,
          },
          leg_end_height_m: legEndHeight,
          recommended_antennas: results.antennaData.antennas.map(function(a) {
            // Same computation the antenna cards display (see apexHeightPlan)
            var kind = (a.imageKey === 'nvis_invertedv' || a.imageKey === 'nvis_dipole') ? 'nvis'
                     : a.imageKey === 'invertedv' ? 'invertedv'
                     : a.imageKey === 'dipole' ? 'dipole' : null;
            var plan = (kind && results.directive.zone !== 'groundwave')
              ? apexHeightPlan({
                  kind: kind,
                  wlMeters: wavelength(results.freq, results.vf),
                  distKm: results.geo.distKm,
                  legEndM: legEndHeight,
                  takeoffDeg: results.directive.takeoffDeg,
                })
              : null;
            return { key: a.imageKey, name: a.name, height: a.height, height_plan: plan };
          }),
          terrain: {
            ocean_pct: Math.round((results.terrain.oceanFrac || 0) * 100),
            land_pct: Math.round((results.terrain.landFrac || 0) * 100),
            mountain_pct: Math.round((results.terrain.mountainFrac || 0) * 100),
            desert_pct: Math.round((results.terrain.desertFrac || 0) * 100),
            named_oceans: results.terrain.namedBodies || [],
            named_mountains: results.terrain.namedMountains || [],
          },
        }));
      },

      // High-level: do everything in one call. Returns a Promise so callers
      // can await results without polling.
      calculate: function(opts) {
        opts = opts || {};
        return new Promise(function(resolve, reject) {
          if (opts.from) setLoc1(String(opts.from));
          if (opts.to) setLoc2(String(opts.to));
          if (opts.freq != null) setFreq(String(opts.freq));
          if (opts.wireType === 'copper' || opts.wireType === 'steel') {
            setWireType(opts.wireType);
            if (opts.wireType === 'copper') setWireCore('copper_bare');
            else if (opts.wireType === 'steel') setWireCore('galvanized_steel');
          }
          if (opts.wireCore && WIRE_CORES[opts.wireCore]) {
            setWireCore(opts.wireCore);
          }
          if (opts.wireGauge != null) {
            var g = String(opts.wireGauge);
            if (WIRE_GAUGES[g]) {
              setWireGauge(g);
              setCustomGauge('');
            } else if (!isNaN(parseFloat(g))) {
              setCustomGauge(g);
            }
          }
          // Wait for state to flush, then click CALCULATE, then poll for results
          setTimeout(function() {
            var btns = document.querySelectorAll('button');
            var clicked = false;
            for (var i = 0; i < btns.length; i++) {
              if (btns[i].textContent && btns[i].textContent.trim() === 'CALCULATE') {
                btns[i].click();
                clicked = true;
                break;
              }
            }
            if (!clicked) { reject(new Error('Calculate button not found')); return; }
            // Poll up to 1s for results to populate
            var tries = 0;
            var poll = setInterval(function() {
              tries++;
              if (window.HFCalc && window.HFCalc.getResults && window.HFCalc.getResults()) {
                clearInterval(poll);
                resolve(window.HFCalc.getResults());
              } else if (tries > 20) {
                clearInterval(poll);
                reject(new Error('Calculation did not produce results — check inputs'));
              }
            }, 50);
          }, 60);
        });
      },

      // Reset all inputs and results
      reset: function() {
        setLoc1(DEFAULT_LOC1); setLoc2(DEFAULT_LOC2); setFreq('7.3'); setWireType('copper');
        setWireCore('copper_bare'); setWireGauge('14'); setCustomGauge('');
        setLegEndStr('3'); setLegEndUnit('in');
        setResults(null); setErrors({ loc1: '', loc2: '', freq: '' });
        hasCalculatedRef.current = false;
        clearCachedLocs();
      },
    };

    try {
      window.HFCalc = api;
    } catch (e) { /* sealed window? skip */ }

    // 3. postMessage listener — for hosts that embed the app in an iframe.
    // Schema: { type: 'hfcalc:request', id: '...', method: 'calculate', params: {...} }
    // Response: { type: 'hfcalc:response', id: '...', ok: true, result: {...} } | error
    function onMessage(ev) {
      var data = ev.data;
      if (!data || typeof data !== 'object' || data.type !== 'hfcalc:request') return;
      var reqId = data.id || null;
      var method = data.method;
      var params = data.params || {};

      function reply(ok, payload) {
        var msg = {
          type: 'hfcalc:response',
          id: reqId,
          ok: ok,
        };
        if (ok) msg.result = payload; else msg.error = String(payload);
        try {
          if (ev.source && ev.source.postMessage) {
            ev.source.postMessage(msg, '*');
          } else if (window.parent && window.parent !== window) {
            window.parent.postMessage(msg, '*');
          }
        } catch (e) { /* swallow */ }
      }

      try {
        if (method === 'calculate') {
          api.calculate(params).then(function(r) { reply(true, r); }, function(e) { reply(false, e.message || String(e)); });
        } else if (method === 'getResults') {
          reply(true, api.getResults());
        } else if (method === 'getInputs') {
          reply(true, api.getInputs());
        } else if (method === 'reset') {
          api.reset(); reply(true, { reset: true });
        } else if (method === 'setFromLocation') {
          api.setFromLocation(params.value); reply(true, { set: 'from' });
        } else if (method === 'setToLocation') {
          api.setToLocation(params.value); reply(true, { set: 'to' });
        } else if (method === 'setLegEndHeight') {
          api.setLegEndHeight(params.value, params.unit); reply(true, { set: 'legEndHeight' });
        } else if (method === 'ping') {
          reply(true, { pong: true, version: api.version, author: api.author, signature: api.signature });
        } else {
          reply(false, 'Unknown method: ' + method);
        }
      } catch (e) {
        reply(false, e.message || String(e));
      }
    }
    window.addEventListener('message', onMessage);

    // Announce readiness — useful when the AI is waiting to connect
    try {
      window.dispatchEvent(new CustomEvent('hfcalc:ready', {
        detail: { version: api.version, author: api.author, signature: api.signature }
      }));
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'hfcalc:ready', version: api.version, signature: api.signature }, '*');
      }
    } catch (e) { /* noop */ }

    return function cleanup() {
      window.removeEventListener('message', onMessage);
      try { delete window.HFCalc; } catch (e) {}
    };
  // Re-bind whenever any state setter or calculation context changes so the
  // API closure always reflects the freshest state.
  }, [loc1, loc2, freq, wireType, wireCore, effectiveGauge, results, legEndHeight]);

  return (
    <div style={{ background: T.bg, minHeight: '100vh', padding: '0 0 calc(60px + env(safe-area-inset-bottom)) 0' }}>
      <USMCStyleInjector />

      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(8,12,7,0.97)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderBottom: '1px solid #1f2e17',
        // viewport-fit=cover + a black-translucent status bar let the page run
        // under the iOS clock/battery, which printed them on top of the title.
        // Reserve the notch inset (0 on devices that have none).
        paddingTop: 'calc(14px + env(safe-area-inset-top))',
        paddingBottom: 14,
        paddingLeft: 'calc(20px + env(safe-area-inset-left))',
        paddingRight: 'calc(20px + env(safe-area-inset-right))' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '1rem', letterSpacing: '0.06em', lineHeight: 1.2 }}>HF FIELD ANTENNA CALC</div>
            <div style={{ color: T.accentText, fontSize: '0.62rem', letterSpacing: '0.1em', marginTop: 3, fontWeight: 600 }}>MADE BY {AUTHOR_NAME.toUpperCase()}</div>
            <div style={{ color: T.textMute, fontSize: '0.58rem', letterSpacing: '0.12em', marginTop: 1 }}>{AUTHOR_BRANCH} &nbsp;&middot;&nbsp; FIELD EXPEDIENT &nbsp;&middot;&nbsp; OFFLINE &nbsp;&middot;&nbsp; {'V' + APP_VERSION}</div>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 8, overflow: 'hidden', border: '1px solid #2e4422', flexShrink: 0 }}>
            <img src={ICON_192} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '20px 16px 0 16px' }}>

        <UpdateBanner />
        <InstallBanner pwa={pwa} />
        <AboutBanner />
        <DAGRInstructions />
        <FreqForecastCard results={results} freqStr={freq} />
        <SavedShots currentShot={currentShot} onClearStored={function() { setLoc1(DEFAULT_LOC1); setLoc2(DEFAULT_LOC2); }} />

        <div style={{ background: '#2a1410', border: '1px solid #7a3428', borderLeft: '4px solid #c4442e', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ color: '#ff9b86', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', marginBottom: 5 }}>
            ⚠ COMSEC WARNING
          </div>
          <div style={{ color: '#ffd9d0', fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.5 }}>
            NEVER photograph a DAGR with crypto loaded.
          </div>
          <div style={{ color: '#e0b5ab', fontSize: '0.76rem', lineHeight: 1.55, marginTop: 4 }}>
            A photo of a keyed device is a reportable COMSEC incident. Zeroize first, use an unkeyed receiver, or read the grid off the screen and type it in by hand.
          </div>
        </div>

        <div className="usmc-card" style={{ marginBottom: 16 }}>
          <div className="usmc-section-label">YOUR STATION</div>
          <LocationInput
            label="Your Location"
            value={loc1}
            onChange={setLoc1}
            parsed={parsed1}
            error={errors.loc1}
          />
        </div>

        <div className="usmc-card" style={{ marginBottom: 16 }}>
          <div className="usmc-section-label">TARGET STATION</div>
          <LocationInput
            label="Target Location"
            value={loc2}
            onChange={setLoc2}
            parsed={parsed2}
            error={errors.loc2}
          />
        </div>

        <div className="usmc-card" style={{ marginBottom: 16 }}>
          <div className="usmc-section-label">ANTENNA SETTINGS</div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ color: T.textSec, fontWeight: 600, fontSize: '0.72rem', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Frequency (MHz)</label>
            <input
              className={'usmc-input' + (errors.freq ? ' usmc-input-error' : '')}
              type="number"
              min="1"
              max="30"
              step="0.01"
              value={freq}
              onChange={function(e) { setFreq(e.target.value); }}
              placeholder="e.g. 7.3"
            />
            {errors.freq && <div style={{ color: T.warn, fontSize: '0.72rem', marginTop: 5 }}>{errors.freq}</div>}

            <FreqCheckPanel results={results} freqStr={freq} />
          </div>

          <div>
            <label style={{ color: T.textSec, fontWeight: 600, fontSize: '0.72rem', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Wire Core</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 12 }}>
              {Object.keys(WIRE_CORES).map(function(coreKey) {
                var core = WIRE_CORES[coreKey];
                var active = wireCore === coreKey;
                var qualityColor = core.quality === 'excellent' ? T.accent
                                 : core.quality === 'good' ? '#b3c47e'
                                 : core.quality === 'fair' ? '#c87c3a'
                                 : '#9a4a3a';
                return (
                  <button key={coreKey} onClick={function() {
                    setWireCore(coreKey);
                    // Sync legacy wireType for backward compat
                    if (coreKey === 'copper_bare' || coreKey === 'copper_stranded' || coreKey === 'copper_insulated' || coreKey === 'copper_clad_steel') setWireType('copper');
                    else setWireType('steel');
                  }} style={{ padding: '8px 6px', background: active ? T.accentDim : T.bg, color: active ? T.textPrim : T.textMute, border: active ? '1.5px solid ' + T.accent : '1.5px solid ' + T.border, borderRadius: 6, fontWeight: 600, fontSize: '0.72rem', textAlign: 'left', lineHeight: 1.25, cursor: 'pointer' }}>
                    <div style={{ fontWeight: 700, letterSpacing: '0.04em', fontSize: '0.7rem' }}>{core.short}</div>
                    <div style={{ fontSize: '0.6rem', fontWeight: 500, marginTop: 3, color: active ? T.accentText : T.textDim, display: 'flex', justifyContent: 'space-between' }}>
                      <span>VF {core.vf_base}</span>
                      <span style={{ color: qualityColor, fontWeight: 700, textTransform: 'uppercase' }}>{core.quality}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Per-core help line */}
            <div style={{ fontSize: '0.65rem', color: T.textMute, lineHeight: 1.45, marginBottom: 14, padding: '8px 10px', background: T.bg, borderRadius: 5, border: '1px solid ' + T.border }}>
              {WIRE_CORES[wireCore] ? WIRE_CORES[wireCore].note : ''}
            </div>

            <label style={{ color: T.textSec, fontWeight: 600, fontSize: '0.72rem', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Wire Gauge (AWG)</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 8 }}>
              {Object.keys(WIRE_GAUGES).map(function(g) {
                var active = wireGauge === g && customGauge.trim() === '';
                return (
                  <button key={g} onClick={function() { setWireGauge(g); setCustomGauge(''); }} style={{ padding: '7px 0', background: active ? T.accentDim : T.bg, color: active ? T.textPrim : T.textMute, border: active ? '1.5px solid ' + T.accent : '1.5px solid ' + T.border, borderRadius: 5, fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}>
                    {g}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input
                type="number"
                placeholder="Custom AWG"
                value={customGauge}
                onChange={function(e) { setCustomGauge(e.target.value); }}
                style={{ flex: 1, padding: '8px 10px', background: T.bg, color: T.textPrim, border: '1.5px solid ' + (customGauge.trim() !== '' ? T.accent : T.border), borderRadius: 5, fontSize: '0.78rem' }}
                min="2"
                max="40"
                step="1"
              />
              <div style={{ color: T.textMute, fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
                {WIRE_GAUGES[effectiveGauge] ? WIRE_GAUGES[effectiveGauge].label : effectiveGauge + ' AWG'}
              </div>
            </div>
            {WIRE_GAUGES[effectiveGauge] && (
              <div style={{ fontSize: '0.65rem', color: T.textMute, fontStyle: 'italic' }}>
                {WIRE_GAUGES[effectiveGauge].strength} · ⌀ {WIRE_GAUGES[effectiveGauge].dia_mm.toFixed(2)} mm
              </div>
            )}
            <div style={{ fontSize: '0.66rem', color: T.accentText, marginTop: 8, fontWeight: 600 }}>
              Effective Velocity Factor: {computeVF(wireCore, effectiveGauge).toFixed(3)}
            </div>
          </div>

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid ' + T.border }}>
            <label style={{ color: T.textSec, fontWeight: 600, fontSize: '0.72rem', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Leg End Height</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="usmc-input"
                type="number"
                min="0"
                step="0.5"
                value={legEndStr}
                onChange={function(e) { setLegEndStr(e.target.value); }}
                placeholder="3"
                style={{ flex: 1 }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                {['in', 'ft'].map(function(u) {
                  var active = legEndUnit === u;
                  return (
                    <button key={u} onClick={function() { setLegEndUnit(u); }} style={{ padding: '8px 12px', background: active ? T.accentDim : T.bg, color: active ? T.textPrim : T.textMute, border: active ? '1.5px solid ' + T.accent : '1.5px solid ' + T.border, borderRadius: 5, fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', cursor: 'pointer' }}>
                      {u}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ fontSize: '0.65rem', color: T.textMute, marginTop: 6, lineHeight: 1.45 }}>
              {'= ' + legEndHeight.toFixed(3) + ' m · height of inverted-V / dipole leg ends above ground. Used to compute the optimal apex height for each antenna below.'}
            </div>
          </div>
        </div>

        <button
          onClick={calculate}
          style={{ width: '100%', background: 'linear-gradient(135deg, #3d7a32 0%, #5a9e4b 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '15px 0', fontWeight: 700, fontSize: '0.92rem', letterSpacing: '0.1em', marginBottom: 24, boxShadow: '0 2px 16px rgba(90,158,75,0.25)' }}
        >
          CALCULATE
        </button>

        {results && (
          <div>
            <div className="usmc-card" style={{ marginBottom: 14 }}>
              <div className="usmc-section-label">Link Analysis</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div className="usmc-stat">
                  <div className="usmc-stat-label">Distance</div>
                  <div className="usmc-stat-val">{results.geo.distKm.toFixed(1) + ' km'}</div>
                  <div className="usmc-stat-sub">{results.geo.distMi.toFixed(1) + ' mi'}</div>
                </div>
                <div className="usmc-stat">
                  <div className="usmc-stat-label">Bearing To Target</div>
                  <div className="usmc-stat-val">{results.geo.bearing.toFixed(1) + '°'}</div>
                  <div className="usmc-stat-sub">{bearingToCardinal(results.geo.bearing) + ' · from your station'}</div>
                  <div style={{ color: T.textMute, fontSize: '0.62rem', marginTop: 4, borderTop: '1px solid ' + T.border, paddingTop: 4 }}>
                    {'Back az ' + results.geo.backBearing.toFixed(1) + '° ' + bearingToCardinal(results.geo.backBearing) + ' (target aims here)'}
                  </div>
                </div>
              </div>
              <hr className="usmc-divider" style={{ margin: '0 0 14px 0' }} />
              <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', color: T.textMute, marginBottom: 12, textTransform: 'uppercase' }}>
                {'Wire Lengths · ' + results.freq + ' MHz · ' + (WIRE_CORES[results.wireCore] ? WIRE_CORES[results.wireCore].short : results.wireType) + ' ' + results.wireGauge + ' AWG · VF ' + results.vf.toFixed(3)}
              </div>
              {[
                { label: '1/4 Wave  Leg', m: wavelength(results.freq, results.vf) / 4 },
                { label: '1/2 Wave  Dipole Total', m: wavelength(results.freq, results.vf) / 2 },
                { label: 'Full Wave', m: wavelength(results.freq, results.vf) },
              ].map(function(row) {
                var l = toLengths(row.m);
                return (
                  <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '108px 1fr 1fr', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <div style={{ color: T.textSec, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.04em' }}>{row.label}</div>
                    <div className="usmc-stat" style={{ padding: '7px 10px' }}>
                      <div className="usmc-stat-label">Feet / Inches</div>
                      <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.88rem' }}>{l.ftIn}</div>
                    </div>
                    <div className="usmc-stat" style={{ padding: '7px 10px' }}>
                      <div className="usmc-stat-label">Meters</div>
                      <div style={{ color: T.textPrim, fontWeight: 700, fontSize: '0.88rem' }}>{l.m + ' m'}</div>
                    </div>
                  </div>
                );
              })}
            </div>



            <div className="usmc-card" style={{ marginBottom: 14, borderLeft: '3px solid ' + T.warn }}>
              <div className="usmc-section-label" style={{ color: T.warn }}>Propagation Mode</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ background: T.accentDim, border: '1px solid ' + T.accent, borderRadius: 5, padding: '5px 11px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', color: T.textPrim }}>
                  {results.antennaData.zoneName}
                </div>
              </div>
              <div style={{ color: T.textBody, fontSize: '0.84rem', lineHeight: 1.6 }}>
                {results.antennaData.propagationNote}
              </div>
            </div>

            <SpaceWxCard freqMHz={results.freq} zone={results.directive.zone} />

            <AntennaDirectiveCard directive={results.directive} />

            <HopDiagram distKm={results.geo.distKm} freqMHz={results.freq} lat1={results.p1.lat} lon1={results.p1.lon} lat2={results.p2.lat} lon2={results.p2.lon} />

            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textMute, marginBottom: 12, paddingLeft: 2 }}>Recommended Antennas</div>

            {results.antennaData.antennas.map(function(antenna, i) {
              return (
                <AntennaCard
                  key={antenna.name}
                  antenna={antenna}
                  freq={results.freq}
                  wireType={results.wireType}
                  wireLabel={(WIRE_CORES[results.wireCore] ? WIRE_CORES[results.wireCore].short : results.wireType) + ' ' + results.wireGauge + ' AWG'}
                  vf={results.vf}
                  primary={i === 0}
                  distKm={results.geo.distKm}
                  legEndHeight={legEndHeight}
                  takeoffDeg={results.directive.takeoffDeg}
                  zone={results.directive.zone}
                />
              );
            })}

            <div style={{ color: T.textDim, fontSize: '0.68rem', textAlign: 'center', marginTop: 12, letterSpacing: '0.04em' }}>
              Wire lengths use velocity factor {results.vf.toFixed(3)} ({WIRE_CORES[results.wireCore] ? WIRE_CORES[results.wireCore].label : results.wireType}, {results.wireGauge} AWG). Trim to best SWR.
            </div>
          </div>
        )}

      </div>

      {/* Persistent footer attribution — visible whether or not results are shown */}
      <div style={{ maxWidth: 520, margin: '32px auto 0', padding: '20px 16px 16px', borderTop: '1px solid ' + T.border, textAlign: 'center' }}>
        <div style={{ color: T.accentText, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>
          MADE BY {AUTHOR_NAME.toUpperCase()}
        </div>
        <div style={{ color: T.textMute, fontSize: '0.62rem', letterSpacing: '0.1em', marginBottom: 6 }}>
          {AUTHOR_BRANCH} &nbsp;&middot;&nbsp; ORIGINAL WORK &nbsp;&middot;&nbsp; CC BY-NC-ND 4.0
        </div>
        <div style={{ color: T.textDim, fontSize: '0.58rem', letterSpacing: '0.06em' }}>
          {APP_SIGNATURE}
        </div>
        <div style={{ color: T.textMute, fontSize: '0.62rem', letterSpacing: '0.1em', marginTop: 6, fontWeight: 600 }}>
          {'v' + APP_VERSION}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// build: hf-calc-rebuild-offline-v1
//
// HF Field Antenna Calculator
// Original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC
// Project signature: HFCALC-AG-EZK-USMC-v1
// Released under CC BY-NC-ND 4.0
//
// This source contains the author's full work product including original
// calculation logic, terrain modeling, antenna selection rules, and visual
// design. Removing or altering attribution notices does not transfer
// ownership of this work.
// ─────────────────────────────────────────────────────────────────────────────
