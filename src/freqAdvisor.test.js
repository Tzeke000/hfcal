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
  estimateLUF, DEFAULT_TX_WATTS, LUF_FLOOR_MHZ,
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

test('estimateLUF: matches the historical 20 W calibration', function() {
  // The pre-v1.15 model was LUF = 2.0 + 3.5*illumination at manpack power.
  // 20 W is also the AN/PRC-160 GLOBAL setting. The new form must reproduce
  // both anchors of the old curve exactly.
  assert.ok(Math.abs(estimateLUF(1, 20, 1) - 5.5) < 0.02, 'full sun 20 W should be 5.5 MHz');
  assert.equal(estimateLUF(0, 20, 1), LUF_FLOOR_MHZ, 'darkness should sit on the noise floor');
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
    var v = estimateLUF(1, w, 1);
    assert.ok(v < prev, 'each step up the ladder must lower the LUF, broke at ' + w + ' W');
    assert.ok(isFinite(v) && v >= LUF_FLOOR_MHZ, 'bad LUF at ' + w + ' W: ' + v);
    prev = v;
  });
  // At night the whole ladder collapses onto the noise floor — absorption is
  // not what limits you in the dark, so power stops mattering.
  ladder.forEach(function(w) {
    assert.equal(estimateLUF(0, w, 1), LUF_FLOOR_MHZ, 'night LUF should not depend on power');
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
