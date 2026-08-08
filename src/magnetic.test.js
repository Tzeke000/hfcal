// Unit tests for magnetic.js — run with `npm test` (node --test).
// Declination values are cross-checked against published NOAA/NCEI figures
// for the WMM 2025 epoch (tolerances are generous because declination drifts
// measurably year to year and these are checked against the current date).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  declination, trueToMagnetic, magneticToTrue, formatDeclination,
  norm360, relativeTurn, isDeclinationModelCurrent, WMM_VALID_UNTIL,
  magneticLatitude,
} from './magnetic.js';

function approx(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol,
    (msg || '') + ' expected ' + expected + ' ±' + tol + ', got ' + actual);
}

test('declination: matches published values at known sites', function() {
  // Westerly on the east coast, easterly on the west coast — the sign flip
  // is the whole reason this module exists.
  approx(declination(34.9008, -76.8806), -10.3, 1.5, 'MCAS Cherry Point NC');
  approx(declination(34.23, -116.05), 10.9, 1.5, '29 Palms CA');
  approx(declination(44.45475, -83.39281), -7.6, 1.5, 'Oscoda MI');
  approx(declination(26.34, 127.80), -5.9, 2.0, 'Okinawa');
});

test('declination: rejects bad input rather than guessing', function() {
  assert.equal(declination(91, 0), null);
  assert.equal(declination(-91, 0), null);
  assert.equal(declination(0, 181), null);
  assert.equal(declination(NaN, 0), null);
  assert.equal(declination('x', 0), null);
  assert.equal(declination(undefined, undefined), null);
});

test('declination: still returns a value past the model epoch', function() {
  // Better a slightly stale declination than none; the UI flags staleness
  // separately via isDeclinationModelCurrent().
  var future = new Date(WMM_VALID_UNTIL.getTime() + 5 * 365 * 86400000);
  var d = declination(34.9008, -76.8806, future);
  assert.ok(typeof d === 'number' && isFinite(d), 'should still compute, got ' + d);
  assert.equal(isDeclinationModelCurrent(future), false);
  assert.equal(isDeclinationModelCurrent(new Date('2026-06-01')), true);
});

test('norm360 wraps every direction', function() {
  assert.equal(norm360(0), 0);
  assert.equal(norm360(360), 0);
  assert.equal(norm360(370), 10);
  assert.equal(norm360(-10), 350);
  assert.equal(norm360(-370), 350);
  assert.ok(isNaN(norm360('x')));
});

test('trueToMagnetic: west declination raises the compass number', function() {
  // Cherry Point, ~10 W: a 279 true bearing is dialled as ~289 magnetic.
  approx(trueToMagnetic(279, -10.25), 289.25, 0.01);
  // 29 Palms, ~11 E: the correction runs the other way.
  approx(trueToMagnetic(279, 10.89), 268.11, 0.01);
  // Zero declination changes nothing
  approx(trueToMagnetic(123.4, 0), 123.4, 1e-9);
});

test('trueToMagnetic / magneticToTrue: wrap correctly and round-trip', function() {
  approx(trueToMagnetic(5, 10), 355, 1e-9, 'wraps below zero');
  approx(magneticToTrue(355, 10), 5, 1e-9, 'wraps back above 360');
  [0, 45, 179, 180, 270, 359.9].forEach(function(b) {
    [-15, -10.25, 0, 3.2, 12].forEach(function(d) {
      approx(magneticToTrue(trueToMagnetic(b, d), d), b, 1e-9, 'round-trip ' + b + '/' + d);
    });
  });
});

test('trueToMagnetic: refuses to invent a number from bad input', function() {
  assert.ok(isNaN(trueToMagnetic(NaN, 5)));
  assert.ok(isNaN(trueToMagnetic(90, NaN)));
  assert.ok(isNaN(trueToMagnetic(90, null)));
  assert.ok(isNaN(magneticToTrue(90, undefined)));
});

test('formatDeclination reads like a map margin', function() {
  assert.equal(formatDeclination(-10.25), '10.3° W');
  assert.equal(formatDeclination(3.4), '3.4° E');
  assert.equal(formatDeclination(0), '0.0° E');
  assert.equal(formatDeclination(NaN), '');
});

test('relativeTurn gives the short way round', function() {
  assert.equal(relativeTurn(0, 90), 90);
  assert.equal(relativeTurn(0, 270), -90);
  assert.equal(relativeTurn(10, 350), -20);
  assert.equal(relativeTurn(350, 10), 20);
  assert.equal(relativeTurn(0, 180), 180);
  assert.ok(Math.abs(relativeTurn(45, 200)) <= 180);
});


// ── GEOMAGNETIC LATITUDE ─────────────────────────────────────────────────────
// Derived from the WMM dip angle I via tan(I) = 2*tan(magLat) — the dipole
// relation. Used by the frequency advisor, because the ionosphere is organised
// by the magnetic field, not by geography.

test('magneticLatitude: the dip equator is offset from the geographic one', function() {
  // The magnetic equator is not the geographic equator. Over Africa and the
  // Atlantic it runs well NORTH of 0 deg, so a station on the geographic
  // equator there reads magnetically southern; over the eastern Pacific the
  // offset reverses. Both are standard WMM/IGRF features.
  var africa = magneticLatitude(0, 0);
  var pacific = magneticLatitude(0, -120);
  assert.ok(africa < -10, 'equator at 0E should read well south magnetically, got ' + africa);
  assert.ok(pacific > 0, 'equator at 120W should read north magnetically, got ' + pacific);
  // The offset is real but bounded — it never approaches a full hemisphere.
  for (var lon = -180; lon < 180; lon += 20) {
    assert.ok(Math.abs(magneticLatitude(0, lon)) < 25, 'dip equator offset too large at ' + lon);
  }
});

test('magneticLatitude: tracks geographic latitude within a sensible offset', function() {
  var pts = [[60, 25], [44.45, -83.39], [34.9, -76.88], [-44, 171]];
  pts.forEach(function(p) {
    var m = magneticLatitude(p[0], p[1]);
    assert.equal(typeof m, 'number');
    assert.ok(Math.abs(m) <= 90);
    assert.equal(Math.sign(m), Math.sign(p[0]), 'hemisphere should match at ' + p);
    assert.ok(Math.abs(m - p[0]) < 25, 'offset too large at ' + p + ': ' + m);
  });
});

test('magneticLatitude: monotonic along a meridian', function() {
  var prev = magneticLatitude(-70, -76.88);
  for (var lat = -60; lat <= 70; lat += 10) {
    var cur = magneticLatitude(lat, -76.88);
    assert.ok(cur > prev, 'should increase northward, broke at ' + lat);
    prev = cur;
  }
});

test('magneticLatitude: rejects bad input instead of guessing', function() {
  assert.equal(magneticLatitude(null, 0), null);
  assert.equal(magneticLatitude(0, undefined), null);
  assert.equal(magneticLatitude(NaN, 0), null);
  assert.equal(magneticLatitude(91, 0), null);
  assert.equal(magneticLatitude(0, -181), null);
});

test('magneticLatitude: still answers past the WMM epoch', function() {
  var after = new Date(WMM_VALID_UNTIL.getTime() + 400 * 86400000);
  var m = magneticLatitude(34.9, -76.88, after);
  assert.equal(typeof m, 'number');
  assert.ok(Math.abs(m - magneticLatitude(34.9, -76.88)) < 5);
});
