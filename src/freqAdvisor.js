// ── FREQUENCY ADVISOR ─────────────────────────────────────────────────────────
// Estimates whether a given frequency will actually work on a given path at a
// given time — MUF / FOT / LUF, computed entirely offline.
//
// Design note: units are normally ASSIGNED their frequencies (SOI/JCEOI), so
// this is deliberately a CHECK, not a picker. The primary output is a verdict
// on the frequency the operator was told to use, with a suggested alternative
// to request if the assigned one will not propagate.
//
// ── Physics ──────────────────────────────────────────────────────────────────
// 1. Solar activity → critical frequency foF2 (the highest frequency that
//    reflects at VERTICAL incidence). Rises with the solar cycle and peaks in
//    the early afternoon local solar time:
//       foF2_noon  = 6.8 + 0.036 * SSN   (MHz, mid-latitude)
//       foF2_night = 0.45 * foF2_noon
//       foF2(t)    = night + (noon - night) * diurnal(t)
//    Coefficients calibrated against VOACAP MUF output over 288 hourly
//    samples (3 path lengths x 2 seasons x 2 solar levels) — see
//    docs/VALIDATION.md. The resulting foF2 range (7.2 MHz noon at solar
//    minimum to 12.2 at solar maximum; 3.2-5.5 at night) sits inside
//    published mid-latitude ionosonde values, so the fit stays physical.
//
// 2. Oblique incidence raises the usable frequency by the secant law. With
//    Earth curvature, the incidence angle φ at the layer for takeoff angle α:
//       sin φ = R * cos α / (R + h)
//       MUF   = foF2 / cos φ
//    Reduces to MUF = foF2 at vertical incidence (NVIS, α = 90°) and gives the
//    classic ~3.0-3.5x factor at low angles. This reuses the same curved-earth
//    takeoff angle already validated against VOACAP (docs/VALIDATION.md).
//
// 3. FOT (Frequency of Optimum Traffic) = 0.85 * MUF — the standard planning
//    figure: high enough for low absorption, low enough to survive normal
//    ionospheric variation.
//
// 4. LUF (Lowest Usable Frequency) is set by D-layer absorption, which tracks
//    daylight. Approximated for typical manpack power (~20 W):
//       LUF = 2.0 + 3.5 * daylight   (MHz)
//
// LIMITATIONS (stated plainly because this is a planning aid, not a model):
// no seasonal term, no latitude term, no storm/absorption events, and the
// solar input is a single number. Treat the output as "which way to lean",
// not as a guarantee. Validated against VOACAP in docs/VALIDATION.md.
//
// This module is part of the original work of Cpl Angeles-Gonzalez,
// Ezekiel S., USMC. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────

var R_EARTH = 6371;
var DEG = Math.PI / 180;

// Solar activity assumed when the app has never seen a NOAA reading. Chosen
// as a mid-cycle value so an offline-only user is never wildly off in either
// direction; the UI states when this default is in use.
export const DEFAULT_SSN = 70;

// 10.7 cm solar flux → sunspot number (inverse of the standard
// SFI = 63.75 + 0.728*SSN + 0.00089*SSN^2 relation, solved numerically).
export function sfiToSSN(sfi) {
  if (typeof sfi !== 'number' || !isFinite(sfi)) return null;
  if (sfi <= 63.75) return 0;
  // Quadratic formula on 0.00089*S^2 + 0.728*S + (63.75 - sfi) = 0
  var a = 0.00089, b = 0.728, c = 63.75 - sfi;
  var ssn = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return Math.max(0, Math.round(ssn));
}

// Local solar time (hours, 0-24) at a longitude for a given UTC hour.
export function localSolarTime(utcHour, lonDeg) {
  var t = utcHour + lonDeg / 15;
  return ((t % 24) + 24) % 24;
}

// Diurnal shape constants (VOACAP-calibrated — see module header).
export const FOF2_PEAK_HOUR = 12.8;  // local solar time of maximum ionization
export const FOF2_DECAY_EXP = 1.6;   // >1 sharpens the post-sunset falloff
export const FOF2_NIGHT_RATIO = 0.45;
export const FOF2_NOON_BASE = 6.8;   // MHz at SSN 0
export const FOF2_NOON_PER_SSN = 0.036;

// Diurnal ionization factor, 0 (pre-dawn minimum) → 1 (early-afternoon peak).
export function diurnalFactor(localHour) {
  var cosine = 0.5 * (1 + Math.cos(2 * Math.PI * (localHour - FOF2_PEAK_HOUR) / 24));
  return Math.pow(cosine, FOF2_DECAY_EXP);
}

// Critical frequency foF2 (MHz) for a solar activity level and local time.
export function estimateFoF2(ssn, localHour) {
  var noon = FOF2_NOON_BASE + FOF2_NOON_PER_SSN * ssn;
  var night = FOF2_NIGHT_RATIO * noon;
  return night + (noon - night) * diurnalFactor(localHour);
}

// Oblique-incidence multiplier (the "M factor") for a takeoff angle, given
// the reflection height. sin φ = R·cos α /(R+h);  M = 1/cos φ.
export function secantFactor(takeoffDeg, layerKm) {
  var sinPhi = R_EARTH * Math.cos(takeoffDeg * DEG) / (R_EARTH + layerKm);
  if (sinPhi >= 1) sinPhi = 0.999999;
  var cosPhi = Math.sqrt(1 - sinPhi * sinPhi);
  return 1 / cosPhi;
}

// Verdict thresholds, expressed as a fraction of MUF.
// Above MUF the signal punches through; near MUF it is unstable; well below
// FOT absorption climbs; below LUF the D layer eats it.
export function classifyFrequency(freqMHz, muf, luf) {
  if (freqMHz > muf) {
    return { code: 'above_muf', label: 'ABOVE MUF', ok: false,
      note: 'Signal will likely pass through the ionosphere instead of reflecting — the path probably will not close on this frequency.' };
  }
  if (freqMHz < luf) {
    return { code: 'below_luf', label: 'BELOW LUF', ok: false,
      note: 'D-layer absorption is likely to swallow this frequency at current power levels. Go higher.' };
  }
  if (freqMHz > 0.9 * muf) {
    return { code: 'near_muf', label: 'MARGINAL — NEAR MUF', ok: true,
      note: 'Close to the maximum usable frequency: workable but unstable, and it will drop out first if conditions dip.' };
  }
  if (freqMHz < 0.6 * muf) {
    return { code: 'low', label: 'USABLE — HIGH ABSORPTION', ok: true,
      note: 'Below the optimum. It will propagate, but with more absorption and noise than a frequency nearer the FOT.' };
  }
  return { code: 'good', label: 'GOOD', ok: true,
    note: 'In the optimum window for this path and time.' };
}

// Full assessment.
// params: {
//   takeoffDeg   required takeoff angle for the path (from propagation.js)
//   layerKm      reflection height used for that angle (HOP.F2.hKm)
//   midLon       longitude of the path midpoint (for local solar time)
//   utcHour      hour of interest, 0-24 (UTC)
//   sfi          NOAA 10.7 cm flux if known (else null → DEFAULT_SSN used)
//   freqMHz      the frequency to assess (optional)
// }
export function assessFrequency(params) {
  var takeoffDeg = params.takeoffDeg;
  var layerKm = params.layerKm;
  if (typeof takeoffDeg !== 'number' || !isFinite(takeoffDeg)) return null;
  if (typeof layerKm !== 'number' || !isFinite(layerKm) || layerKm <= 0) return null;

  var ssn = sfiToSSN(params.sfi);
  var usingDefault = (ssn === null);
  if (usingDefault) ssn = DEFAULT_SSN;

  var utcHour = (typeof params.utcHour === 'number' && isFinite(params.utcHour)) ? params.utcHour : 12;
  var midLon = (typeof params.midLon === 'number' && isFinite(params.midLon)) ? params.midLon : 0;
  var lst = localSolarTime(utcHour, midLon);
  var daylight = diurnalFactor(lst);

  var foF2 = estimateFoF2(ssn, lst);
  var m = secantFactor(takeoffDeg, layerKm);
  var muf = foF2 * m;
  var fot = 0.85 * muf;
  var luf = 2.0 + 3.5 * daylight;

  var verdict = null;
  if (typeof params.freqMHz === 'number' && isFinite(params.freqMHz) && params.freqMHz > 0) {
    verdict = classifyFrequency(params.freqMHz, muf, luf);
  }

  // Suggested frequency: aim at FOT, but never below LUF or above MUF.
  var suggested = fot;
  if (suggested < luf) suggested = Math.min(luf + 0.5, muf);
  if (suggested > muf) suggested = muf;

  return {
    ssn: ssn,
    usingDefaultSolar: usingDefault,
    localSolarHour: lst,
    daylight: daylight,
    foF2: foF2,
    mFactor: m,
    muf: muf,
    fot: fot,
    luf: luf,
    suggestedMHz: suggested,
    verdict: verdict,
    // True when the whole band is closed for this path/time (LUF above MUF)
    pathClosed: luf >= muf,
  };
}

// ── 24-HOUR FORECAST ──────────────────────────────────────────────────────────
// Rolls assessFrequency across the day in fixed blocks so an operator can plan
// comm windows rather than only checking the current moment. Blocks are
// anchored to Zulu (00Z, 04Z, ...) because that is how comm windows are
// scheduled; each block is evaluated at its midpoint, which is representative
// of the block as a whole since MUF moves smoothly.
//
// params: everything assessFrequency takes (minus utcHour), plus
//   blockHours   size of each block in hours (default 4, must divide 24)
//   nowUtcHour   current UTC hour, used to flag the active block
export function frequencyForecast(params) {
  var size = params.blockHours || 4;
  if (24 % size !== 0) size = 4;
  var blocks = [];
  for (var start = 0; start < 24; start += size) {
    var mid = start + size / 2;
    var r = assessFrequency({
      takeoffDeg: params.takeoffDeg,
      layerKm: params.layerKm,
      midLon: params.midLon,
      utcHour: mid,
      sfi: params.sfi,
      freqMHz: params.freqMHz,
    });
    if (!r) return null;
    var now = params.nowUtcHour;
    blocks.push({
      startZ: start,
      endZ: (start + size) % 24,
      midZ: mid,
      muf: r.muf,
      fot: r.fot,
      luf: r.luf,
      suggestedMHz: r.suggestedMHz,
      verdict: r.verdict,
      isNow: typeof now === 'number' && isFinite(now)
        && ((now % 24) + 24) % 24 >= start && ((now % 24) + 24) % 24 < start + size,
    });
  }
  return blocks;
}

// Pick the best block(s) for a frequency: prefers a GOOD verdict, then the
// block whose FOT sits closest to the frequency. Returns null when the
// frequency is unusable in every block.
export function bestBlocks(blocks, freqMHz) {
  if (!blocks || !blocks.length || typeof freqMHz !== 'number') return null;
  var usable = blocks.filter(function(b) { return b.verdict && b.verdict.ok; });
  if (!usable.length) return null;
  var good = usable.filter(function(b) { return b.verdict.code === 'good'; });
  var pool = good.length ? good : usable;
  return pool.slice().sort(function(a, b) {
    return Math.abs(a.fot - freqMHz) - Math.abs(b.fot - freqMHz);
  });
}
