// ── SPACE WEATHER (NOAA SWPC) ─────────────────────────────────────────────────
// Optional live solar/geomagnetic conditions from NOAA's Space Weather
// Prediction Center. Advisory layer ONLY: every core calculation in the app
// works without this — offline operation is never degraded. Pure parsing and
// interpretation live here so they can be unit-tested; fetching/caching is
// done by the SpaceWxCard component in HFCalc.jsx.
//
// Products used (public, no key):
//   https://services.swpc.noaa.gov/products/summary/10cm-flux.json
//     → { "Flux": "142", "TimeStamp": "..." }
//   https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json
//     → [["time_tag","Kp","a_running","station_count"], ["…","2.33",…], …]
// Parsers below tolerate both object and table shapes defensively.
//
// Interpretation thresholds follow standard HF operating conventions:
// solar flux (SFI) bands per common amateur/military band-conditions
// guidance; Kp bands per the NOAA G-scale (G1 minor storm begins at Kp 5).
//
// This module is part of the original work of Cpl Angeles-Gonzalez,
// Ezekiel S., USMC. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────

export const SWPC_FLUX_URL = 'https://services.swpc.noaa.gov/products/summary/10cm-flux.json';
export const SWPC_KINDEX_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';

// Parse the 10.7 cm solar flux payload → { sfi, time } or null.
export function parseFluxPayload(json) {
  if (!json) return null;
  // Object form: { Flux: "142", TimeStamp: "…" } (key casing varies)
  if (!Array.isArray(json) && typeof json === 'object') {
    var key = Object.keys(json).find(function(k) { return k.toLowerCase() === 'flux'; });
    if (key) {
      var v = parseFloat(json[key]);
      if (isFinite(v) && v > 0) {
        var tkey = Object.keys(json).find(function(k) { return k.toLowerCase().indexOf('time') !== -1; });
        return { sfi: v, time: tkey ? String(json[tkey]) : null };
      }
    }
    return null;
  }
  // Table form: header row + data rows, flux in some column
  if (Array.isArray(json) && json.length >= 2 && Array.isArray(json[0])) {
    var header = json[0].map(function(h) { return String(h).toLowerCase(); });
    var fi = header.findIndex(function(h) { return h.indexOf('flux') !== -1; });
    var ti = header.findIndex(function(h) { return h.indexOf('time') !== -1; });
    if (fi === -1) return null;
    var last = json[json.length - 1];
    var v2 = parseFloat(last[fi]);
    if (!isFinite(v2) || v2 <= 0) return null;
    return { sfi: v2, time: ti === -1 ? null : String(last[ti]) };
  }
  return null;
}

// Parse the planetary K-index payload → { kp, time } or null.
export function parseKIndexPayload(json) {
  if (!json) return null;
  if (Array.isArray(json) && json.length >= 2 && Array.isArray(json[0])) {
    var header = json[0].map(function(h) { return String(h).toLowerCase(); });
    var ki = header.findIndex(function(h) { return h === 'kp' || h.indexOf('kp') === 0; });
    var ti = header.findIndex(function(h) { return h.indexOf('time') !== -1; });
    if (ki === -1) return null;
    var last = json[json.length - 1];
    var v = parseFloat(last[ki]);
    if (!isFinite(v) || v < 0) return null;
    return { kp: v, time: ti === -1 ? null : String(last[ti]) };
  }
  // Array-of-objects form: [{ time_tag, kp_index | estimated_kp }, …]
  if (Array.isArray(json) && json.length > 0 && typeof json[json.length - 1] === 'object') {
    var o = json[json.length - 1];
    var kk = Object.keys(o).find(function(k) { return k.toLowerCase().indexOf('kp') !== -1; });
    if (!kk) return null;
    var v2 = parseFloat(o[kk]);
    if (!isFinite(v2) || v2 < 0) return null;
    var tk = Object.keys(o).find(function(k) { return k.toLowerCase().indexOf('time') !== -1; });
    return { kp: v2, time: tk ? String(o[tk]) : null };
  }
  return null;
}

// 10.7 cm solar flux → operating interpretation.
export function interpretSFI(sfi) {
  if (sfi < 70)  return { label: 'VERY LOW',  note: 'Only lower bands reliable (2–10 MHz). 14 MHz marginal, above that mostly closed.' };
  if (sfi < 90)  return { label: 'LOW',       note: 'Lower bands solid; 14 MHz usable daytime; 18+ MHz unreliable.' };
  if (sfi < 120) return { label: 'MODERATE',  note: '14–18 MHz good daytime; 21 MHz opens on better days.' };
  if (sfi < 150) return { label: 'HIGH',      note: '14–24 MHz strong daytime; 28 MHz possible on DX paths.' };
  return         { label: 'VERY HIGH', note: 'All HF bands workable; 21–28 MHz open for long DX with low power.' };
}

// Planetary K-index → geomagnetic interpretation (NOAA G-scale aligned).
export function interpretKp(kp) {
  if (kp < 3)  return { label: 'QUIET',       degraded: false, note: 'Geomagnetic field quiet — normal HF conditions.' };
  if (kp < 5)  return { label: 'UNSETTLED',   degraded: false, note: 'Some fading/flutter possible, high-latitude paths first.' };
  if (kp < 7)  return { label: 'STORM (G1–G2)', degraded: true, note: 'HF degraded — absorption and fading, worst on polar/high-latitude paths.' };
  return       { label: 'SEVERE STORM',       degraded: true, note: 'Expect HF blackouts at high latitudes; even mid-latitude paths unreliable.' };
}

// Path-specific advisories, given current conditions + the user's calc.
// Returns an array of plain-language advisory strings (possibly empty).
export function spaceWxAdvice(params) {
  var sfi = params.sfi, kp = params.kp;
  var freqMHz = params.freqMHz, zone = params.zone;
  var advice = [];
  if (typeof kp === 'number' && kp >= 5) {
    advice.push('Geomagnetic storm in progress (Kp ' + kp.toFixed(1) + '): expect absorption and fading. NVIS and lower frequencies are the most resilient; avoid transpolar routing.');
  }
  var skywave = zone === 'singlehop' || zone === 'mediumdx' || zone === 'longdx';
  if (typeof sfi === 'number' && typeof freqMHz === 'number' && skywave) {
    if (sfi < 80 && freqMHz >= 18) {
      advice.push('Solar flux is low (SFI ' + Math.round(sfi) + '): ' + freqMHz + ' MHz may be above the usable MUF on this path outside midday. Keep a 7–14 MHz fallback antenna ready.');
    } else if (sfi >= 120 && freqMHz < 10) {
      advice.push('Solar flux is elevated (SFI ' + Math.round(sfi) + '): higher bands (14–21+ MHz) are likely open on this path in daylight — a higher band means a shorter antenna and lower absorption loss.');
    }
  }
  if (typeof sfi === 'number' && typeof freqMHz === 'number' && zone === 'nvis' && sfi < 75 && freqMHz > 8) {
    advice.push('Low solar flux lowers the critical frequency: ' + freqMHz + ' MHz may punch through the ionosphere instead of reflecting for NVIS, especially at night. 2–8 MHz is the safer NVIS window right now.');
  }
  return advice;
}
