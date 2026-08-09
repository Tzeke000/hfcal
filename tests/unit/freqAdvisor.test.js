// Unit tests for freqAdvisor.js — run with `npm test` (node --test).
// Values pinned against published ionospheric behaviour; the MUF model is
// separately compared against VOACAP in docs/VALIDATION.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SSN, sfiToSSN, localSolarTime, diurnalFactor, estimateFoF2,
  secantFactor, classifyFrequency, assessFrequency, rankAssignedFrequencies,
  FOF2_PEAK_HOUR, FOF2_NIGHT_RATIO, seasonLatitudeFactor,
  frequencyForecast, bestBlocks,
  solarDeclination, cosZenith, illuminationFactor,
  estimateLUF, DEFAULT_TX_WATTS, LUF_FLOOR_MHZ,
  pathFoF2, minOrderCorrection, FOF2_POINT_SIGMA,
  FOT_RATIO, MUF_DAYS_IN_10, FOT_DAYS_IN_10,
  dLayerObliquity,
  mapFoF2, bounceFoF2, MAP_FOF2_MIN, MAP_FOF2_MAX, MAP_MODIP_LIMIT,
  MAP_SANITY_FACTOR, MAP_HELDOUT_PCT,
  mFactorLookup, MFACTOR_MIN, MFACTOR_MAX, MFACTOR_ACCURACY_PCT,
  foF2PointSigma, FOF2_SIGMA_TABLE, FOF2_SIGMA_MAP,
} from '../../src/physics/freqAdvisor.js';

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
  approx(r.fot, FOT_RATIO * r.muf, 1e-9);
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
    approx(b.fot, FOT_RATIO * b.muf, 1e-9);
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
// scripts/validation/studies/run_interhemi_study.py; these pin the behaviour that
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


// ── SUNRISE, SUNSET AND DUSK, BOTH HEMISPHERES ───────────────────────────────
// Day length and terminator timing are what the whole solar model rests on, so
// they are checked directly rather than only through foF2. Values are
// GEOMETRIC (cos χ = 0); published sunrise/sunset run a few minutes wider
// because of atmospheric refraction and the sun's disc, which does not matter
// for ionisation.

function dayLengthHours(lat, month) {
  var d = solarDeclination(month), up = 0, step = 1 / 120;
  for (var h = 0; h < 24; h += step) if (cosZenith(lat, h, d) > 0) up += step;
  return up;
}

function terminator(lat, month) {
  var d = solarDeclination(month), rise = null, set = null, step = 1 / 240;
  for (var h = step; h < 24; h += step) {
    var a = cosZenith(lat, h - step, d), b = cosZenith(lat, h, d);
    if (a <= 0 && b > 0) rise = h;
    if (a > 0 && b <= 0) set = h;
  }
  return { rise: rise, set: set };
}

test('day length: equinox gives twelve hours at every latitude', function() {
  [-60, -34, -10, 0, 10, 34, 60].forEach(function(lat) {
    [3, 9].forEach(function(m) {
      assert.ok(Math.abs(dayLengthHours(lat, m) - 12) < 0.7,
        'lat ' + lat + ' month ' + m + ' should be near 12 h, got ' + dayLengthHours(lat, m).toFixed(2));
    });
  });
});

test('day length: hemispheres mirror six months apart', function() {
  // The core hemisphere check. Midwinter in the north must equal midwinter in
  // the south half a year later, at the same latitude magnitude.
  [60, 44, 34, 10].forEach(function(lat) {
    for (var m = 1; m <= 12; m++) {
      var m2 = ((m + 5) % 12) + 1;
      var north = dayLengthHours(lat, m), south = dayLengthHours(-lat, m2);
      assert.ok(Math.abs(north - south) < 0.4,
        'lat ' + lat + ' month ' + m + ' (' + north.toFixed(2) + ' h) should mirror lat '
        + (-lat) + ' month ' + m2 + ' (' + south.toFixed(2) + ' h)');
    }
  });
});

test('day length: summer is long and winter is short, oppositely per hemisphere', function() {
  // 34 N: June long, December short. 34 S: exactly the reverse.
  assert.ok(dayLengthHours(34, 6) > 14, 'northern summer should exceed 14 h');
  assert.ok(dayLengthHours(34, 12) < 10, 'northern winter should be under 10 h');
  assert.ok(dayLengthHours(-34, 12) > 14, 'southern summer is December');
  assert.ok(dayLengthHours(-34, 6) < 10, 'southern winter is June');
  // Equator barely moves all year.
  var eq = [];
  for (var m = 1; m <= 12; m++) eq.push(dayLengthHours(0, m));
  assert.ok(Math.max.apply(null, eq) - Math.min.apply(null, eq) < 0.3,
    'equatorial day length should be near constant');
});

test('day length: matches published figures within the refraction allowance', function() {
  // Published sunrise-to-sunset runs longer than geometric because of
  // refraction and the solar disc — about 8 min at 34 deg, more nearer the pole.
  assert.ok(Math.abs(dayLengthHours(34, 6) - 14.42) < 0.35, 'Los Angeles-ish, June solstice');
  assert.ok(Math.abs(dayLengthHours(-34, 12) - 14.42) < 0.35, 'Sydney-ish, December solstice');
  assert.ok(Math.abs(dayLengthHours(0, 6) - 12.12) < 0.25, 'equator, June');
});

test('sunrise and sunset land symmetrically about local solar noon', function() {
  [-60, -34, 0, 34, 60].forEach(function(lat) {
    [1, 4, 7, 10].forEach(function(m) {
      var t = terminator(lat, m);
      if (t.rise === null || t.set === null) return;   // polar day or night
      var noon = (t.rise + t.set) / 2;
      assert.ok(Math.abs(noon - 12) < 0.1,
        'lat ' + lat + ' month ' + m + ': solar noon should sit at 12, got ' + noon.toFixed(2));
    });
  });
});

test('sunrise and sunset mirror exactly between hemispheres', function() {
  var n = terminator(34, 6), s = terminator(-34, 12);
  assert.ok(Math.abs(n.rise - s.rise) < 0.05 && Math.abs(n.set - s.set) < 0.05,
    '34 N in June should match 34 S in December');
});

test('dusk: foF2 decays gradually after sunset rather than dropping off a cliff', function() {
  // The recombination lag is what keeps an evening path open. Sample the two
  // hours after local sunset and require a smooth, monotonic decline.
  var lat = 34, month = 6, set = terminator(lat, month).set;
  var prev = estimateFoF2(70, set, month, 40, lat);
  var atSet = prev;
  for (var dt = 0.25; dt <= 2; dt += 0.25) {
    var v = estimateFoF2(70, set + dt, month, 40, lat);
    assert.ok(v < prev, 'should keep falling after sunset, rose at +' + dt + ' h');
    assert.ok(v > 0.45 * atSet, 'should not collapse instantly, at +' + dt + ' h it was ' + (v / atSet).toFixed(2));
    prev = v;
  }
  // An hour after sunset the layer must still be well above its floor.
  assert.ok(estimateFoF2(70, set + 1, month, 40, lat) > 0.6 * atSet,
    'one hour past sunset should still be usable');
});

test('dawn: foF2 climbs through sunrise in both hemispheres', function() {
  [[34, 6], [-34, 12], [60, 4], [-60, 10]].forEach(function(c) {
    var lat = c[0], month = c[1], rise = terminator(lat, month).rise;
    if (rise === null) return;
    var before = estimateFoF2(70, rise - 1, month, lat * 0.9, lat);
    var after = estimateFoF2(70, rise + 2, month, lat * 0.9, lat);
    assert.ok(after > before,
      'lat ' + lat + ' month ' + month + ': should rise after dawn, ' + before.toFixed(2) + ' -> ' + after.toFixed(2));
  });
});

// ── PATH ENDS ────────────────────────────────────────────────────────────────
// MUF is taken at the reflection point; LUF at the two terminals, where the
// ray crosses the absorbing D layer. Measured in docs/VALIDATION.md Part 7.

test('assessFrequency: endpoints move the LUF but never the MUF', function() {
  // Guam to Cherry Point: one end in daylight while the other is dark.
  var base = { takeoffDeg: 5, layerKm: 360, midLon: -146, latDeg: 38,
               magLatDeg: 40, month: 1, utcHour: 4, sfi: null };
  var ends = [{ lat: 13.4, lon: 144.8 }, { lat: 34.9, lon: -76.9 }];
  var withEnds = assessFrequency(Object.assign({}, base, { ends: ends }));
  var without = assessFrequency(base);
  assert.equal(withEnds.muf, without.muf, 'MUF must not depend on the endpoints');
  assert.ok(withEnds.luf > without.luf,
    'a daylit far end should raise the LUF: ' + withEnds.luf.toFixed(2) + ' vs ' + without.luf.toFixed(2));
});

test('assessFrequency: reports local solar time at both stations', function() {
  var r = assessFrequency({ takeoffDeg: 5, layerKm: 360, midLon: -146, latDeg: 38,
    magLatDeg: 40, month: 1, utcHour: 0, sfi: null,
    ends: [{ lat: 13.4, lon: 144.8 }, { lat: 34.9, lon: -76.9 }] });
  assert.equal(r.endSolarHours.length, 2);
  // Guam is east of the dateline-adjacent meridian: mid-morning at 00Z.
  assert.ok(r.endSolarHours[0] > 9 && r.endSolarHours[0] < 11, 'Guam should be mid-morning');
  // Cherry Point is evening at the same instant.
  assert.ok(r.endSolarHours[1] > 18 && r.endSolarHours[1] < 20, 'Cherry Point should be evening');
  assert.equal(assessFrequency({ takeoffDeg: 5, layerKm: 360, sfi: null }).endSolarHours, null);
});


// ── LUF AND TRANSMIT POWER ───────────────────────────────────────────────────
// Absorption physics: L = K*I^0.75/(f+fH)^2 per hop, closing while L stays
// under a margin that grows as 10*log10(P). See docs/VALIDATION.md Part 8.

test('estimateLUF: still matches the historical 20 W anchor on a short path', function() {
  // The pre-v1.15 model was LUF = 2.0 + 3.5*illumination at manpack power, and
  // that 5.5 MHz figure was always a SHORT-path number — the app had no
  // obliquity term, so every path was implicitly treated as near-vertical.
  // Part 20 added the obliquity that was missing; the anchor has to survive
  // where it was originally valid, which is NVIS range.
  assert.ok(Math.abs(estimateLUF(1, 20, 1, 300) - 5.5) < 0.15,
    'full sun 20 W over 300 km should still be about 5.5 MHz, got ' + estimateLUF(1, 20, 1, 300));
  assert.equal(estimateLUF(0, 20, 1, 300), LUF_FLOOR_MHZ,
    'a dark NVIS path should sit on the noise floor');
});

test('estimateLUF: absorption grows with path length (Part 20 obliquity)', function() {
  // The measurement that mattered: a ray to a distant target crosses the D
  // layer at a shallow angle and spends far longer inside it. Before Part 20
  // the app charged a 2500 km hop exactly what it charged an NVIS shot.
  var prev = 0;
  [300, 800, 1500, 2500, 3000].forEach(function(d) {
    var v = estimateLUF(1, 20, 1, d);
    assert.ok(v > prev, 'LUF must rise with hop length, broke at ' + d + ' km');
    prev = v;
  });
  assert.ok(estimateLUF(1, 20, 1, 2500) > 2 * estimateLUF(1, 20, 1, 300),
    'a 2500 km hop absorbs far more than an NVIS shot');
  // And the obliquity is per HOP, not per path: splitting the same distance
  // into more hops makes each crossing steeper.
  assert.ok(dLayerObliquity(1250) < dLayerObliquity(2500));
});

test('estimateLUF: night absorption is real but small at NVIS range', function() {
  // Part 20 measured a night residual — absorption does not vanish after dark.
  // At NVIS range it is small enough that the 2 MHz noise floor still governs;
  // on a long path it is not.
  assert.equal(estimateLUF(0, 20, 1, 300), LUF_FLOOR_MHZ);
  assert.ok(estimateLUF(0, 20, 1, 2500) > LUF_FLOOR_MHZ,
    'a dark 2500 km path should NOT sit on the noise floor');
});

test('estimateLUF: more power lowers the LUF, and never raises it', function() {
  var prev = Infinity;
  [5, 20, 50, 150, 400, 1000].forEach(function(w) {
    var v = estimateLUF(1, w, 1);
    assert.ok(v <= prev, 'LUF must not rise with power, broke at ' + w + ' W');
    prev = v;
  });
  assert.ok(estimateLUF(1, 5, 1) > estimateLUF(1, 400, 1), '5 W should be far worse than 400 W');
});

test('estimateLUF: power buys the SQUARE ROOT of the margin, not linear gain', function() {
  // 20x the power measured 43% lower in VOACAP; the model must land near that
  // and must NOT behave linearly (which would be a 95% drop).
  var drop = 1 - estimateLUF(1, 400, 1) / estimateLUF(1, 20, 1);
  assert.ok(drop > 0.30 && drop < 0.55,
    '20 W -> 400 W should drop the LUF 30-55%, got ' + (drop * 100).toFixed(0) + '%');
  // The real operational step: PRC-160 GLOBAL (20 W) to the RF-5833H (150 W)
  // is 7.5x the power and must buy roughly a third, not seven times.
  var real = 1 - estimateLUF(1, 150, 1) / estimateLUF(1, 20, 1);
  assert.ok(real > 0.20 && real < 0.45,
    'GLOBAL -> VRC should drop the LUF 20-45%, got ' + (real * 100).toFixed(0) + '%');
});

test('estimateLUF: the PRC-160 preset ladder is monotonic and sane', function() {
  // Operator-reported from the radio: LOW 2, MED 5, HIGH 10, GLOBAL 20 W.
  var ladder = [2, 5, 10, 20, 150];
  var prev = Infinity;
  ladder.forEach(function(w) {
    var v = estimateLUF(1, w, 1, 300);
    assert.ok(v < prev, 'each step up the ladder must lower the LUF, broke at ' + w + ' W');
    assert.ok(isFinite(v) && v >= LUF_FLOOR_MHZ, 'bad LUF at ' + w + ' W: ' + v);
    prev = v;
  });
  // At night on a short path the ladder collapses onto the noise floor from
  // 10 W up: the residual absorption Part 20 measured is too small to matter
  // there. It does NOT collapse at 2 W, and that is the model showing its one
  // uncalibrated seam rather than a physical claim — the 10 dB margin at 20 W
  // is an anchor, so at 2 W the margin falls to zero and the formula divides
  // by its own floor. Asserted as it behaves, and documented as a limit.
  [10, 20, 150].forEach(function(w) {
    assert.equal(estimateLUF(0, w, 1, 300), LUF_FLOOR_MHZ,
      'a dark NVIS path at ' + w + ' W should sit on the noise floor');
  });
  var nightPrev = Infinity;
  ladder.forEach(function(w) {
    var v = estimateLUF(0, w, 1, 300);
    assert.ok(v <= nightPrev, 'night LUF must not rise with power, broke at ' + w + ' W');
    nightPrev = v;
  });
});

test('estimateLUF: rises with illumination and with hop count', function() {
  assert.ok(estimateLUF(1, 20, 1) > estimateLUF(0.5, 20, 1));
  assert.ok(estimateLUF(0.5, 20, 1) > estimateLUF(0.1, 20, 1));
  // The ray crosses the absorbing layer once per hop.
  assert.ok(estimateLUF(1, 20, 3) > estimateLUF(1, 20, 1), 'three hops absorb more than one');
});

test('estimateLUF: never returns below the noise floor, or a bad number', function() {
  [0, 0.001, 0.5, 1].forEach(function(i) {
    [1, 20, 5000].forEach(function(w) {
      var v = estimateLUF(i, w, 1);
      assert.ok(isFinite(v) && v >= LUF_FLOOR_MHZ && v < 60, 'bad LUF at ' + [i, w] + ': ' + v);
    });
  });
  // Junk input falls back to the reference power rather than producing NaN.
  assert.equal(estimateLUF(1, null, null), estimateLUF(1, DEFAULT_TX_WATTS, 1));
  assert.equal(estimateLUF(null, 20, 1), LUF_FLOOR_MHZ);
});

test('assessFrequency: power moves the LUF and leaves the MUF alone', function() {
  var base = { takeoffDeg: 8, layerKm: 360, midLon: 0, latDeg: 35, magLatDeg: 40,
               month: 6, utcHour: 12, sfi: null, freqMHz: 4, hops: 1 };
  var low = assessFrequency(Object.assign({}, base, { txWatts: 20 }));
  var high = assessFrequency(Object.assign({}, base, { txWatts: 400 }));
  assert.equal(low.muf, high.muf, 'power must never change the MUF');
  assert.ok(high.luf < low.luf, 'more power must lower the LUF');
  // And that can flip a verdict from unusable to usable.
  assert.equal(low.verdict.code, 'below_luf', '4 MHz at 20 W in full sun should be absorbed');
  assert.ok(high.verdict.ok, 'the same frequency at 400 W should come back');
  assert.equal(assessFrequency(base).txWatts, DEFAULT_TX_WATTS, 'defaults to a manpack');
});


test('assessFrequency: flags a path that no frequency can close', function() {
  // 1 W in full daylight over a multi-hop path: absorption exceeds what the
  // ionosphere will still reflect, so the whole band is shut.
  var shut = assessFrequency({ takeoffDeg: 8, layerKm: 360, midLon: 0, latDeg: 35,
    magLatDeg: 40, month: 6, utcHour: 12, sfi: null, freqMHz: 7, txWatts: 1, hops: 2 });
  assert.ok(shut.pathClosed, 'LUF ' + shut.luf.toFixed(1) + ' vs MUF ' + shut.muf.toFixed(1));
  assert.ok(shut.luf >= shut.muf);
  // The same path at manpack power is open again.
  var open_ = assessFrequency({ takeoffDeg: 8, layerKm: 360, midLon: 0, latDeg: 35,
    magLatDeg: 40, month: 6, utcHour: 12, sfi: null, freqMHz: 7, txWatts: 20, hops: 2 });
  assert.ok(!open_.pathClosed, 'manpack power should reopen it');
  // And a night path is open even at 1 W.
  var night = assessFrequency({ takeoffDeg: 8, layerKm: 360, midLon: 0, latDeg: 35,
    magLatDeg: 40, month: 6, utcHour: 0, sfi: null, freqMHz: 7, txWatts: 1, hops: 2 });
  assert.ok(!night.pathClosed, 'darkness removes the absorption limit');
});


// ── MULTI-HOP: THE WEAKEST BOUNCE ────────────────────────────────────────────
// A multi-hop signal must reflect at every bounce, so the path is capped by
// the worst. See docs/VALIDATION.md Part 9.

test('minOrderCorrection: no correction for one point, growing with more', function() {
  assert.equal(minOrderCorrection(1), 1);
  assert.equal(minOrderCorrection(0), 1);
  assert.ok(minOrderCorrection(2) > 1 && minOrderCorrection(3) > minOrderCorrection(2));
  // The correction is a known order statistic times the LIVE source's error,
  // not a tuned knob: min of 2 is biased low by 0.564 sigma. It used to be
  // pinned to a stale constant, which is what Part 17 fixed.
  assert.ok(Math.abs(minOrderCorrection(2) - (1 + foF2PointSigma() * 0.5642)) < 1e-9);
});

test('pathFoF2: a single bounce is exactly the midpoint answer', function() {
  var one = pathFoF2(70, 12, 6, [{ lat: 40, lon: 0, magLatDeg: 45 }], 0, 40, 45);
  assert.equal(one, estimateFoF2(70, 12, 6, 45, 40));
});

test('pathFoF2: the weakest bounce caps the path', function() {
  // One bounce in darkness, one in daylight. The dark one must govern.
  var bounces = [{ lat: 40, lon: 0, magLatDeg: 45 },      // local noon at 12Z
                 { lat: 40, lon: 180, magLatDeg: 45 }];   // local midnight
  var v = pathFoF2(70, 12, 6, bounces, 0, 40, 45);
  var lit = estimateFoF2(70, 12, 6, 45, 40);
  var dark = estimateFoF2(70, 0, 6, 45, 40);
  assert.ok(dark < lit, 'sanity: the second bounce really is the weaker one');
  assert.ok(v < lit, 'the daylit bounce must not set the path');
  assert.ok(Math.abs(v - dark * minOrderCorrection(2)) < 1e-9, 'weakest bounce, de-biased');
});

test('pathFoF2: falls back to the midpoint when bounces are unknown', function() {
  var mid = estimateFoF2(70, 12, 6, 45, 40);
  assert.equal(pathFoF2(70, 12, 6, null, 0, 40, 45), mid);
  assert.equal(pathFoF2(70, 12, 6, [], 0, 40, 45), mid);
});

test('assessFrequency: a bad bounce on a long path pulls the MUF down', function() {
  // Finland to South Africa in January: three bounces, and the northern one
  // sits in deep winter dawn while the others are in the tropics.
  var bounces = [{ lat: 45, lon: 25, magLatDeg: 44 },
                 { lat: 15, lon: 25, magLatDeg: 7 },
                 { lat: -15, lon: 25, magLatDeg: -34 }];
  var base = { takeoffDeg: 3, layerKm: 360, midLon: 25, latDeg: 15, magLatDeg: 7,
               month: 1, utcHour: 6, sfi: null, hops: 3 };
  var mid = assessFrequency(base);
  var full = assessFrequency(Object.assign({}, base, { bounces: bounces }));
  assert.ok(full.muf < mid.muf,
    'the weak northern bounce should cut the MUF: ' + full.muf.toFixed(1) + ' vs ' + mid.muf.toFixed(1));
  assert.equal(full.bounceDetail.length, 3);
  // And the reported detail must identify which one is limiting.
  var worst = full.bounceDetail.reduce(function(a, b) { return b.foF2 < a.foF2 ? b : a; });
  assert.equal(worst.lat, 45, 'the northern winter bounce should be the limiting one');
});

test('assessFrequency: bounces never change the LUF, only the MUF', function() {
  var base = { takeoffDeg: 6, layerKm: 360, midLon: 0, latDeg: 20, magLatDeg: 20,
               month: 6, utcHour: 12, sfi: null, hops: 2, txWatts: 20,
               ends: [{ lat: 50, lon: 0 }, { lat: -10, lon: 0 }] };
  var a = assessFrequency(base);
  var b = assessFrequency(Object.assign({}, base, {
    bounces: [{ lat: 35, lon: 0, magLatDeg: 38 }, { lat: 5, lon: 0, magLatDeg: 5 }] }));
  assert.equal(a.luf, b.luf, 'the LUF is set at the terminals, not the bounces');
  assert.ok(b.muf !== a.muf, 'the MUF is set at the bounces');
});


// ── FOT ──────────────────────────────────────────────────────────────────────
// The FOT is DEFINED as the frequency good 90% of days, not as a fixed
// fraction of the MUF. Measured against VOACAP's MUFday output over 361
// samples it sits at 0.740 x MUF; the textbook 0.85 delivers only 76%.
// See docs/VALIDATION.md Part 11.

test('FOT_RATIO: is the measured value, not the textbook rule of thumb', function() {
  // Measured on a grid fine enough to have converged: 4.5% steps give 0.7688
  // and 2.0% steps give 0.7700. See docs/VALIDATION.md Part 12.
  assert.ok(Math.abs(FOT_RATIO - 0.77) < 1e-9);
  assert.ok(FOT_RATIO < 0.85, 'the textbook 0.85 was measured to give only ~82% of days');
  assert.equal(MUF_DAYS_IN_10, 5, 'the MUF is a median by definition');
  assert.equal(FOT_DAYS_IN_10, 9);
});

test('classifyFrequency: the bands hang off the FOT, not round fractions of MUF', function() {
  var muf = 12, luf = 3, fot = FOT_RATIO * muf;   // FOT = 9.24 -> displays 9.2
  // Classification is now done at the 0.1 MHz the UI displays (Iris #11), so
  // distinctions finer than that deliberately collapse — a frequency AT the
  // displayed FOT reads GOOD, and one clearly above it reads near_muf. (This
  // used to test fot*0.999 vs fot*1.001, which now round to the same 9.2.)
  assert.equal(classifyFrequency(9.2, muf, luf).code, 'good');
  assert.equal(classifyFrequency(9.7, muf, luf).code, 'near_muf');
  // The old model called everything up to 0.9 x MUF "good". It is not.
  assert.equal(classifyFrequency(0.88 * muf, muf, luf).code, 'near_muf',
    '0.88 x MUF is well above the 9-in-10 frequency and must not read GOOD');
  // Ends of the range still behave.
  assert.equal(classifyFrequency(muf * 1.01, muf, luf).code, 'above_muf');
  assert.equal(classifyFrequency(2.5, muf, luf).code, 'below_luf');   // clearly under LUF 3.0 at 0.1 MHz resolution
  assert.equal(classifyFrequency(fot * 0.7, muf, luf).code, 'low');
});

test('classifyFrequency: every band is reachable and ordered by frequency', function() {
  var muf = 20, luf = 3, seen = [];
  for (var f = 2; f <= 22; f += 0.25) {
    var c = classifyFrequency(f, muf, luf).code;
    if (!seen.length || seen[seen.length - 1] !== c) seen.push(c);
  }
  assert.deepEqual(seen, ['below_luf', 'low', 'good', 'near_muf', 'above_muf'],
    'bands must appear once each, in ascending frequency order — got ' + seen.join(','));
});

test('assessFrequency: the suggested frequency is the FOT when it fits', function() {
  var r = assessFrequency({ takeoffDeg: 20, layerKm: 360, midLon: 0, latDeg: 35,
    magLatDeg: 40, month: 6, utcHour: 12, sfi: null, txWatts: 20, hops: 1 });
  approx(r.fot, FOT_RATIO * r.muf, 1e-9);
  assert.ok(r.suggestedMHz <= r.muf && r.suggestedMHz >= r.luf);
  if (r.fot > r.luf) approx(r.suggestedMHz, r.fot, 1e-9);
});


// ── REFIT GUARDS ─────────────────────────────────────────────────────────────
// The v1.18.0 refit changed six coefficients at once. These pin the behaviour
// that the refit had to preserve, so a future refit cannot quietly break it.

test('refit: the winter anomaly survived the coefficient change', function() {
  // The whole reason Part 6 added a seasonal-ordering constraint. Northern
  // mid-latitudes must still show January daytime above July.
  var jan = estimateFoF2(70, 12, 1, 51, 44.6);
  var jul = estimateFoF2(70, 12, 7, 51, 44.6);
  assert.ok(jan > jul, '44 N noon: Jan ' + jan.toFixed(2) + ' must exceed Jul ' + jul.toFixed(2));
  var sJan = estimateFoF2(70, 12, 1, -50, -44.2);
  var sJul = estimateFoF2(70, 12, 7, -50, -44.2);
  assert.ok(sJul / sJan > jul / jan, 'the southern hemisphere must still lean the other way');
});

test('refit: foF2 stays inside published ionosonde ranges', function() {
  // A fit can minimise error while drifting somewhere unphysical. Mid-latitude
  // noon foF2 runs roughly 6-13 MHz from solar minimum to maximum, and night
  // roughly 2-6. Checked at the extremes of the solar cycle.
  var noonMin = estimateFoF2(0, 12, 6, 45, 40);
  var noonMax = estimateFoF2(200, 12, 6, 45, 40);
  var nightMin = estimateFoF2(0, 0, 6, 45, 40);
  var nightMax = estimateFoF2(200, 0, 6, 45, 40);
  assert.ok(noonMin > 5 && noonMin < 10, 'solar-min noon out of range: ' + noonMin.toFixed(2));
  assert.ok(noonMax > 9 && noonMax < 16, 'solar-max noon out of range: ' + noonMax.toFixed(2));
  assert.ok(nightMin > 1.5 && nightMin < 5, 'solar-min night out of range: ' + nightMin.toFixed(2));
  assert.ok(nightMax > 3 && nightMax < 9, 'solar-max night out of range: ' + nightMax.toFixed(2));
  assert.ok(noonMin > nightMin && noonMax > nightMax, 'day must beat night');
});

test('refit: the lag still puts the peak in the early afternoon', function() {
  // The recombination lag is what produces the observed afternoon peak. If a
  // refit drove it to zero the peak would snap back to local noon.
  var best = 0, bestH = 0;
  for (var h = 9; h < 17; h += 0.25) {
    var v = illuminationFactor(35, h, 6);
    if (v > best) { best = v; bestH = h; }
  }
  assert.ok(bestH > 12.1 && bestH < 14.5, 'peak drifted to ' + bestH);
});


// ── COEFFICIENT MAP ──────────────────────────────────────────────────────────
// A fitted polynomial reconstruction of the ionospheric map VOACAP uses. More
// than twice as accurate as the physical model, and — being a polynomial —
// capable of nonsense outside its training envelope, so the guards matter as
// much as the accuracy. See docs/VALIDATION.md Part 14.

test('mapFoF2: reproduces the fitted values it was exported from', function() {
  // Cross-checked against the Python fit to 1.3e-13 MHz inside the unclamped
  // domain; this pins one value so a botched regeneration cannot slip through.
  var v = mapFoF2(45.0, 12.0, 6, 70, -76.9);
  assert.ok(Math.abs(v - 7.515674) < 1e-5, 'got ' + v);
});

test('mapFoF2: never escapes the physical window, however absurd the input', function() {
  // Swept across its whole input domain the raw polynomial reaches 1208 MHz.
  // Nothing here may.
  [-500, -90, -72, 0, 72, 90, 500].forEach(function(mp) {
    [0, 6, 12, 18, 23.9].forEach(function(h) {
      [1, 6, 12].forEach(function(m) {
        [0, 70, 150, 400, 10000].forEach(function(ssn) {
          [-180, -60, 0, 120, 180].forEach(function(lon) {
            var v = mapFoF2(mp, h, m, ssn, lon);
            assert.ok(v === null || (isFinite(v) && v >= MAP_FOF2_MIN && v <= MAP_FOF2_MAX),
              'escaped at ' + [mp, h, m, ssn, lon] + ': ' + v);
          });
        });
      });
    });
  });
});

test('mapFoF2: refuses bad input rather than guessing', function() {
  assert.equal(mapFoF2(NaN, 12, 6, 70, 0), null);
  assert.equal(mapFoF2(45, 12, 0, 70, 0), null, 'month out of range');
  assert.equal(mapFoF2(45, 12, 13, 70, 0), null);
  assert.equal(mapFoF2(45, 12, 6, 70, NaN), null);
  assert.equal(mapFoF2(null, 12, 6, 70, 0), null);
});

test('mapFoF2: clamps beyond the trained envelope instead of extrapolating', function() {
  var edge = mapFoF2(MAP_MODIP_LIMIT, 12, 6, 70, 0);
  assert.equal(mapFoF2(MAP_MODIP_LIMIT + 30, 12, 6, 70, 0), edge, 'modip must clamp');
  assert.equal(mapFoF2(-MAP_MODIP_LIMIT - 30, 12, 6, 70, 0), mapFoF2(-MAP_MODIP_LIMIT, 12, 6, 70, 0));
  // Solar activity likewise — the fit only ever saw up to SSN 150.
  assert.equal(mapFoF2(45, 12, 6, 400, 0), mapFoF2(45, 12, 6, 165, 0));
});

test('mapFoF2: day beats night and the diurnal shape is sane', function() {
  for (var mp = -60; mp <= 60; mp += 30) {
    var noon = mapFoF2(mp, 12, 6, 70, 0);
    var night = mapFoF2(mp, 2, 6, 70, 0);
    assert.ok(noon > night, 'noon should beat pre-dawn at modip ' + mp
      + ': ' + noon.toFixed(2) + ' vs ' + night.toFixed(2));
  }
});

test('bounceFoF2: falls back to physics when the map is unavailable', function() {
  var b = { lat: 40, lon: -76, magLatDeg: 45 };          // no modip
  assert.equal(bounceFoF2(70, 12, 6, b), estimateFoF2(70, localSolarTime(12, -76), 6, 45, 40));
  var bad = { lat: 40, lon: -76, magLatDeg: 45, modipDeg: NaN };
  assert.equal(bounceFoF2(70, 12, 6, bad), estimateFoF2(70, localSolarTime(12, -76), 6, 45, 40));
});

test('bounceFoF2: the physical model overrules a map that wanders', function() {
  // The guard that matters: a fitted polynomial that disagrees wildly with the
  // physics is not to be trusted, whichever way it errs.
  var b = { lat: 40, lon: -76, magLatDeg: 45, modipDeg: 50 };
  var used = bounceFoF2(70, 12, 6, b);
  var phys = estimateFoF2(70, localSolarTime(12, -76), 6, 45, 40);
  assert.ok(used <= phys * MAP_SANITY_FACTOR + 1e-9, 'must never exceed the sanity band');
  assert.ok(used * MAP_SANITY_FACTOR >= phys - 1e-9, 'nor fall below it');
  assert.ok(isFinite(used) && used > 1 && used < 20);
});

test('bounceFoF2: stays physical everywhere on Earth, all year', function() {
  for (var lat = -80; lat <= 80; lat += 20) {
    for (var lon = -180; lon < 180; lon += 60) {
      for (var m = 1; m <= 12; m += 3) {
        for (var h = 0; h < 24; h += 6) {
          var v = bounceFoF2(70, h, m, { lat: lat, lon: lon, magLatDeg: lat * 0.9, modipDeg: lat * 1.1 });
          assert.ok(isFinite(v) && v > 1 && v < 20, 'bad foF2 at ' + [lat, lon, m, h] + ': ' + v);
        }
      }
    }
  }
});

test('the map reports the accuracy it was measured at', function() {
  assert.ok(MAP_HELDOUT_PCT > 0 && MAP_HELDOUT_PCT < 12,
    'held-out accuracy should be recorded and single-digit: ' + MAP_HELDOUT_PCT);
});


// ── M-FACTOR TABLE ───────────────────────────────────────────────────────────
// The geometry half of the MUF, measured rather than derived. Indexed by TOTAL
// path distance, which removes hop counting from the MUF entirely.
// See docs/VALIDATION.md Part 16.

test('mFactorLookup: physical at every distance, hour, month and solar level', function() {
  for (var d = 100; d <= 20000; d += 700) {
    for (var h = 0; h < 24; h += 4) {
      for (var m = 1; m <= 12; m += 3) {
        for (var s = 0; s <= 300; s += 100) {
          var v = mFactorLookup(d, h, m, s);
          assert.ok(v !== null && isFinite(v) && v >= MFACTOR_MIN && v <= MFACTOR_MAX,
            'M out of range at ' + [d, h, m, s] + ': ' + v);
        }
      }
    }
  }
});

test('mFactorLookup: M rises with distance then levels off', function() {
  // Physically M climbs from 1 at vertical incidence toward its grazing
  // ceiling. It must never fall as the path lengthens through the single-hop
  // range, which is what the old hard hop switch did at 4186 km.
  var prev = 0;
  for (var d = 250; d <= 3800; d += 250) {
    var v = mFactorLookup(d, 12, 6, 70);
    assert.ok(v >= prev - 0.02, 'M dipped between ' + (d - 250) + ' and ' + d + ' km');
    prev = v;
  }
  assert.ok(mFactorLookup(250, 12, 6, 70) < 1.4, 'near-vertical M should be close to 1');
  assert.ok(mFactorLookup(3500, 12, 6, 70) > 2.5, 'a long path should be strongly oblique');
});

test('mFactorLookup: no cliff at the old hop transition', function() {
  // The hard switch at 4186 km used to put a 22% step in the MUF. Indexing by
  // total distance means there is nothing to step.
  var prev = mFactorLookup(3800, 12, 6, 70);
  for (var d = 3900; d <= 5000; d += 100) {
    var v = mFactorLookup(d, 12, 6, 70);
    assert.ok(Math.abs(v - prev) < 0.35,
      'jump of ' + (v - prev).toFixed(2) + ' in M between ' + (d - 100) + ' and ' + d + ' km');
    prev = v;
  }
});

test('mFactorLookup: clamps beyond the tabulated envelope, never extrapolates', function() {
  var near = mFactorLookup(250, 12, 6, 70);
  assert.equal(mFactorLookup(10, 12, 6, 70), near, 'short distances clamp');
  var far = mFactorLookup(12000, 12, 6, 70);
  assert.equal(mFactorLookup(40000, 12, 6, 70), far, 'long distances clamp');
  assert.equal(mFactorLookup(3000, 12, 6, 5000), mFactorLookup(3000, 12, 6, 150),
    'solar activity clamps to the tabulated top');
});

test('mFactorLookup: rejects bad input rather than guessing', function() {
  assert.equal(mFactorLookup(NaN, 12, 6, 70), null);
  assert.equal(mFactorLookup(-100, 12, 6, 70), null);
  assert.equal(mFactorLookup(3000, 12, 0, 70), null);
  assert.equal(mFactorLookup(3000, 12, 13, 70), null);
});

test('assessFrequency: uses the table when given a distance, secant when not', function() {
  var base = { takeoffDeg: 6, layerKm: 360, midLon: 0, latDeg: 35, magLatDeg: 40,
               month: 6, utcHour: 12, sfi: null, hops: 1 };
  var without = assessFrequency(base);
  var withD = assessFrequency(Object.assign({}, base, { distKm: 3000 }));
  assert.equal(without.mFactorSource, 'secant');
  assert.equal(withD.mFactorSource, 'table');
  assert.ok(withD.muf > 0 && isFinite(withD.muf));
  // Same foF2 either way — only the geometry differs.
  assert.ok(Math.abs(withD.foF2 - without.foF2) < 1e-9);
});

test('the M table reports the accuracy it was measured at', function() {
  assert.ok(MFACTOR_ACCURACY_PCT > 0 && MFACTOR_ACCURACY_PCT < 8,
    'held-out M accuracy should be recorded and single-digit: ' + MFACTOR_ACCURACY_PCT);
});


// ── DE-BIAS TRACKS THE LIVE SOURCE ───────────────────────────────────────────
// The min-order correction is proportional to the per-point error of whatever
// is supplying foF2. It was hardcoded at the physical model's 0.13 and left
// there when the lookup table cut that to 0.012, inflating multi-hop foF2 by
// 7-11% instead of ~1% — the +4% transequatorial bias of Part 16.

test('foF2PointSigma: reports the error of the source actually in use', function() {
  var s = foF2PointSigma();
  assert.ok(s === FOF2_SIGMA_TABLE || s === FOF2_SIGMA_MAP,
    'sigma must come from a real source, got ' + s);
  assert.ok(FOF2_SIGMA_TABLE < FOF2_SIGMA_MAP, 'the table must be the better source');
  assert.ok(FOF2_SIGMA_TABLE < 0.03, 'table per-point error should be a couple of percent');
});

test('minOrderCorrection: scales with sigma, and vanishes as sigma does', function() {
  assert.equal(minOrderCorrection(2, 0), 1, 'a perfect source needs no de-bias');
  assert.equal(minOrderCorrection(3, 0), 1);
  assert.ok(minOrderCorrection(2, 0.012) < 1.01, 'with the table it is under 1%');
  assert.ok(minOrderCorrection(2, 0.13) > 1.07, 'with the physical model it is 7%+');
  // Monotonic in both arguments.
  assert.ok(minOrderCorrection(3, 0.05) > minOrderCorrection(2, 0.05));
  assert.ok(minOrderCorrection(2, 0.10) > minOrderCorrection(2, 0.05));
  assert.equal(minOrderCorrection(1, 0.13), 1, 'one bounce is never de-biased');
});

test('minOrderCorrection: an explicit sigma overrides the live source', function() {
  assert.ok(Math.abs(minOrderCorrection(2, 0.13) - (1 + 0.13 * 0.5642)) < 1e-9);
  assert.notEqual(minOrderCorrection(2, 0.13), minOrderCorrection(2, 0.012));
});


// ── The suggestion must be dialable (v1.37) ──────────────────────────────────
// At solar max on a long path the FOT itself can sit above 30 MHz — which an
// AN/PRC-160 cannot tune — and in deep polar night the MUF can sit under the
// 2 MHz floor. Both escaped into "aim ≈33.3 MHz" style advice.

test('suggested frequency never leaves the 2-30 MHz band', function() {
  const solarMax = assessFrequency({ takeoffDeg: 3, layerKm: 360, midLon: 0,
    latDeg: 20, magLatDeg: 15, modipDeg: 18, month: 3, utcHour: 14,
    sfi: 250, distKm: 3800, hops: 1, txWatts: 150 });
  assert.ok(solarMax.suggestedMHz <= 30,
    'solar max suggested ' + solarMax.suggestedMHz + ' MHz — the radio tops out at 30');
  const polarNight = assessFrequency({ takeoffDeg: 5, layerKm: 360, midLon: 20,
    latDeg: 78, magLatDeg: 76, modipDeg: 78, month: 1, utcHour: 2,
    sfi: 60, distKm: 3000, hops: 1, txWatts: 2 });
  assert.ok(polarNight.suggestedMHz >= 2,
    'polar night suggested ' + polarNight.suggestedMHz + ' MHz — below the noise floor');
});

// ── SOI mode: ranking assigned frequencies (v1.44) ──────────────────────────
// Operators are ISSUED a handful of frequencies, not free to pick. The real
// question is which of the assigned set closes now, and which closes when.

test('rankAssignedFrequencies puts usable-now first, then soonest-to-open', function() {
  const base = { takeoffDeg: 8, layerKm: 360, midLon: 0, latDeg: 40, magLatDeg: 42,
    modipDeg: 44, month: 6, distKm: 2500, hops: 1, txWatts: 20, sfi: 110 };
  const ranked = rankAssignedFrequencies(base, [3.5, 7.2, 14.2, 21.3, 28.5], 14);
  assert.equal(ranked.length, 5);
  // Every usable-now entry precedes every not-usable-now entry.
  let seenClosed = false;
  for (const r of ranked) {
    if (!r.usableNow) seenClosed = true;
    else assert.equal(seenClosed, false, 'a usable freq ranked below a closed one');
  }
  // A GOOD freq outranks a merely-marginal one.
  const good = ranked.find(r => r.verdict && r.verdict.code === 'good');
  const near = ranked.find(r => r.verdict && r.verdict.code === 'near_muf');
  if (good && near) {
    assert.ok(ranked.indexOf(good) < ranked.indexOf(near));
  }
  // Closed entries carry when they open (or null for never), soonest first.
  const closed = ranked.filter(r => !r.usableNow);
  for (let i = 1; i < closed.length; i++) {
    const a = closed[i - 1].next ? closed[i - 1].next.inHours : 999;
    const b = closed[i].next ? closed[i].next.inHours : 999;
    assert.ok(a <= b, 'closed freqs not ordered by soonest opening');
  }
});

test('rankAssignedFrequencies ignores junk entries', function() {
  const base = { takeoffDeg: 10, layerKm: 360, midLon: 0, latDeg: 30, magLatDeg: 30,
    modipDeg: 30, month: 3, distKm: 1500, hops: 1, txWatts: 20, sfi: 90 };
  const ranked = rankAssignedFrequencies(base, [14.2, NaN, -5, 0, 'x', 7.0], 12);
  assert.equal(ranked.length, 2, 'only the two valid frequencies should survive');
});
