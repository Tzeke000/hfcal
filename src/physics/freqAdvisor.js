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
// 3. FOT (Frequency of Optimum Traffic) — the planning figure the operator
//    actually aims at, DEFINED as the frequency good 90% of days. The
//    textbook rule of thumb is 0.85 * MUF and it aims too high: measured
//    against VOACAP's own MUFday output, 0.85 * MUF delivers about 82% of
//    days and the real 90% frequency sits at 0.77 * MUF — so a plan built on
//    the textbook figure fails nearer one day in five than one in ten.
//    See docs/VALIDATION.md Parts 11 and 12.
//
// 4. LUF (Lowest Usable Frequency) is set by D-layer absorption, which tracks
//    daylight AND transmit power — unlike the MUF, which no amount of power
//    will move. Non-deviative absorption per hop goes as
//       L = sec(phi_D) * (A0 + K * I^0.75) / (f + fH)^2   dB
//    and the link closes while L stays under the available power margin M,
//    which grows as 10*log10(P). Solving L = M for f:
//       LUF = sqrt( sec(phi_D) * (A0 + K*I^0.75) * hops / M(P) ) - fH
//    So the LUF falls as the SQUARE ROOT of the margin: 20x the power buys
//    roughly 40% off the LUF, not 20x.
//    sec(phi_D) is the obliquity where the ray CROSSES the D layer on its way
//    up to F2 — a 2500 km hop leaves at 10 degrees and spends 4.4x as long in
//    the absorbing region as an NVIS shot does. Measured against VOACAP's own
//    loss curves in Part 20; before that the app had no obliquity term at all
//    and under-stated the floor on long paths.
//    Note the different geometry from the MUF: the ray crosses the absorbing
//    D layer (60-90 km) close to EACH STATION, not at the reflection point, so
//    daylight here is averaged over the two endpoints rather than taken at the
//    midpoint. On a path with one end in sun and one in darkness those are
//    very different numbers. See docs/VALIDATION.md Parts 7, 8 and 20.
//
// 5. Season and latitude scale foF2 (see seasonLatitudeFactor below), taken
//    where the signal REFLECTS. On a single hop that is the path midpoint. On
//    a multi-hop path there are several bounces, each somewhere different, at
//    a different local solar time and magnetic latitude — and on a long enough
//    circuit in a different hemisphere and therefore a different season. The
//    signal must reflect at every one of them, so the path is limited by the
//    weakest. See pathFoF2 and docs/VALIDATION.md Part 9.
//
// LIMITATIONS (stated plainly because this is a planning aid, not a model):
// the residual season/latitude terms are a smooth global fit rather than the
// CCIR coefficient maps; there is no sporadic-E, no storm or absorption
// events, no auroral-zone term, and no equatorial-anomaly structure, so low
// latitudes remain the weakest case; the solar input is a single number; and
// the LUF's absorption law, illumination exponent and obliquity are now
// measured (Part 20) but its absolute LEVEL still rests on the 10 dB margin
// anchor at 20 W rather than on a measurement. Treat the output as "which way
// to lean", not as a guarantee. docs/VALIDATION.md.
//
// This module is part of the original work of Cpl Angeles-Gonzalez,
// Ezekiel S., USMC. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────

import {
  FOF2_MAP_ORDERS, FOF2_MAP_MODIP_SCALE, FOF2_MAP_SSN_SCALE,
  FOF2_MAP_COEFFS, FOF2_MAP_HELDOUT_PCT,
} from '../data/fof2Map.js';
import { tableFoF2, foF2TableReady } from '../data/fof2Table.js';
import { EARTH_RADIUS_KM, F2_HEIGHT_KM } from './propagation.js';
import {
  MFACTOR_DISTANCES, MFACTOR_SSNS, MFACTOR_NLST, MFACTOR_SCALE,
  MFACTOR_TABLE, MFACTOR_HELDOUT_PCT,
} from '../data/mfactorTable.js';

var R_EARTH = EARTH_RADIUS_KM;
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
// near 0.16, the same family as the theoretical ¼.
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
export const FOF2_LAG_HOURS = 1.05;

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

// ── COEFFICIENT MAP ───────────────────────────────────────────────────────────
// A compact reconstruction of the ionospheric map VOACAP itself uses, fitted
// offline against 271296 VOACAP samples over 314 globally spread sites, a
// quarter of which were never fitted (docs/VALIDATION.md Part 14). On those
// held-out sites it scores 7.4% against the physical model's 16.9%.
//
// It is a FITTED POLYNOMIAL, and polynomials misbehave outside the data that
// trained them. Swept across the whole input domain this one runs from 0.99 to
// 1208 MHz — the high end being pure extrapolation blow-up at the corners. So
// it is never used raw. Inputs are clamped to the trained envelope, the output
// is clamped to a physical window, and if it still disagrees with the physical
// model by more than a factor the physical model wins. A wrong frequency is
// worse than a slightly less accurate one.
export const MAP_MODIP_LIMIT = 72;        // trained envelope, degrees
const MAP_SSN_LIMIT = 165;         // trained to SSN 150
export const MAP_FOF2_MIN = 1.0;          // physical window, MHz
export const MAP_FOF2_MAX = 20.0;
export const MAP_SANITY_FACTOR = 1.8;     // vs the physical model
export const MAP_HELDOUT_PCT = FOF2_MAP_HELDOUT_PCT;

// Evaluate the map. Returns null when it cannot be trusted, which callers
// treat as "use the physical model".
export function mapFoF2(modipDeg, localHour, month, ssn, lonDeg) {
  if (typeof modipDeg !== 'number' || !isFinite(modipDeg)) return null;
  if (typeof month !== 'number' || !isFinite(month) || month < 1 || month > 12) return null;
  if (typeof lonDeg !== 'number' || !isFinite(lonDeg)) return null;

  var O = FOF2_MAP_ORDERS;
  var mp = Math.max(-MAP_MODIP_LIMIT, Math.min(MAP_MODIP_LIMIT, modipDeg));
  var u = mp / FOF2_MAP_MODIP_SCALE;
  var sv = Math.max(0, Math.min(MAP_SSN_LIMIT, ssn)) / FOF2_MAP_SSN_SCALE;
  var t = 2 * Math.PI * (((localHour % 24) + 24) % 24) / 24;
  var mo = 2 * Math.PI * (month - 0.5) / 12;
  var lo = 2 * Math.PI * (((lonDeg + 540) % 360) - 180) / 360;

  var T = [1], M = [1], L = [1], S = [1], k;
  for (k = 1; k <= O.nt; k++) T.push(Math.cos(k * t), Math.sin(k * t));
  for (k = 1; k <= O.nm; k++) M.push(Math.cos(k * mo), Math.sin(k * mo));
  for (k = 1; k <= O.nl; k++) L.push(Math.pow(u, k));
  for (k = 1; k <= O.ns; k++) S.push(Math.pow(sv, k));

  // Order must match build() in scripts/validation/build/fit_fof2_map.py exactly.
  var sum = 0, i = 0, a, b, c, e, ab, abc;
  for (a = 0; a < T.length; a++) {
    for (b = 0; b < M.length; b++) {
      ab = T[a] * M[b];
      for (c = 0; c < L.length; c++) {
        abc = ab * L[c];
        for (e = 0; e < S.length; e++) sum += FOF2_MAP_COEFFS[i++] * abc * S[e];
      }
    }
  }
  var G = [];
  for (k = 1; k <= O.nlon; k++) G.push(Math.cos(k * lo), Math.sin(k * lo));
  for (var g = 0; g < G.length; g++) {
    for (c = 0; c < 5; c++) {
      var gc = G[g] * L[c];
      for (a = 0; a < 5; a++) {
        for (e = 0; e < 2; e++) sum += FOF2_MAP_COEFFS[i++] * gc * T[a] * S[e];
      }
    }
  }
  var v = Math.exp(sum);
  if (!isFinite(v)) return null;
  return Math.max(MAP_FOF2_MIN, Math.min(MAP_FOF2_MAX, v));
}

// ── foF2 ──────────────────────────────────────────────────────────────────────
// Fitted jointly against 4320 VOACAP samples spanning three independent data
// sets — mid-latitude, six latitudes from 60 N to 44 S over all twelve months,
// and six transequatorial circuits. See docs/VALIDATION.md Part 6.
// Refit in v1.18.0 against the CURRENT structure. Every one of these was
// originally fitted in Part 6, when the model evaluated the path midpoint and
// used the terrain-adjusted takeoff angle. Per-bounce evaluation (Part 9) and
// the geometric-angle fix (Part 10) both changed what the fit sees, so the old
// values were stale. Refitting improved all three data sets at once —
// weighted error 13.20% to 12.29% — with the seasonal-ordering constraint from
// Part 6 still held, so the winter anomaly cannot come out backwards.
export const FOF2_AMP_BASE = 7.1;        // MHz at SSN 0, fully illuminated
export const FOF2_AMP_PER_SSN = 0.023;   // MHz per sunspot number
export const FOF2_ILLUM_EXP = 0.16;      // Chapman-family exponent on cos χ
export const FOF2_NIGHT_FLOOR = 0.34;    // the layer never fully decays

// Three residual effects that solar geometry alone cannot produce:
export const SEASON_LAT_SCALE = 60;   // degrees magnetic where the lat term saturates
export const SEASON_K_LAT = 0.13;     // equator-to-pole gradient, on MAGNETIC latitude
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

// ── LUF ───────────────────────────────────────────────────────────────────────
// Absorption constant, anchored so that the reference case — 20 W, one hop,
// sun overhead — reproduces the 5.5 MHz the app has always used, and the shape
// then carries it to any other power. VOACAP corroborates the SHAPE: measured
// over paired conditions, going 20 W -> 400 W drops the LUF 43% in daylight,
// against 42% predicted here. The absolute level is still uncalibrated (see
// docs/VALIDATION.md Part 8) — this is a better-shaped estimate, not a
// measured one. 20 W is both the historical anchor and the AN/PRC-160's
// GLOBAL setting, so the reference case is a real radio on its top manpack
// power rather than an arbitrary round number.
// MEASURED IN PART 20. Parts 8 and 13 both concluded the LUF could not be
// calibrated, because both were reading VOACAP's RELIABILITY output — which is
// censored: when nothing in the frequency grid closes the link the condition
// disappears entirely, and at low power most daylight hours disappear with it.
// VOACAP also prints LOSS, at every frequency and every hour, closed link or
// not. Fitting LOSS(f) = 20log10(f) + C + A/(f+fH)^2 across the band recovers
// the absorption term A directly and uncensored. See run_luf_absorption_study.
//
// What that measurement found, in order of consequence:
//
//   1. THE LAW HOLDS. A/(f+fH)^2 fits VOACAP's loss curve to a median 0.9 dB.
//   2. NO OBLIQUITY TERM. The app charged a 2500 km hop the same absorption as
//      a 300 km one. A ray to a distant target crosses the D layer at a
//      shallow angle and spends far longer inside it — absorption scales with
//      the secant of that crossing angle, which reaches 4.4x at 2500 km. This
//      was the single largest error in the LUF and it ran the wrong way: the
//      app under-stated the floor on exactly the long paths where a Marine has
//      least margin to spare.
//   3. NO NIGHT RESIDUAL. Absorption does not go to zero after dark, and on a
//      long path what is left is enough to matter.
//
// The exponent on illumination measured between 0.72 and 0.97 depending on how
// the fit is conditioned; 0.75 (the Chapman value the app already used) sits
// inside that range and is kept rather than tuned to a noisier number.
export const LUF_K = 373.1;            // solar absorption constant, MHz^2 * dB
export const LUF_A_NIGHT = 48.0;       // residual absorption with no sun at all
export const LUF_D_HEIGHT_KM = 75;     // D layer — where the absorbing happens
export const LUF_GYRO_MHZ = 1.2;       // electron gyrofrequency
export const LUF_MARGIN_20W_DB = 10;   // link margin at the 20 W reference
export const LUF_REF_WATTS = 20;       // reference transmit power
export const LUF_FLOOR_MHZ = 2.0;      // noise-limited floor; absorption is not
                                       // what stops you at 2 MHz on a dark path
export const DEFAULT_TX_WATTS = 20;    // AN/PRC-160 GLOBAL — the manpack maximum

// How much longer the ray's path through the D layer is than a vertical one.
// The ray does not reflect off the D layer, it PASSES THROUGH it on the way up
// to F2, so this is the obliquity where it crosses 75 km — not a secant taken
// at the D layer as if it bounced there.
export const LUF_F2_HEIGHT_KM = F2_HEIGHT_KM;   // where the ray is headed
export function dLayerObliquity(hopDistKm) {
  if (typeof hopDistKm !== 'number' || !isFinite(hopDistKm) || hopDistKm <= 0) return 1;
  // Elevation angle at the ground for a hop of this length off F2 — the same
  // closed-form geometry the MUF uses, without the 3° operational clamp.
  var theta = hopDistKm / (2 * R_EARTH);
  var toa = Math.atan2(Math.cos(theta) - R_EARTH / (R_EARTH + LUF_F2_HEIGHT_KM),
                       Math.sin(theta));
  if (!(toa > 0)) toa = 0;
  var c = R_EARTH * Math.cos(toa) / (R_EARTH + LUF_D_HEIGHT_KM);
  var s = 1 - c * c;
  return s > 1e-9 ? 1 / Math.sqrt(s) : 1;
}

// Lowest usable frequency, MHz.
//   illum    0-1 solar illumination where the ray crosses the D layer
//   watts    transmit power; defaults to a 20 W manpack
//   hops     number of hops — the ray crosses the absorbing layer once per hop
//   distKm   total path length, used for the obliquity of each crossing.
//            Omitted, it falls back to a vertical crossing, which is only
//            right for NVIS.
export function estimateLUF(illum, watts, hops, distKm) {
  var i = (typeof illum === 'number' && isFinite(illum)) ? Math.max(0, Math.min(1, illum)) : 0;
  var p = (typeof watts === 'number' && isFinite(watts) && watts > 0) ? watts : DEFAULT_TX_WATTS;
  var n = (typeof hops === 'number' && isFinite(hops) && hops >= 1) ? hops : 1;
  var margin = LUF_MARGIN_20W_DB + 10 * (Math.log(p / LUF_REF_WATTS) / Math.LN10);
  if (margin < 1) margin = 1;
  var sec = (typeof distKm === 'number' && isFinite(distKm) && distKm > 0)
    ? dLayerObliquity(distKm / n) : 1;
  var A = sec * (LUF_A_NIGHT + LUF_K * Math.pow(i, 0.75)) * n;
  var absorbed = Math.sqrt(A / margin) - LUF_GYRO_MHZ;
  return Math.max(LUF_FLOOR_MHZ, absorbed);
}

// ── MULTI-HOP: THE WEAKEST BOUNCE ────────────────────────────────────────────
// A multi-hop signal has to reflect successfully at EVERY bounce, so the path
// is capped by the worst one — one bounce in darkness closes the circuit no
// matter how good the others are.
//
// Taking a plain minimum makes predictions worse, though, and for a reason
// worth naming: the minimum of several NOISY estimates sits below the true
// minimum. With k independent estimates of relative error sigma, the expected
// shortfall is sigma * E[min of k standard normals]:
//
//     k = 1: 0.000    k = 2: 0.564    k = 3: 0.846    k = 4: 1.029
//
// Measured against VOACAP, a raw minimum ran 8.6% low. Correcting for that
// recovers the physics without inventing a tunable knob — sigma below is the
// model's OWN measured per-point error (docs/VALIDATION.md Part 6), not a
// fitted parameter.
// Per-point error of whatever source is actually supplying foF2. This is NOT
// a constant: the de-bias above is proportional to it, and the sources differ
// by more than a factor of ten.
//
// It was hardcoded at 0.13 — the PHYSICAL MODEL's error from Part 6 — and left
// there when the lookup table cut per-point error to 1.2%. That inflated
// multi-hop foF2 by 7-11% instead of ~1%, which is precisely the +4% bias the
// transequatorial set showed in Part 16. A correction for noise has to track
// the noise it is correcting for.
export const FOF2_SIGMA_TABLE = 0.012;    // lookup table, docs Part 15
export const FOF2_SIGMA_MAP = 0.074;      // coefficient map, Part 14
const FOF2_SIGMA_PHYSICAL = 0.169; // solar-geometry model, Part 14
export const FOF2_POINT_SIGMA = FOF2_SIGMA_PHYSICAL;   // legacy name

export function foF2PointSigma() {
  return foF2TableReady() ? FOF2_SIGMA_TABLE : FOF2_SIGMA_MAP;
}

var MIN_ORDER_BIAS = [0, 0, 0.5642, 0.8463, 1.0294, 1.1630];

// The minimum of k noisy estimates sits below the true minimum by
// sigma * E[min of k standard normals]. sigma defaults to whatever source is
// live rather than to a stale constant.
export function minOrderCorrection(k, sigma) {
  if (!(k > 1)) return 1;
  var s = (typeof sigma === 'number' && isFinite(sigma)) ? sigma : foF2PointSigma();
  var c = MIN_ORDER_BIAS[Math.min(k, MIN_ORDER_BIAS.length - 1)] || 1.2;
  return 1 + s * c;
}

// foF2 at ONE bounce, from the best source available, in order:
//
//   1. THE LOOKUP TABLE   our own generated grid (fof2Table.js). Most
//      accurate, because it stores what the ionosphere does rather than
//      approximating it. Only available once the asset has loaded.
//   2. THE COEFFICIENT MAP   a 2111-term smooth fit (fof2Map.js). Always
//      available, no asset needed.
//   3. THE PHYSICAL MODEL   solar geometry and Chapman theory. Always
//      available, fully explainable, and the thing that keeps the other two
//      honest.
//
// The MAP is checked against the physical model: if they disagree by more
// than MAP_SANITY_FACTOR the physics wins. The map is a polynomial fit, and a
// polynomial handed an input off the end of its training envelope can return
// anything at all, so it needs a chaperone.
//
// The TABLE is NOT checked that way, and that is deliberate. It used to be,
// and the polar study (docs/VALIDATION.md Part 19) measured what that cost:
// above the auroral oval and through polar night the physical model
// under-predicts foF2 badly, so it was the MODEL that disagreed with the
// table, not the other way round. The guard then threw away a measured value
// and returned the physics — which on those rows was low by 46%, every single
// time. Guarding a 1.2%-accurate table with a 16.9%-accurate model gets the
// argument backwards.
//
// The table is a bounded interpolation between measured VOACAP values; unlike
// the map it cannot extrapolate, so the only thing worth defending against is
// a corrupt or misparsed asset. TABLE_FOF2_MIN/MAX do that: they reject a
// number that is not physically an foF2 at all, and nothing else. Measured
// cost of the change at mid-latitude: none (3.67% before and after).
export const TABLE_FOF2_MIN = 0.5;        // MHz — below this it is not an foF2
export const TABLE_FOF2_MAX = 20.0;       // MHz — above this it is not either

export function bounceFoF2(ssn, utcHour, month, b) {
  var lst = localSolarTime(utcHour, b.lon);
  var phys = estimateFoF2(ssn, lst, month, b.magLatDeg, b.lat);

  var t = tableFoF2(b.lat, b.lon, month, utcHour, ssn);
  if (t !== null && isFinite(t) && t >= TABLE_FOF2_MIN && t <= TABLE_FOF2_MAX) return t;

  if (typeof b.modipDeg === 'number' && isFinite(b.modipDeg)) {
    var mapped = mapFoF2(b.modipDeg, lst, month, ssn, b.lon);
    if (mapped !== null && isFinite(mapped) && mapped > 0
        && mapped <= phys * MAP_SANITY_FACTOR && mapped * MAP_SANITY_FACTOR >= phys) {
      return mapped;
    }
  }
  return phys;
}

// Which source the advisor is currently able to use — surfaced so the UI can
// say so rather than quietly varying in accuracy.
export function foF2Source() {
  return foF2TableReady() ? 'table' : 'map';
}

// foF2 governing the whole path: the weakest bounce, de-biased.
// `bounces` is [{ lat, lon, magLatDeg }]; falls back to the midpoint when the
// caller has not worked them out.
export function pathFoF2(ssn, utcHour, month, bounces, midLon, midLat, midMagLat, midModip) {
  if (bounces && bounces.length) {
    var worst = Infinity;
    for (var i = 0; i < bounces.length; i++) {
      var v = bounceFoF2(ssn, utcHour, month, bounces[i]);
      if (v < worst) worst = v;
    }
    if (isFinite(worst)) return worst * minOrderCorrection(bounces.length);
  }
  return bounceFoF2(ssn, utcHour, month,
    { lon: midLon, lat: midLat, magLatDeg: midMagLat, modipDeg: midModip });
}

// ── M-FACTOR ──────────────────────────────────────────────────────────────────
// MUF = foF2 x M. M used to be DERIVED — hop count from a fixed maximum hop,
// takeoff angle from curved-earth geometry at a fixed 360 km virtual height,
// the secant law at that height, and a 3 degree clamp. Measured against
// VOACAP, all three were wrong in different ways (docs/VALIDATION.md Part 16):
// the clamp capped M at 3.06 where VOACAP reaches 3.25, the hop switch at
// 4186 km was off by 22% right at the transition, and the effective height is
// neither 360 km nor constant.
//
// So M is now looked up rather than derived, indexed by TOTAL path distance —
// which takes hop counting out of the MUF altogether, since the table simply
// knows what M is for a 4200 km path.
export const MFACTOR_ACCURACY_PCT = MFACTOR_HELDOUT_PCT;
export const MFACTOR_MIN = 1.0;
export const MFACTOR_MAX = 3.7;   // 1/cos(phi) at a grazing launch; a hard ceiling

// Linear interpolation on distance and solar activity; local solar time and
// month are binned. Returns null if the inputs are unusable.
export function mFactorLookup(distKm, localHour, month, ssn) {
  if (typeof distKm !== 'number' || !isFinite(distKm) || distKm <= 0) return null;
  if (typeof month !== 'number' || !isFinite(month) || month < 1 || month >= 13) return null;
  var D = MFACTOR_DISTANCES, S = MFACTOR_SSNS, NL = MFACTOR_NLST;

  var d = Math.max(D[0], Math.min(D[D.length - 1], distKm));
  var i0 = 0;
  while (i0 < D.length - 2 && d > D[i0 + 1]) i0++;
  var wd = (d - D[i0]) / (D[i0 + 1] - D[i0]);

  var h = (typeof localHour === 'number' && isFinite(localHour)) ? localHour : 12;
  var j = Math.floor((((h % 24) + 24) % 24) / 3) % NL;
  var k = Math.max(0, Math.min(11, Math.floor(month - 1)));

  var sv = (typeof ssn === 'number' && isFinite(ssn)) ? ssn : S[Math.floor(S.length / 2)];
  sv = Math.max(S[0], Math.min(S[S.length - 1], sv));
  var l0 = 0;
  while (l0 < S.length - 2 && sv > S[l0 + 1]) l0++;
  var ws = (sv - S[l0]) / (S[l0 + 1] - S[l0]);

  function cell(di, li) {
    return MFACTOR_TABLE[((di * NL + j) * 12 + k) * S.length + li] * MFACTOR_SCALE;
  }
  var v = (1 - wd) * ((1 - ws) * cell(i0, l0) + ws * cell(i0, l0 + 1))
        + wd * ((1 - ws) * cell(i0 + 1, l0) + ws * cell(i0 + 1, l0 + 1));
  if (!isFinite(v) || v <= 0) return null;
  return Math.max(MFACTOR_MIN, Math.min(MFACTOR_MAX, v));
}

// Oblique-incidence multiplier (the "M factor") for a takeoff angle, given
// the reflection height. sin φ = R·cos α /(R+h);  M = 1/cos φ. Retained as the
// physical model and as the guard on the table above.
export function secantFactor(takeoffDeg, layerKm) {
  var sinPhi = R_EARTH * Math.cos(takeoffDeg * DEG) / (R_EARTH + layerKm);
  if (sinPhi >= 1) sinPhi = 0.999999;
  var cosPhi = Math.sqrt(1 - sinPhi * sinPhi);
  return 1 / cosPhi;
}

// ── FOT ───────────────────────────────────────────────────────────────────────
// Measured, not assumed: the frequency VOACAP says works 90% of days, over
// the MUF. Median 0.769 across 173 samples, and strikingly flat with distance
// — 0.774 at 500 km, 0.769 at 1500, 3000 and 6000 km — which is what makes a
// single constant defensible.
//
// This number was measured TWICE. The first pass used a coarse frequency grid
// (2-3 MHz steps) and returned 0.740; re-running it with the grid placed at
// fixed fractions of each hour's own MUF, one hour per run, moved the answer
// to 0.769. Halving the step again changes it by 0.001, so it has converged.
// The coarse figure was biased low, and 0.74 shipped briefly in v1.17.0.
// See docs/VALIDATION.md Part 12.
//
// It does vary with illumination (0.684 daylight, 0.780 night) and that is
// NOT modelled — the term did not earn its place — so the FOT is slightly
// optimistic in strong daylight.
export const FOT_RATIO = 0.77;

// Two anchors the operator can reason about, both directly measured:
//   at the MUF  — works 5 days in 10 (the MUF is a MEDIAN, by definition)
//   at the FOT  — works 9 days in 10
export const MUF_DAYS_IN_10 = 5;
export const FOT_DAYS_IN_10 = 9;

// Verdict thresholds. Anchored to the FOT rather than to round fractions of
// the MUF: above the FOT you are, by definition, below 90% reliability, and
// the old "good up to 0.9 x MUF" band was calling ~70%-reliable frequencies
// GOOD.
const NEAR_MUF_FRACTION_OF_FOT = 1.0;   // above the FOT = under 9-in-10
const HIGH_ABSORPTION_FRACTION_OF_FOT = 0.8;

export function classifyFrequency(freqMHz, muf, luf) {
  // Classify on the values as DISPLAYED (0.1 MHz), not the raw floats. The
  // operator acts on the printed numbers; a verdict computed against 9.995
  // while the screen says "FOT 10.0" reads as a contradiction (Iris #11).
  var r1 = function(x) { return Math.round(x * 10) / 10; };
  freqMHz = r1(freqMHz); muf = r1(muf); luf = r1(luf);
  if (freqMHz > muf) {
    return { code: 'above_muf', label: 'ABOVE MUF', ok: false,
      note: 'Signal will likely pass through the ionosphere instead of reflecting — the path probably will not close on this frequency.' };
  }
  if (freqMHz < luf) {
    return { code: 'below_luf', label: 'BELOW LUF', ok: false,
      note: 'D-layer absorption is likely to swallow this frequency at current power levels. Go higher.' };
  }
  var fot = r1(FOT_RATIO * muf);
  if (freqMHz > fot * NEAR_MUF_FRACTION_OF_FOT) {
    return { code: 'near_muf', label: 'MARGINAL — ABOVE FOT', ok: true,
      note: 'Above the frequency that works 9 days in 10. It will carry on a good day, but it is the first thing to drop out when the ionosphere sits below its monthly median — and at the MUF itself you are down to 5 days in 10.' };
  }
  if (freqMHz < fot * HIGH_ABSORPTION_FRACTION_OF_FOT) {
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
  var foF2 = pathFoF2(ssn, utcHour, params.month, params.bounces,
                      midLon, params.latDeg, params.magLatDeg, params.modipDeg);

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
  // M from the measured table where possible, from the secant law otherwise —
  // and the secant law still guards the table, as elsewhere.
  var mPhys = secantFactor(takeoffDeg, layerKm);
  var m = mPhys;
  if (typeof params.distKm === 'number' && isFinite(params.distKm)) {
    var mTab = mFactorLookup(params.distKm, lst, params.month, ssn);
    if (mTab !== null && mTab <= mPhys * MAP_SANITY_FACTOR && mTab * MAP_SANITY_FACTOR >= mPhys) {
      m = mTab;
    }
  }
  var muf = foF2 * m;
  var fot = FOT_RATIO * muf;
  var luf = estimateLUF(daylight, params.txWatts, params.hops, params.distKm);

  var verdict = null;
  if (typeof params.freqMHz === 'number' && isFinite(params.freqMHz) && params.freqMHz > 0) {
    verdict = classifyFrequency(params.freqMHz, muf, luf);
  }

  // Suggested frequency: aim at FOT, but never below LUF or above MUF —
  // and never outside 2-30 MHz. At solar max on a long path the FOT itself
  // can sit above 30 MHz, which an AN/PRC-160 cannot dial; in deep polar
  // night the MUF can sit under the 2 MHz noise floor. A suggestion the
  // radio cannot tune is not a suggestion.
  var suggested = fot;
  if (suggested < luf) suggested = Math.min(luf + 0.5, muf);
  if (suggested > muf) suggested = muf;
  suggested = Math.max(2, Math.min(30, suggested));

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
    // Each ionospheric bounce with its own local solar time, and which one is
    // limiting the path — the operator can see WHICH bounce is closing them.
    bounceDetail: (params.bounces && params.bounces.length) ? params.bounces.map(function(b) {
      return {
        lat: b.lat, lon: b.lon, magLatDeg: b.magLatDeg,
        localSolarHour: localSolarTime(utcHour, b.lon),
        foF2: bounceFoF2(ssn, utcHour, params.month, b),
      };
    }) : null,
    daylight: daylight,
    foF2: foF2,
    mFactor: m,
    mFactorSource: (m === mPhys) ? 'secant' : 'table',
    muf: muf,
    fot: fot,
    luf: luf,
    txWatts: (typeof params.txWatts === 'number' && params.txWatts > 0) ? params.txWatts : DEFAULT_TX_WATTS,
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
// The next hour (UTC) at which a SPECIFIC frequency becomes usable on this
// path, scanning forward from `fromUtcHour`. A frequency can be unusable now
// for opposite reasons (above the MUF, or below the LUF) that resolve at
// different times, so this is per-frequency, unlike nextOpenWindow. Returns
// { utcHour, inHours } or null.
export function nextUsableHour(params, freqMHz, fromUtcHour) {
  var start = (typeof fromUtcHour === 'number' && isFinite(fromUtcHour)) ? fromUtcHour : 0;
  for (var i = 1; i <= 24; i++) {
    var h = (start + i) % 24;
    var a = assessFrequency(Object.assign({}, params, { utcHour: h, freqMHz: freqMHz }));
    if (a && a.verdict && a.verdict.ok) return { utcHour: h, inHours: i };
  }
  return null;
}

// Rank a list of ASSIGNED frequencies for a path at a given hour — the real
// field question: of the handful I was issued, which closes now, and which
// closes when? Best-first: usable now (GOOD before marginal), then those that
// open later (soonest first), then never. Each entry carries its verdict now
// and, if not usable now, the next hour it becomes usable.
export function rankAssignedFrequencies(params, freqs, fromUtcHour) {
  var start = (typeof fromUtcHour === 'number' && isFinite(fromUtcHour)) ? fromUtcHour : 12;
  var rank = { good: 0, low: 1, near_muf: 2 };   // usable-now ordering
  var out = (freqs || []).filter(function(f) {
    return typeof f === 'number' && isFinite(f) && f > 0;
  }).map(function(f) {
    var a = assessFrequency(Object.assign({}, params, { utcHour: start, freqMHz: f }));
    var ok = !!(a && a.verdict && a.verdict.ok);
    return {
      freqMHz: f,
      verdict: a ? a.verdict : null,
      muf: a ? a.muf : null, fot: a ? a.fot : null, luf: a ? a.luf : null,
      usableNow: ok,
      next: ok ? null : nextUsableHour(params, f, start),
    };
  });
  out.sort(function(x, y) {
    if (x.usableNow && y.usableNow) {
      var rx = rank[x.verdict && x.verdict.code] != null ? rank[x.verdict.code] : 9;
      var ry = rank[y.verdict && y.verdict.code] != null ? rank[y.verdict.code] : 9;
      if (rx !== ry) return rx - ry;
      return y.fot - x.fot;                 // among equal verdicts, higher FOT margin first
    }
    if (x.usableNow !== y.usableNow) return x.usableNow ? -1 : 1;
    // both closed now: sooner-opening first, never-opening last
    var xi = x.next ? x.next.inHours : 999;
    var yi = y.next ? y.next.inHours : 999;
    return xi - yi;
  });
  return out;
}

// The next hour (UTC) at which a currently-closed path opens, scanning forward
// from `fromUtcHour`. Returns { utcHour, inHours } or null if it stays closed
// all day. Used to turn a bare "PATH CLOSED" into "opens ~0430Z (in 3h40m)".
export function nextOpenWindow(params, fromUtcHour) {
  var start = (typeof fromUtcHour === 'number' && isFinite(fromUtcHour)) ? fromUtcHour : 0;
  for (var i = 1; i <= 24; i++) {
    var h = (start + i) % 24;
    var a = assessFrequency(Object.assign({}, params, { utcHour: h, freqMHz: null }));
    if (a && !a.pathClosed) {
      return { utcHour: h, inHours: i };
    }
  }
  return null;
}

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
      modipDeg: params.modipDeg,
      ends: params.ends,
      bounces: params.bounces,
      txWatts: params.txWatts,
      hops: params.hops,
      distKm: params.distKm,
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
