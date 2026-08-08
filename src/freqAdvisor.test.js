// Unit tests for freqAdvisor.js — run with `npm test` (node --test).
// Values pinned against published ionospheric behaviour; the MUF model is
// separately compared against VOACAP in docs/VALIDATION.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SSN, sfiToSSN, localSolarTime, diurnalFactor, estimateFoF2,
  secantFactor, classifyFrequency, assessFrequency,
  FOF2_PEAK_HOUR, FOF2_NIGHT_RATIO, seasonLatitudeFactor,
  frequencyForecast, bestBlocks,
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

// ── 24-hour forecast ─────────────────────────────────────────────────────────

test('frequencyForecast: six 4-hour blocks covering the whole day', function() {
  var f = frequencyForecast({ takeoffDeg: 80, layerKm: 360, midLon: -84, sfi: null, freqMHz: 7.9 });
  assert.equal(f.length, 6);
  assert.deepEqual(f.map(function(b) { return b.startZ; }), [0, 4, 8, 12, 16, 20]);
  assert.equal(f[5].endZ, 0, 'last block wraps to 00Z');
  f.forEach(function(b) {
    assert.ok(b.muf > 0 && b.fot > 0 && b.luf > 0, 'finite values');
    approx(b.fot, 0.85 * b.muf, 1e-9);
    assert.ok(b.verdict, 'verdict present when a frequency is supplied');
  });
});

test('frequencyForecast: honours block size and rejects sizes that do not divide 24', function() {
  assert.equal(frequencyForecast({ takeoffDeg: 40, layerKm: 360, blockHours: 6 }).length, 4);
  assert.equal(frequencyForecast({ takeoffDeg: 40, layerKm: 360, blockHours: 5 }).length, 6, 'falls back to 4 h');
});

test('frequencyForecast: flags exactly one current block', function() {
  var f = frequencyForecast({ takeoffDeg: 80, layerKm: 360, midLon: 0, nowUtcHour: 22.7 });
  assert.equal(f.filter(function(b) { return b.isNow; }).length, 1);
  assert.equal(f.find(function(b) { return b.isNow; }).startZ, 20);
  // wraps correctly at midnight and handles out-of-range input
  assert.equal(frequencyForecast({ takeoffDeg: 80, layerKm: 360, nowUtcHour: 0 }).find(function(b) { return b.isNow; }).startZ, 0);
  assert.equal(frequencyForecast({ takeoffDeg: 80, layerKm: 360 }).filter(function(b) { return b.isNow; }).length, 0);
});

test('frequencyForecast: MUF peaks in the local-afternoon block', function() {
  // midLon 0 → the 12-16Z block straddles local solar noon
  var f = frequencyForecast({ takeoffDeg: 80, layerKm: 360, midLon: 0, sfi: null });
  var peak = f.reduce(function(a, b) { return b.muf > a.muf ? b : a; });
  assert.equal(peak.startZ, 12, 'peak block should contain local noon, got ' + peak.startZ);
  var trough = f.reduce(function(a, b) { return b.muf < a.muf ? b : a; });
  assert.equal(trough.startZ, 0, 'trough block should be pre-dawn, got ' + trough.startZ);
});

test('bestBlocks: ranks usable blocks, null when nothing works', function() {
  var f = frequencyForecast({ takeoffDeg: 80, layerKm: 360, midLon: -84, sfi: null, freqMHz: 7.9 });
  var best = bestBlocks(f, 7.9);
  assert.ok(best && best.length, 'some block should work for 7.9 MHz');
  assert.ok(best[0].verdict.ok);
  // A frequency far above any MUF has no usable block
  var f2 = frequencyForecast({ takeoffDeg: 80, layerKm: 360, midLon: -84, sfi: null, freqMHz: 45 });
  assert.equal(bestBlocks(f2, 45), null);
  assert.equal(bestBlocks(null, 7), null);
});


// ── SEASON + LATITUDE ────────────────────────────────────────────────────────
// Behaviour pinned against the VOACAP seasonal study (docs/VALIDATION.md) and
// the textbook anomalies it reproduces.

test('seasonLatitudeFactor: no-op when month and latitude are unknown', function() {
  assert.equal(seasonLatitudeFactor(12, undefined, undefined), 1);
  assert.equal(seasonLatitudeFactor(12, null, null), 1);
  assert.equal(seasonLatitudeFactor(12, 13, 40), seasonLatitudeFactor(12, undefined, 40),
    'out-of-range month is ignored, not clamped');
  // Backwards compatible: estimateFoF2 with no season args is unchanged.
  assert.equal(estimateFoF2(70, 12), estimateFoF2(70, 12, undefined, undefined));
});

test('seasonLatitudeFactor: winter anomaly — daytime foF2 higher in local winter', function() {
  // 55 deg magnetic north, local noon. January (winter) must beat July.
  var jan = seasonLatitudeFactor(12, 1, 55);
  var jul = seasonLatitudeFactor(12, 7, 55);
  assert.ok(jan > jul, 'northern mid-lat noon: Jan ' + jan.toFixed(3) + ' should exceed Jul ' + jul.toFixed(3));
});

test('seasonLatitudeFactor: night ordering reverses — summer nights are better', function() {
  var jan = seasonLatitudeFactor(0, 1, 55);   // northern winter night
  var jul = seasonLatitudeFactor(0, 7, 55);   // northern summer night
  assert.ok(jul > jan, 'northern mid-lat midnight: Jul should exceed Jan');
});

test('seasonLatitudeFactor: hemispheres are mirrored', function() {
  // New Zealand vs Finland in the same month must land on opposite sides of
  // the seasonal cycle — this is the whole reason the model takes latitude.
  var finlandJan = seasonLatitudeFactor(12, 1, 55);
  var nzJan = seasonLatitudeFactor(12, 1, -55);
  assert.ok(finlandJan > nzJan, 'January noon: northern winter should beat southern summer');
  var finlandJul = seasonLatitudeFactor(12, 7, 55);
  var nzJul = seasonLatitudeFactor(12, 7, -55);
  assert.ok(nzJul > finlandJul, 'July noon: southern winter should beat northern summer');
});

test('seasonLatitudeFactor: the day/night reversal is mid-latitude only', function() {
  // The winter anomaly is a mid- and high-latitude effect: noon peaks in local
  // winter while midnight peaks in local summer. Near the magnetic equator
  // that reversal disappears and the year is governed by the equinox peaks
  // instead, so day and night move together.
  function ratio(hour, lat) { return seasonLatitudeFactor(hour, 1, lat) / seasonLatitudeFactor(hour, 7, lat); }
  assert.ok(ratio(12, 55) > 1, 'mid-lat noon should favour January (northern winter)');
  assert.ok(ratio(0, 55) < 1, 'mid-lat midnight should favour July (northern summer)');
  assert.ok(ratio(12, 5) > 1 && ratio(0, 5) > 1, 'equatorial day and night should move together');
  // And the size of the reversal grows with latitude.
  function split(lat) { return Math.abs(Math.log(ratio(12, lat)) - Math.log(ratio(0, lat))); }
  assert.ok(split(60) > split(40), 'reversal should widen toward the pole');
  assert.ok(split(40) > split(10), 'reversal should narrow toward the equator');
});

test('seasonLatitudeFactor: low latitudes run a higher foF2 than high ones', function() {
  // Averaged over the year so the seasonal term cannot carry the comparison.
  function annual(lat) {
    var s = 0;
    for (var m = 1; m <= 12; m++) s += seasonLatitudeFactor(12, m, lat);
    return s / 12;
  }
  assert.ok(annual(5) > annual(60), 'equatorial annual mean should exceed polar');
});

test('seasonLatitudeFactor: stays in a physical range everywhere', function() {
  for (var lat = -80; lat <= 80; lat += 5) {
    for (var m = 1; m <= 12; m++) {
      for (var h = 0; h < 24; h += 3) {
        var f = seasonLatitudeFactor(h, m, lat);
        assert.ok(f > 0.5 && f < 1.6, 'factor out of range at lat ' + lat + ' month ' + m + ' hour ' + h + ': ' + f);
      }
    }
  }
});

test('assessFrequency and frequencyForecast carry season through', function() {
  var base = { takeoffDeg: 8, layerKm: 360, midLon: 25, utcHour: 10, sfi: null, freqMHz: 14.2 };
  var jan = assessFrequency(Object.assign({}, base, { month: 1, magLatDeg: 55 }));
  var jul = assessFrequency(Object.assign({}, base, { month: 7, magLatDeg: 55 }));
  assert.ok(jan.muf !== jul.muf, 'month must change the MUF');
  var none = assessFrequency(base);
  assert.equal(none.muf, assessFrequency(Object.assign({}, base, { month: null, magLatDeg: null })).muf);

  var fJan = frequencyForecast({ takeoffDeg: 8, layerKm: 360, midLon: 25, sfi: null, month: 1, magLatDeg: 55 });
  var fJul = frequencyForecast({ takeoffDeg: 8, layerKm: 360, midLon: 25, sfi: null, month: 7, magLatDeg: 55 });
  assert.ok(fJan.some(function(b, i) { return b.muf !== fJul[i].muf; }), 'forecast must respond to month');
});
