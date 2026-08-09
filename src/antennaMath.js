// ── ANTENNA MATH ──────────────────────────────────────────────────────────────
// Pure physics/math for the HF Field Antenna Calculator: wire velocity-factor
// model, wavelength, length formatting, and apex-height planning.
// No React, no DOM — everything here is unit-testable with `npm test`.
//
// This module is part of the original work of Cpl Angeles-Gonzalez, Ezekiel S.,
// United States Marine Corps. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────

// AWG (American Wire Gauge) → diameter in inches and mm.
// Common HF antenna gauges plus a few extremes for completeness.
export const WIRE_GAUGES = {
  '10': { dia_in: 0.1019, dia_mm: 2.588, label: '10 AWG (heavy)', strength: 'very strong, hard to handle' },
  '12': { dia_in: 0.0808, dia_mm: 2.053, label: '12 AWG', strength: 'strong, good for permanent installs' },
  '14': { dia_in: 0.0641, dia_mm: 1.628, label: '14 AWG (common)', strength: 'standard ham antenna wire' },
  '16': { dia_in: 0.0508, dia_mm: 1.291, label: '16 AWG', strength: 'lighter, easier to deploy' },
  '18': { dia_in: 0.0403, dia_mm: 1.024, label: '18 AWG', strength: 'lightweight, OK for portable' },
  '20': { dia_in: 0.0320, dia_mm: 0.8128, label: '20 AWG (light)', strength: 'fragile but lightweight' },
  '22': { dia_in: 0.0253, dia_mm: 0.6438, label: '22 AWG (speaker wire)', strength: 'breaks easily, field-expedient only' },
  '24': { dia_in: 0.0201, dia_mm: 0.5106, label: '24 AWG (very light)', strength: 'last-resort, will break' },
};

// Core material → base velocity factor (assuming average HF gauge of 14 AWG)
// and field operational notes.
export const WIRE_CORES = {
  copper_bare: {
    label: 'Bare Copper',
    short: 'COPPER',
    vf_base: 0.95,
    quality: 'excellent',
    note: 'Standard. Best RF conductor. Use this if you have it.',
  },
  copper_stranded: {
    label: 'Stranded Copper',
    short: 'STRANDED CU',
    vf_base: 0.94,
    quality: 'excellent',
    note: 'Slightly more flexible. RF performance nearly identical to solid.',
  },
  copper_insulated: {
    label: 'Insulated Copper (PVC)',
    short: 'INSUL CU',
    vf_base: 0.93,
    quality: 'good',
    note: 'PVC slightly slows the wave. Cut ~2% shorter than bare copper.',
  },
  copper_clad_steel: {
    label: 'Copper-Clad Steel (CCS)',
    short: 'CCS',
    vf_base: 0.95,
    quality: 'excellent',
    note: 'Acts like copper at HF (skin effect). Common in commercial antennas.',
  },
  galvanized_steel: {
    label: 'Galvanized Steel',
    short: 'GALV STEEL',
    vf_base: 0.90,
    quality: 'fair',
    note: 'Cheap, strong, common in field-expedient antennas. ~1 dB extra loss vs copper.',
  },
  stainless_steel: {
    label: 'Stainless Steel',
    short: 'STAINLESS',
    vf_base: 0.89,
    quality: 'fair',
    note: 'Higher loss than galv steel. Use if corrosion-resistant wire is needed.',
  },
  iron: {
    label: 'Plain Iron / Mystery Wire',
    short: 'IRON',
    vf_base: 0.85,
    quality: 'poor',
    note: 'Field-expedient only — barbed wire, fence wire, baling wire, unknown salvage. Significant RF loss (~3-5 dB). Will radiate but inefficiently. USE WHAT YOU GOT.',
  },
  speaker_wire: {
    label: 'Speaker Wire / Lamp Cord',
    short: 'SPEAKER WIRE',
    vf_base: 0.92,
    quality: 'fair',
    note: 'Insulated copper, usually 18-22 AWG. Works fine for low-power HF. Cut both conductors and run them as parallel halves of a dipole, or just use one strand.',
  },
};

// Gauge-correction factor: thicker wire has slightly lower K-factor because
// the diameter/wavelength ratio is bigger → more end capacitance → wire must
// be slightly shorter than ideal. Thinner wire = closer to ideal-thin
// conductor = K closer to 1.0.
//
// Reference: ARRL Antenna Book empirical K-factor table for HF dipoles.
// 14 AWG is the baseline. We use ~0.3-0.5% per AWG step from there.
export function gaugeCorrection(awg) {
  var awgNum = parseFloat(awg);
  if (isNaN(awgNum)) return 1.0;
  // delta = (this gauge) - (baseline 14 AWG). Positive = thinner than 14.
  var delta = awgNum - 14;
  if (delta > 0) return 1.0 + (delta * 0.003); // thinner: VF goes UP slightly
  return 1.0 + (delta * 0.005);                // thicker: VF goes DOWN slightly
}

// Compute effective velocity factor given core type and gauge.
export function computeVF(coreKey, gaugeAwg) {
  var core = WIRE_CORES[coreKey];
  if (!core) return 0.95;
  var baseVF = core.vf_base;
  var corr = gaugeCorrection(gaugeAwg);
  var effective = baseVF * corr;
  // Clamp to physically reasonable range
  if (effective < 0.80) effective = 0.80;
  if (effective > 0.99) effective = 0.99;
  return Math.round(effective * 1000) / 1000; // 3 decimal places
}

export function wavelength(freqMHz, vf) {
  vf = vf === undefined ? 1 : vf;
  return (299.792458 / freqMHz) * vf;
}

export function toLengths(meters) {
  var totalInches = meters * 39.3701;
  var ft = Math.floor(totalInches / 12);
  var inches = Math.round(totalInches % 12);
  if (inches === 12) { ft++; inches = 0; }
  return { ftIn: ft + ' ft ' + inches + ' in', m: meters.toFixed(2) };
}

// ── APEX HEIGHT PLANNING ──────────────────────────────────────────────────────
// For skywave dipole-family antennas: the support height that puts the first
// elevation lobe at the takeoff angle needed for the target path, checked
// against what the geometry can physically reach.
//
//   required height H = λ / (4·sin α)      (first-lobe peak at angle α)
//
// The takeoff angle should come from the terrain-aware directive when
// available (per-hop, obstacle-adjusted). The internal fallback is per-hop
// flat-earth geometry: α = atan(2·h_F2 / hopDist), hopDist = distKm / hops.
//
// For an inverted-V the mast height is also geometry-limited: with ¼-wave
// legs staked at legEndM above ground the apex cannot exceed
//   maxApex = legEndM + leg × sin(55°)
// (55° = steepest recommended leg slope — apex angle 70°, the same threshold
// the geometry planner warns at.)

export const F2_HEIGHT_KM = 360;   // effective F2 virtual reflection height — matches HOP.F2.hKm
export const F2_MAX_HOP_KM = 4500; // matches HOP.F2.maxHopKm
const MAX_LEG_SLOPE_DEG = 55;
const PRACTICAL_MAST_FT = 60; // beyond typical field mast/tree reach

var FT_PER_M = 3.28084;
var DEG = Math.PI / 180;

// params: {
//   kind:       'invertedv' | 'dipole' | 'nvis'
//   wlMeters:   velocity-factor-adjusted wavelength (m)
//   distKm:     path distance (km)
//   legEndM:    height of the leg ends above ground (m) — inverted-V only
//   takeoffDeg: optional terrain-aware takeoff angle (deg); fallback computed
// }
// Returns null for bad input, {kind:'nvis',...} for NVIS antennas, or
// {kind:'apex', feasible, practical, ...} for skywave dipole/inverted-V.
export function apexHeightPlan(params) {
  var kind = params.kind;
  var wl = params.wlMeters;
  var distKm = params.distKm;
  if (typeof wl !== 'number' || !isFinite(wl) || wl <= 0) return null;
  if (typeof distKm !== 'number' || !isFinite(distKm) || distKm <= 0) return null;

  if (kind === 'nvis') {
    // NVIS radiation must go nearly straight up — distance optimization does
    // not apply. Report the 0.1 λ ceiling under which vertical radiation
    // dominates (field practice: 8–10 ft).
    return { kind: 'nvis', tenthWlM: 0.1 * wl, tenthWlFt: 0.1 * wl * FT_PER_M };
  }
  if (kind !== 'invertedv' && kind !== 'dipole') return null;

  var hops = Math.max(1, Math.ceil(distKm / F2_MAX_HOP_KM));
  var takeoffDeg = params.takeoffDeg;
  if (typeof takeoffDeg !== 'number' || !isFinite(takeoffDeg) || takeoffDeg <= 0 || takeoffDeg > 90) {
    // Curved-earth per-hop fallback (same geometry as calcTakeoffAngle's
    // baseline in propagation.js): α = atan[(cosθ − R/(R+h)) / sinθ],
    // θ = hopDist/2R. Clamped to the same 3–85° operational window so the
    // first-lobe height H = λ/(4·sinα) stays finite near the hop limit.
    var R = 6371; // matches EARTH_RADIUS_KM in propagation.js
    var theta = (distKm / hops) / (2 * R);
    takeoffDeg = Math.atan2(Math.cos(theta) - R / (R + F2_HEIGHT_KM), Math.sin(theta)) / DEG;
    takeoffDeg = Math.max(3, Math.min(85, takeoffDeg));
  }

  var legM = wl / 4;
  var endM = (typeof params.legEndM === 'number' && params.legEndM >= 0) ? params.legEndM : 0.0762;
  var optM = wl / (4 * Math.sin(takeoffDeg * DEG));

  var recM = optM;
  var feasible = true;
  var actualTakeoffDeg = takeoffDeg;
  var endNeededM = null;
  if (kind === 'invertedv') {
    var maxApexM = endM + legM * Math.sin(MAX_LEG_SLOPE_DEG * DEG);
    if (optM > maxApexM) {
      feasible = false;
      recM = maxApexM;
      // Lobe angle actually achieved at the buildable height
      var sinArg = wl / (4 * recM);
      actualTakeoffDeg = sinArg >= 1 ? 90 : Math.asin(sinArg) / DEG;
      // End height that would make the optimal apex reachable
      endNeededM = optM - legM * Math.sin(MAX_LEG_SLOPE_DEG * DEG);
    }
  }

  return {
    kind: 'apex',
    apexM: recM, apexFt: recM * FT_PER_M,
    optM: optM, optFt: optM * FT_PER_M,
    feasible: feasible,
    practical: recM * FT_PER_M <= PRACTICAL_MAST_FT,
    actualTakeoffDeg: actualTakeoffDeg,
    endNeededM: endNeededM, endNeededFt: endNeededM === null ? null : endNeededM * FT_PER_M,
    legM: legM, legFt: legM * FT_PER_M,
    endM: endM, endIn: endM / 0.0254,
    takeoffDeg: takeoffDeg,
    hops: hops,
  };
}
