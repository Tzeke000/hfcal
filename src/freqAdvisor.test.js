// Unit tests for freqAdvisor.js — run with `npm test` (node --test).
// Values pinned against published ionospheric behaviour; the MUF model is
// separately compared against VOACAP in docs/VALIDATION.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SSN, sfiToSSN, localSolarTime, diurnalFactor, estimateFoF2,
  secantFactor, classifyFrequency, assessFrequency,
  FOF2_PEAK_HOUR, FOF2_NIGHT_RATIO,
} from './freqAdvisor.js';

function approx(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol,
    (msg || '') + ' expected ' + expected + ' ±' + tol + ', got ' + actual);
}

test('sfiToSSN: inverts the standard SFI/SSN relation', function() {
  assert.equal(sfiToSSN(63.75), 0);
  assert.equal(sfiToSSN(50), 0);           // floor, never negative
  approx(sfiToSSN(145), 100, 2);           // SFI 145 ≈ SSN 100 (forward relation)
  approx(sfiToSSN(136), 89, 2);
  approx(sfiToSSN(70), 8, 3);
  assert.equal(sfiToSSN(null), null);      // unknown stays unknown
  assert.equal(sfiToSSN('x'), null);
});

test('localSolarTime: longitude offset, wraps 0-24', function() {
  approx(localSolarTime(12, 0), 12, 1e-9);       // Greenwich noon
  approx(localSolarTime(12, -120), 4, 1e-9);     // 8 h behind
  approx(localSolarTime(2, -120), 18, 1e-9);     // wraps negative
  approx(localSolarTime(23, 60), 3, 1e-9);       // wraps past 24
});

test('diurnalFactor: peaks early afternoon, bottoms 12 h later', function() {
  approx(diurnalFactor(FOF2_PEAK_HOUR), 1, 1e-9);
  approx(diurnalFactor(FOF2_PEAK_HOUR - 12), 0, 1e-9);
  // Symmetric about the peak, and the exponent keeps mornings/evenings below
  // the plain cosine midpoint (faster post-sunset decay).
  approx(diurnalFactor(FOF2_PEAK_HOUR - 6), diurnalFactor(FOF2_PEAK_HOUR + 6), 1e-9);
  assert.ok(diurnalFactor(FOF2_PEAK_HOUR - 6) < 0.5);
});

test('estimateFoF2: stays inside published mid-latitude ranges', function() {
  var night = FOF2_PEAK_HOUR - 12;
  // Solar minimum: published noon ~6-8 MHz, night ~3 MHz
  approx(estimateFoF2(10, FOF2_PEAK_HOUR), 7.2, 0.1, 'solar min noon');
  approx(estimateFoF2(10, night), 3.2, 0.1, 'solar min night');
  // Solar maximum: published noon ~12-15 MHz, night ~5-6 MHz
  approx(estimateFoF2(150, FOF2_PEAK_HOUR), 12.2, 0.1, 'solar max noon');
  approx(estimateFoF2(150, night), 5.5, 0.1, 'solar max night');
  // Night is a fixed fraction of that day's peak
  approx(estimateFoF2(70, night), FOF2_NIGHT_RATIO * estimateFoF2(70, FOF2_PEAK_HOUR), 1e-9);
  // Monotonic in solar activity
  assert.ok(estimateFoF2(150, FOF2_PEAK_HOUR) > estimateFoF2(10, FOF2_PEAK_HOUR));
});

test('secantFactor: 1.0 at vertical incidence, ~3x at low angles', function() {
  approx(secantFactor(90, 360), 1.0, 1e-6, 'NVIS: MUF == foF2');
  var low = secantFactor(3, 360);
  assert.ok(low > 2.8 && low < 3.6, 'low-angle M factor ~3, got ' + low);
  // Monotonic: lower takeoff angle → bigger multiplier
  assert.ok(secantFactor(10, 360) > secantFactor(45, 360));
});

test('classifyFrequency: the four failure/success bands', function() {
  var muf = 20, luf = 4;
  assert.equal(classifyFrequency(25, muf, luf).code, 'above_muf');
  assert.equal(classifyFrequency(25, muf, luf).ok, false);
  assert.equal(classifyFrequency(3, muf, luf).code, 'below_luf');
  assert.equal(classifyFrequency(19, muf, luf).code, 'near_muf');
  assert.equal(classifyFrequency(19, muf, luf).ok, true);
  assert.equal(classifyFrequency(8, muf, luf).code, 'low');
  assert.equal(classifyFrequency(14, muf, luf).code, 'good');
});

test('assessFrequency: NVIS midday, assigned frequency in the window', function() {
  // Straight-up shot: takeoff 90° → MUF == foF2
  var r = assessFrequency({ takeoffDeg: 90, layerKm: 360, midLon: 0, utcHour: 12.8, sfi: 145, freqMHz: 7.1 });
  approx(r.ssn, 100, 2);
  approx(r.mFactor, 1.0, 1e-6);
  approx(r.muf, r.foF2, 1e-9);
  assert.ok(r.muf > 10 && r.muf < 12, 'NVIS MUF near foF2 at SSN 100: ' + r.muf);
  approx(r.fot, 0.85 * r.muf, 1e-9);
  assert.equal(r.verdict.ok, true);
  assert.equal(r.usingDefaultSolar, false);
});

test('assessFrequency: DX low-angle raises MUF well above foF2', function() {
  var r = assessFrequency({ takeoffDeg: 5, layerKm: 360, midLon: 0, utcHour: 12.8, sfi: 145, freqMHz: 28 });
  assert.ok(r.muf > 3 * r.foF2 * 0.9, 'low angle should roughly triple foF2');
  assert.equal(r.verdict.ok, 28 <= r.muf);   // verdict consistent with the computed MUF
});

test('assessFrequency: night NVIS on a high frequency fails above MUF', function() {
  // 02:00 local, solar min, 14 MHz straight up — classic punch-through
  var r = assessFrequency({ takeoffDeg: 90, layerKm: 360, midLon: 0, utcHour: 0.8, sfi: 70, freqMHz: 14.2 });
  assert.equal(r.verdict.code, 'above_muf');
  assert.equal(r.verdict.ok, false);
  assert.ok(r.muf < 5, 'night solar-min NVIS MUF should be low: ' + r.muf);
});

test('assessFrequency: works fully offline with the documented default', function() {
  var r = assessFrequency({ takeoffDeg: 40, layerKm: 360, midLon: -116, utcHour: 20, sfi: null, freqMHz: 11.1 });
  assert.equal(r.usingDefaultSolar, true);
  assert.equal(r.ssn, DEFAULT_SSN);
  assert.ok(r.muf > 0 && isFinite(r.muf));
  assert.ok(r.verdict !== null, 'still produces a verdict with no solar data');
});

test('assessFrequency: LUF tracks daylight, suggestion stays inside the window', function() {
  var day = assessFrequency({ takeoffDeg: 40, layerKm: 360, midLon: 0, utcHour: 12.8, sfi: 145 });
  var night = assessFrequency({ takeoffDeg: 40, layerKm: 360, midLon: 0, utcHour: 0.8, sfi: 145 });
  assert.ok(day.luf > night.luf, 'daytime absorption raises LUF');
  approx(night.luf, 2.0, 0.01);
  [day, night].forEach(function(r) {
    assert.ok(r.suggestedMHz <= r.muf + 1e-9, 'suggestion never above MUF');
    assert.ok(r.suggestedMHz >= Math.min(r.luf, r.muf) - 1e-9, 'suggestion never below LUF');
  });
});

test('assessFrequency: rejects unusable input', function() {
  assert.equal(assessFrequency({ takeoffDeg: NaN, layerKm: 360 }), null);
  assert.equal(assessFrequency({ takeoffDeg: 40, layerKm: 0 }), null);
  // No frequency supplied → stats but no verdict
  var r = assessFrequency({ takeoffDeg: 40, layerKm: 360, utcHour: 12 });
  assert.equal(r.verdict, null);
  assert.ok(r.muf > 0);
});
