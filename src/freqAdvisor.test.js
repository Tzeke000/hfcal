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
  solarDeclination, cosZenith, illuminationFactor,
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


// ── SOLAR GEOMETRY ───────────────────────────────────────────────────────────
// The model is driven by the sun's actual height over the reflection point.
// Pinned against astronomy and against the VOACAP fit in docs/VALIDATION.md
// Parts 3 and 6.

test('solarDeclination: solstices and equinoxes land where they should', function() {
  assert.ok(solarDeclination(6) > 22, 'June should be near +23.44, got ' + solarDeclination(6));
  assert.ok(solarDeclination(12) < -22, 'December should be near -23.44, got ' + solarDeclination(12));
  assert.ok(Math.abs(solarDeclination(3)) < 5, 'March should be near 0, got ' + solarDeclination(3));
  assert.ok(Math.abs(solarDeclination(9)) < 5, 'September should be near 0, got ' + solarDeclination(9));
});

test('cosZenith: sun overhead at the subsolar point, below the horizon at night', function() {
  // Equator at equinox, local noon: sun straight up.
  assert.ok(Math.abs(cosZenith(0, 12, 0) - 1) < 1e-9);
  // Same place at midnight: directly underfoot.
  assert.ok(Math.abs(cosZenith(0, 0, 0) + 1) < 1e-9);
  // Tropic of Cancer at the June solstice, local noon: overhead again.
  assert.ok(cosZenith(23.44, 12, solarDeclination(6)) > 0.999);
  // Sunrise/sunset at the equator on the equinox is 06 and 18.
  assert.ok(Math.abs(cosZenith(0, 6, 0)) < 1e-9);
  assert.ok(Math.abs(cosZenith(0, 18, 0)) < 1e-9);
});

test('illuminationFactor: polar day and polar night are handled without special cases', function() {
  // 78 N in June: the sun never sets, so even local midnight stays lit.
  var midnightJun = illuminationFactor(78, 0, 6);
  var noonJun = illuminationFactor(78, 12, 6);
  assert.ok(midnightJun > 0.3 * noonJun,
    'polar day midnight should stay lit, got ' + midnightJun.toFixed(3) + ' vs noon ' + noonJun.toFixed(3));
  // 78 N in December: the sun never rises.
  assert.ok(illuminationFactor(78, 12, 12) < 0.02, 'polar night noon should be dark');
  // Equator: bright at noon, dark at midnight, every month.
  for (var m = 1; m <= 12; m++) {
    assert.ok(illuminationFactor(0, 12, m) > 0.5, 'equator noon should be bright in month ' + m);
    assert.ok(illuminationFactor(0, 0, m) < 0.1, 'equator midnight should be dark in month ' + m);
  }
});

test('illuminationFactor: lags the sun, so it peaks after local noon', function() {
  var best = 0, bestH = 0;
  for (var h = 8; h < 18; h += 0.25) {
    var v = illuminationFactor(35, h, 6);
    if (v > best) { best = v; bestH = h; }
  }
  assert.ok(bestH > 12 && bestH < 14.5,
    'peak should sit in the early afternoon, got ' + bestH);
});

test('illuminationFactor: stays in [0,1] everywhere', function() {
  for (var lat = -90; lat <= 90; lat += 15) {
    for (var m = 1; m <= 12; m += 2) {
      for (var h = 0; h < 24; h += 3) {
        var v = illuminationFactor(lat, h, m);
        assert.ok(v >= 0 && v <= 1, 'out of range at ' + [lat, m, h] + ': ' + v);
      }
    }
  }
});

// ── SEASON + LATITUDE ────────────────────────────────────────────────────────
// Behaviour pinned against the VOACAP seasonal study (docs/VALIDATION.md) and
// the textbook anomalies it reproduces.








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


// ── HEMISPHERE-TO-HEMISPHERE ─────────────────────────────────────────────────
// A transequatorial path has its two ends in opposite seasons and its midpoint
// near the magnetic equator. Measured against VOACAP over six real circuits in
// scripts/validation/run_interhemi_study.py; these pin the behaviour that
// study checked.



test('assessFrequency: a transequatorial path stays physical all day', function() {
  // Cherry Point to Argentina: 7963 km, midpoint on the equator at 8 deg
  // magnetic. Whatever the month, the numbers must stay in a usable HF range
  // and keep MUF above FOT above nothing silly.
  for (var m = 1; m <= 12; m += 1) {
    for (var h = 0; h < 24; h += 2) {
      var a = assessFrequency({
        takeoffDeg: 3, layerKm: 360, midLon: -67.6, magLatDeg: 8.0,
        month: m, utcHour: h, sfi: null, freqMHz: 14.2,
      });
      assert.ok(a.muf > 3 && a.muf < 60, 'MUF out of range, month ' + m + ' hour ' + h + ': ' + a.muf);
      assert.ok(a.fot < a.muf, 'FOT must sit below MUF');
      assert.ok(a.luf > 0 && a.luf < 12, 'LUF out of range: ' + a.luf);
      assert.ok(a.verdict && typeof a.verdict.ok === 'boolean');
    }
  }
});

test('assessFrequency: opposite hemispheres, same month, differ near the poles', function() {
  // The whole point of the latitude term. Two mid-latitude paths in January,
  // one northern and one southern, must not get the same answer.
  function muf(magLat) {
    return assessFrequency({ takeoffDeg: 8, layerKm: 360, midLon: 0,
      magLatDeg: magLat, month: 1, utcHour: 12, sfi: null }).muf;
  }
  assert.ok(muf(50) > muf(-50), 'January noon: northern winter should beat southern summer');
});


// ── SEASON AND LATITUDE, AGAINST THE REAL INTERFACE ──────────────────────────
// estimateFoF2 is what callers use, so the seasonal behaviour is pinned there
// rather than on the internal multiplier.

test('seasonLatitudeFactor: no-op without month or magnetic latitude', function() {
  assert.equal(seasonLatitudeFactor(undefined, undefined, 0.5), 1);
  assert.equal(seasonLatitudeFactor(null, null), 1);
  assert.equal(seasonLatitudeFactor(13, undefined), 1, 'out-of-range month ignored, not clamped');
});

test('seasonLatitudeFactor: continuous across the magnetic equator', function() {
  // The hemisphere flip is a hard switch at magLat 0 and a transequatorial
  // path's midpoint lands right there. It only stays smooth because the term
  // is weighted by |magLat|, which vanishes at the same point.
  for (var m = 1; m <= 12; m++) {
    for (var x = 0; x <= 1; x += 0.5) {
      var n = seasonLatitudeFactor(m, 0.01, x), s = seasonLatitudeFactor(m, -0.01, x);
      assert.ok(Math.abs(n - s) < 0.001, 'step at the magnetic equator, month ' + m);
    }
  }
});

test('estimateFoF2: winter anomaly — daytime foF2 higher in local winter', function() {
  // Northern mid-latitudes, local noon. January must beat July even though
  // there is far less sunlight, because the anomaly is a composition effect.
  var jan = estimateFoF2(70, 12, 1, 51, 44.6);
  var jul = estimateFoF2(70, 12, 7, 51, 44.6);
  assert.ok(jan > jul, '44 N noon: Jan ' + jan.toFixed(2) + ' should exceed Jul ' + jul.toFixed(2));
  // And the southern hemisphere runs its own winter, in July.
  var njan = estimateFoF2(70, 12, 1, -50, -44.2);
  var njul = estimateFoF2(70, 12, 7, -50, -44.2);
  assert.ok(njul / njan > jul / jan, 'southern hemisphere should lean the other way');
});

test('estimateFoF2: polar day keeps the layer up, polar night collapses it', function() {
  var junMidnight = estimateFoF2(70, 0, 6, 75, 78);
  var junNoon = estimateFoF2(70, 12, 6, 75, 78);
  assert.ok(junMidnight > 0.7 * junNoon, 'sun never sets — midnight should stay close to noon');
  var decNoon = estimateFoF2(70, 12, 12, 75, 78);
  assert.ok(decNoon < 0.6 * junNoon, 'polar night noon should be far below polar day');
});

test('estimateFoF2: low latitudes run higher than high ones', function() {
  function annual(magLat, lat) {
    var s = 0;
    for (var m = 1; m <= 12; m++) s += estimateFoF2(70, 12, m, magLat, lat);
    return s / 12;
  }
  assert.ok(annual(5, 5) > annual(60, 60), 'equatorial annual mean should exceed polar');
});

test('estimateFoF2: falls back to the clock curve without a latitude', function() {
  var withLat = estimateFoF2(70, 12, 6, 51, 44.6);
  var without = estimateFoF2(70, 12, 6, 51);
  assert.ok(isFinite(without) && without > 2 && without < 30);
  assert.ok(Math.abs(withLat - without) > 0.01, 'the two paths should not be identical');
  // And with nothing at all it still answers.
  assert.ok(estimateFoF2(70, 12) > 2);
});

test('estimateFoF2: physical everywhere across the whole globe and year', function() {
  for (var lat = -85; lat <= 85; lat += 10) {
    for (var m = 1; m <= 12; m += 1) {
      for (var h = 0; h < 24; h += 4) {
        var v = estimateFoF2(70, h, m, lat * 0.9, lat);
        assert.ok(v > 1.5 && v < 20, 'foF2 out of range at ' + [lat, m, h] + ': ' + v);
      }
    }
  }
});
