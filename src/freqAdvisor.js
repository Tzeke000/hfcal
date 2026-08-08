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
// 1. Solar activity and the sun's HEIGHT drive the critical frequency foF2
//    (the highest frequency that reflects at VERTICAL incidence). The layer
//    responds to the solar zenith angle at the reflection point, not to the
//    clock, so foF2 is built from cos(chi) with a recombination lag — see
//    SOLAR ILLUMINATION below. Fitted against 4320 VOACAP samples spanning
//    mid-latitude, 60 N to 44 S over twelve months, and six transequatorial
//    circuits; docs/VALIDATION.md Part 6.
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
//    Note the different geometry from the MUF: the ray crosses the absorbing
//    D layer (60-90 km) close to EACH STATION, not at the reflection point, so
//    daylight here is averaged over the two endpoints rather than taken at the
//    midpoint. On a path with one end in sun and one in darkness those are
//    very different numbers. This split is on physical grounds only — the LUF
//    has never been validated against VOACAP. See docs/VALIDATION.md Part 7.
//
// 5. Season and latitude scale foF2 (see seasonLatitudeFactor below). Both are
//    taken at the PATH MIDPOINT — the reflection point — not at the station,
//    for the same reason local solar time is: that is the patch of ionosphere
//    the hop actually bounces off.
//
// LIMITATIONS (stated plainly because this is a planning aid, not a model):
// the residual season/latitude terms are a smooth global fit rather than the
// CCIR coefficient maps; there is no sporadic-E, no storm or absorption
// events, no auroral-zone term, and no equatorial-anomaly structure, so low
// latitudes remain the weakest case; the solar input is a single number; and
// the LUF side has never been validated against anything. Treat the output as
// "which way to lean", not as a guarantee. docs/VALIDATION.md.
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

// ── SOLAR ILLUMINATION ────────────────────────────────────────────────────────
// The layer is driven by how high the sun actually is over the reflection
// point, not by the clock. The solar zenith angle χ carries time of day,
// season and latitude in a single physical quantity:
//
//     cos χ = sin(lat)·sin(δ) + cos(lat)·cos(δ)·cos(H)
//     H     = 15°·(local solar time − 12),  δ = solar declination
//
// Chapman layer theory gives the critical frequency of a photochemically
// controlled layer as foF ∝ (cos χ)^¼ — production balancing recombination.
// The F2 layer departs from that because transport, not just photochemistry,
// governs it, so the exponent below is fitted rather than assumed; it lands
// near 0.22, in the same family as the theoretical ¼.
//
// Replacing a clock-driven cosine with real solar geometry is what lets the
// model handle a polar summer (sun never sets), a polar winter (never rises)
// and an equatorial path (sun overhead twice a year) without special cases.
// See docs/VALIDATION.md Part 6.

// Day of year at mid-month, used to get the solar declination for a month.
var MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

// Solar declination in degrees — where the sun is overhead. Swings ±23.44°
// across the year and is the single quantity that encodes "season".
export function solarDeclination(month) {
  var doy = MID_MONTH_DOY[Math.max(1, Math.min(12, Math.round(month))) - 1];
  return 23.44 * Math.sin(2 * Math.PI * (doy - 80.5) / 365.25);
}

// cos of the solar zenith angle. 1 = sun overhead, 0 = on the horizon,
// negative = below the horizon (night).
export function cosZenith(latDeg, localHour, declDeg) {
  var ha = (localHour - 12) * 15 * DEG;
  return Math.sin(latDeg * DEG) * Math.sin(declDeg * DEG)
       + Math.cos(latDeg * DEG) * Math.cos(declDeg * DEG) * Math.cos(ha);
}

// How long the layer takes to respond to the sun. The ionosphere does not
// track illumination instantly: production competes with recombination, so
// density lags behind and drains slowly after sunset. This one constant is
// what produces both the observed early-afternoon peak and the long evening
// tail — behaviour the previous clock-based curve had to encode as two
// separate hand-tuned numbers, and still got wrong after sunset.
export const FOF2_LAG_HOURS = 1.2;

// Illumination actually driving the layer: an exponentially weighted history
// of max(cos χ, 0) over the preceding hours. 0 = fully dark for a long time,
// 1 = sun overhead and steady. Stateless and deterministic — no spin-up.
export function illuminationFactor(latDeg, localHour, month) {
  var decl = solarDeclination(month);
  var STEPS = 48, WINDOW_H = 18, dt = WINDOW_H / STEPS;
  var num = 0, den = 0;
  for (var i = 0; i < STEPS; i++) {
    var s = (i + 0.5) * dt;
    var w = Math.exp(-s / FOF2_LAG_HOURS);
    var c = cosZenith(latDeg, localHour - s, decl);
    if (c > 0) num += c * w;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

// ── foF2 ──────────────────────────────────────────────────────────────────────
// Fitted jointly against 4320 VOACAP samples spanning three independent data
// sets — mid-latitude, six latitudes from 60 N to 44 S over all twelve months,
// and six transequatorial circuits. See docs/VALIDATION.md Part 6.
export const FOF2_AMP_BASE = 6.7;        // MHz at SSN 0, fully illuminated
export const FOF2_AMP_PER_SSN = 0.0245;  // MHz per sunspot number
export const FOF2_ILLUM_EXP = 0.18;      // Chapman-family exponent on cos χ
export const FOF2_NIGHT_FLOOR = 0.37;    // the layer never fully decays

// Three residual effects that solar geometry alone cannot produce:
export const SEASON_LAT_SCALE = 60;   // degrees magnetic where the lat term saturates
export const SEASON_K_LAT = 0.095;    // equator-to-pole gradient, on MAGNETIC latitude
export const SEASON_K_ANNUAL = 0.06;  // December/perihelion anomaly, all latitudes
// The winter anomaly. Daytime foF2 is HIGHER in local winter than local
// summer — the opposite of what sunlight alone would give, because it is a
// thermospheric composition (O/N2) effect rather than a photochemical one.
// Solar geometry can never produce it, so it stays an explicit term. Negative
// because the cosine it multiplies peaks at the local SUMMER solstice, and
// weighted by illumination because the effect is a daytime one.
export const SEASON_K_WINTER = -0.14;

// ── LEGACY CLOCK-BASED CURVE ──────────────────────────────────────────────────
// Retained for callers that supply no date or no location. It is the v1.13.2
// model: measurably worse (see Part 6), but better than refusing to answer.
export const FOF2_PEAK_HOUR = 12.8;
export const FOF2_DECAY_EXP = 1.4;
export const FOF2_NIGHT_RATIO = 0.45;
export const FOF2_NOON_BASE = 6.8;
export const FOF2_NOON_PER_SSN = 0.036;

export function diurnalFactor(localHour) {
  var cosine = 0.5 * (1 + Math.cos(2 * Math.PI * (localHour - FOF2_PEAK_HOUR) / 24));
  return Math.pow(cosine, FOF2_DECAY_EXP);
}

// Magnetic-latitude, annual-anomaly and winter-anomaly multiplier. The
// ionosphere organises around the magnetic field rather than geography, which
// is why New Zealand at 44 S behaves like roughly 50 S. `illum` is how lit the
// reflection point is (0-1); the winter anomaly is weighted by it because it
// is a daytime effect that reverses at night.
export function seasonLatitudeFactor(month, magLatDeg, illum) {
  var haveMonth = typeof month === 'number' && isFinite(month) && month >= 1 && month <= 12;
  var haveLat = typeof magLatDeg === 'number' && isFinite(magLatDeg);
  var x = (typeof illum === 'number' && isFinite(illum)) ? Math.max(0, Math.min(1, illum)) : 0;
  var f = 1;
  var mlN = haveLat ? Math.min(Math.abs(magLatDeg) / SEASON_LAT_SCALE, 1) : 0;
  if (haveLat) f *= 1 + SEASON_K_LAT * (1 - 2 * mlN);
  if (haveMonth) {
    f *= 1 + SEASON_K_ANNUAL * Math.cos(2 * Math.PI * (month - 1) / 12);
    if (haveLat) {
      // Local summer solstice: July in the north, January in the south.
      var summerMonth = magLatDeg < 0 ? 1 : 7;
      f *= 1 + SEASON_K_WINTER * mlN * Math.cos(2 * Math.PI * (month - summerMonth) / 12) * x;
    }
  }
  return Math.max(0.2, f);
}

// Critical frequency foF2 in MHz.
//   latDeg    geographic latitude of the reflection point (path midpoint)
//   magLatDeg magnetic latitude of the same point
// With a month AND a latitude the solar-geometry model runs. Without either,
// it falls back to the legacy clock curve so older call paths still work.
export function estimateFoF2(ssn, localHour, month, magLatDeg, latDeg) {
  var haveMonth = typeof month === 'number' && isFinite(month) && month >= 1 && month <= 12;
  var haveLat = typeof latDeg === 'number' && isFinite(latDeg) && latDeg >= -90 && latDeg <= 90;

  if (haveMonth && haveLat) {
    var x = illuminationFactor(latDeg, localHour, month);
    if (x < 0) x = 0; else if (x > 1) x = 1;
    var amp = FOF2_AMP_BASE + FOF2_AMP_PER_SSN * ssn;
    var shape = FOF2_NIGHT_FLOOR + (1 - FOF2_NIGHT_FLOOR) * Math.pow(x, FOF2_ILLUM_EXP);
    return amp * shape * seasonLatitudeFactor(month, magLatDeg, x);
  }

  // Fallback: no date or no location. The clock curve stands in for real solar
  // geometry, which costs accuracy (see docs/VALIDATION.md Part 6) but still
  // answers. diurnalFactor doubles as the illumination proxy here.
  var d = diurnalFactor(localHour);
  var noon = FOF2_NOON_BASE + FOF2_NOON_PER_SSN * ssn;
  var night = FOF2_NIGHT_RATIO * noon;
  return (night + (noon - night) * d) * seasonLatitudeFactor(month, magLatDeg, d);
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
//   month        1-12, for the seasonal correction (optional)
//   magLatDeg    geomagnetic latitude of the station (optional)
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

  // MUF comes from the REFLECTION POINT — the midpoint. Measured against
  // VOACAP, sampling both endpoints instead helps short paths a little and
  // hurts long ones a lot (Part 7), because on a long circuit the signal
  // bounces off the middle, not off either station.
  var foF2 = estimateFoF2(ssn, lst, params.month, params.magLatDeg, params.latDeg);

  // LUF comes from the TWO ENDS — that is where the ray crosses the absorbing
  // D layer. Falls back to the midpoint, then to the clock curve.
  var haveGeo = typeof params.latDeg === 'number' && isFinite(params.latDeg)
             && typeof params.month === 'number' && isFinite(params.month);
  var ends = params.ends;
  var daylight;
  if (haveGeo && ends && ends.length === 2
      && typeof ends[0].lat === 'number' && typeof ends[1].lat === 'number') {
    daylight = 0.5 * (
      illuminationFactor(ends[0].lat, localSolarTime(utcHour, ends[0].lon), params.month) +
      illuminationFactor(ends[1].lat, localSolarTime(utcHour, ends[1].lon), params.month));
  } else if (haveGeo) {
    daylight = illuminationFactor(params.latDeg, lst, params.month);
  } else {
    daylight = diurnalFactor(lst);
  }
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

  // Local solar time at each station, so an operator can see at a glance
  // whether the far end is in daylight while they are in the dark.
  var endHours = (ends && ends.length === 2
    && typeof ends[0].lon === 'number' && typeof ends[1].lon === 'number')
    ? [localSolarTime(utcHour, ends[0].lon), localSolarTime(utcHour, ends[1].lon)]
    : null;

  return {
    ssn: ssn,
    usingDefaultSolar: usingDefault,
    localSolarHour: lst,
    endSolarHours: endHours,
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
      month: params.month,
      magLatDeg: params.magLatDeg,
      latDeg: params.latDeg,
      ends: params.ends,
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
