// Unit tests for antennaMath.js — run with `npm test` (node --test).
// These pin the physics so future edits can't silently change cut lengths
// or apex-height recommendations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIRE_CORES, WIRE_GAUGES, gaugeCorrection, computeVF,
  wavelength, toLengths, apexHeightPlan, F2_HEIGHT_KM,
} from '../../src/physics/antennaMath.js';

function approx(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol,
    (msg || '') + ' expected ' + expected + ' ±' + tol + ', got ' + actual);
}

test('gaugeCorrection: 14 AWG is the 1.0 baseline', function() {
  assert.equal(gaugeCorrection('14'), 1.0);
  assert.equal(gaugeCorrection(14), 1.0);
});

test('gaugeCorrection: thinner wire +0.3%/step, thicker −0.5%/step', function() {
  approx(gaugeCorrection('18'), 1.012, 1e-9); // 4 steps thinner
  approx(gaugeCorrection('12'), 0.990, 1e-9); // 2 steps thicker
  assert.equal(gaugeCorrection('not-a-number'), 1.0);
});

test('computeVF: known core/gauge combinations', function() {
  assert.equal(computeVF('stainless_steel', '14'), 0.89);
  assert.equal(computeVF('copper_bare', '14'), 0.95);
  assert.equal(computeVF('copper_clad_steel', '18'), 0.961);
  assert.equal(computeVF('iron', '18'), 0.86);
  assert.equal(computeVF('nonexistent_core', '14'), 0.95); // fallback
});

test('computeVF: clamps to [0.80, 0.99]', function() {
  // iron at 2 AWG: 0.85 × (1 − 12×0.005) = 0.799 → clamped up to 0.80
  assert.equal(computeVF('iron', '2'), 0.80);
});

test('wavelength: c/f scaled by VF', function() {
  approx(wavelength(14.230, 0.961), 20.25, 0.01);
  approx(wavelength(7.3), 41.07, 0.01); // VF defaults to 1 (free space)
});

test('toLengths: formats ft/in with 12-inch rollover', function() {
  assert.equal(toLengths(0.3048).ftIn, '1 ft 0 in');
  assert.equal(toLengths(6.007).m, '6.01');
});

test('apexHeightPlan: rejects bad input', function() {
  assert.equal(apexHeightPlan({ kind: 'invertedv', wlMeters: 0, distKm: 500 }), null);
  assert.equal(apexHeightPlan({ kind: 'invertedv', wlMeters: 20, distKm: -1 }), null);
  assert.equal(apexHeightPlan({ kind: 'sloper', wlMeters: 20, distKm: 500 }), null);
});

test('apexHeightPlan: NVIS kind returns the 0.1λ ceiling, no apex', function() {
  var wl = wavelength(7.3, 0.95);
  var plan = apexHeightPlan({ kind: 'nvis', wlMeters: wl, distKm: 200 });
  assert.equal(plan.kind, 'nvis');
  approx(plan.tenthWlFt, 12.8, 0.1);
});

test('apexHeightPlan: reference case — 11.104 MHz stainless, 770 km inverted-V', function() {
  var wl = wavelength(11.104, 0.89);
  var plan = apexHeightPlan({ kind: 'invertedv', wlMeters: wl, distKm: 770, legEndM: 0.0762 });
  assert.equal(plan.kind, 'apex');
  assert.equal(plan.feasible, false);          // optimal exceeds leg geometry
  approx(plan.takeoffDeg, 40.5, 0.1);          // curved-earth, F2 virtual 360 km
  approx(plan.optFt, 30.3, 0.2);               // radiation-optimal first lobe
  approx(plan.apexFt, 16.4, 0.2);              // buildable max: end + leg·sin55°
  approx(plan.legFt, 19.7, 0.1);
  assert.equal(plan.actualTakeoffDeg, 90);     // λ/(4·h) > 1 at buildable height
  approx(plan.endNeededFt, 14.2, 0.2);
  assert.equal(plan.hops, 1);
});

test('apexHeightPlan: flat dipole is always geometrically feasible', function() {
  var wl = wavelength(11.104, 0.89);
  var plan = apexHeightPlan({ kind: 'dipole', wlMeters: wl, distKm: 770 });
  assert.equal(plan.feasible, true);
  approx(plan.apexFt, plan.optFt, 1e-9);
});

test('apexHeightPlan: supplied terrain-aware takeoff angle wins over fallback', function() {
  var wl = wavelength(11.104, 0.89);
  var plan = apexHeightPlan({ kind: 'dipole', wlMeters: wl, distKm: 770, takeoffDeg: 25 });
  approx(plan.takeoffDeg, 25, 1e-9);
  approx(plan.apexM, wl / (4 * Math.sin(25 * Math.PI / 180)), 1e-9);
  // Invalid supplied angle falls back to internal curved-earth geometry
  var fb = apexHeightPlan({ kind: 'dipole', wlMeters: wl, distKm: 770, takeoffDeg: NaN });
  var R = 6371, theta = 770 / (2 * R);
  var curved = Math.atan2(Math.cos(theta) - R / (R + F2_HEIGHT_KM), Math.sin(theta)) * 180 / Math.PI;
  approx(fb.takeoffDeg, curved, 0.01);
});

test('apexHeightPlan: long paths split into hops for the fallback angle', function() {
  var wl = wavelength(14.2, 0.95);
  var plan = apexHeightPlan({ kind: 'dipole', wlMeters: wl, distKm: 9000 });
  // 9000 km needs 3 hops, not 2: one hop is capped at maxHopKm(360) ~= 4186 km,
  // so 4500 km/hop is beyond the geometric limit. This test previously asserted
  // 2 because F2_MAX_HOP_KM was a stale hardcoded 4500 (VALIDATION Part 33).
  assert.equal(plan.hops, 3);
  assert.ok(plan.takeoffDeg > 3 && plan.takeoffDeg < 12,
    'a 3000 km hop launches at a real low angle, not the 3 floor: ' + plan.takeoffDeg);
  assert.equal(plan.practical, false);
});

test('apexHeightPlan: practical flag trips above 60 ft', function() {
  // 7.3 MHz at 18° takeoff → H ≈ 0.81λ ≈ 104 ft: correct but impractical
  var wl = wavelength(7.3, 0.95);
  var plan = apexHeightPlan({ kind: 'dipole', wlMeters: wl, distKm: 1900, takeoffDeg: 18 });
  assert.equal(plan.practical, false);
  assert.equal(plan.feasible, true);
});

test('data tables: every core has a physical VF, every gauge a diameter', function() {
  Object.keys(WIRE_CORES).forEach(function(k) {
    var vf = WIRE_CORES[k].vf_base;
    assert.ok(vf >= 0.80 && vf < 1.0, k + ' vf_base out of range: ' + vf);
  });
  Object.keys(WIRE_GAUGES).forEach(function(k) {
    assert.ok(WIRE_GAUGES[k].dia_mm > 0, k + ' missing diameter');
  });
});
