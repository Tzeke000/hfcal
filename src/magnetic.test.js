// Unit tests for magnetic.js — run with `npm test` (node --test).
// Declination values are cross-checked against published NOAA/NCEI figures
// for the WMM 2025 epoch (tolerances are generous because declination drifts
// measurably year to year and these are checked against the current date).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  declination, trueToMagnetic, magneticToTrue, formatDeclination,
  norm360, relativeTurn, isDeclinationModelCurrent, WMM_VALID_UNTIL,
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
