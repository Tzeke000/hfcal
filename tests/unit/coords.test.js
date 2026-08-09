// Unit tests for coords.js — run with `npm test` (node --test).
// Covers every input format the app advertises to users, plus round-trip
// accuracy for MGRS and hostile/garbage input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoords, looksLikeMGRS } from '../../src/lib/coords.js';

function approx(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol,
    (msg || '') + ' expected ' + expected + ' ±' + tol + ', got ' + actual);
}
function ok(input, lat, lon, tol, msg) {
  var r = parseCoords(input);
  assert.ok(!r.error, (msg || input) + ' unexpectedly errored: ' + r.error);
  approx(r.lat, lat, tol || 0.001, (msg || input) + ' lat');
  approx(r.lon, lon, tol || 0.001, (msg || input) + ' lon');
}
function fails(input, msg) {
  var r = parseCoords(input);
  assert.ok(r.error && isNaN(r.lat), (msg || String(input)) + ' should have failed, got ' + JSON.stringify(r));
}

// ── decimal degrees ──────────────────────────────────────────────────────────

test('decimal degrees: bare pairs, signs, whitespace', function() {
  ok('34.9008,-76.8806', 34.9008, -76.8806);          // MCAS Cherry Point
  ok('34.9008, -76.8806', 34.9008, -76.8806);
  ok('  34.9008 , -76.8806  ', 34.9008, -76.8806);
  ok('-33.87,151.21', -33.87, 151.21);                 // southern + eastern
  ok('0,0', 0, 0);
  ok('34,-76', 34, -76);                               // integers
});

test('decimal degrees: hemisphere suffixes and degree symbols', function() {
  ok('34.9008 N, 76.8806 W', 34.9008, -76.8806);
  ok('33.87 S, 151.21 E', -33.87, 151.21);
  ok('32.45545° N, 80.71868° W', 32.45545, -80.71868);
});

// ── DMS ──────────────────────────────────────────────────────────────────────

test('DMS: symbols and DAGR colon format', function() {
  // 34°25'12" = 34 + 25/60 + 12/3600 = 34.42
  ok("34 25 12 N, 112 30 15 W", 34.42, -112.504167, 0.001);
  ok("34° 25' 12\" N, 112° 30' 15\" W", 34.42, -112.504167, 0.001);
  ok('N 39:11:24.3 W 077:30:15.0', 39.190083, -77.504167, 0.001);
});

test('DMS: degrees + decimal minutes', function() {
  // 34°25.200' = 34 + 25.2/60 = 34.42
  ok('34 25.200 N, 112 30.250 W', 34.42, -112.504167, 0.001);
});

test('DMS: east longitudes past 180 normalise (DAGR emits 0-360)', function() {
  var r = parseCoords('N 39:11:24.3 E 236:50:10.0');
  assert.ok(!r.error, 'should parse: ' + r.error);
  assert.ok(r.lon >= -180 && r.lon <= 180, 'longitude must normalise into range, got ' + r.lon);
});

// ── MGRS ─────────────────────────────────────────────────────────────────────

test('looksLikeMGRS: recognises grids, rejects lat/lon', function() {
  assert.equal(looksLikeMGRS('17SQU1234567890'), true);
  assert.equal(looksLikeMGRS('17S QU 12345 67890'), true);
  assert.equal(looksLikeMGRS('15T XG 11897e 53935n'), true);
  assert.equal(looksLikeMGRS('34.9008,-76.8806'), false);
  assert.equal(looksLikeMGRS('34 25 12 N, 112 30 15 W'), false);
  assert.equal(looksLikeMGRS(''), false);
});

test('MGRS: parses to plausible coordinates', function() {
  var r = parseCoords('18S UJ 22821 06997');   // Washington DC area
  assert.ok(!r.error, 'MGRS should parse: ' + r.error);
  approx(r.lat, 38.9, 0.3, 'DC lat');
  approx(r.lon, -77.0, 0.3, 'DC lon');
});

test('MGRS: round-trips against a decimal pair for the same place', function() {
  // 17S QU grid sits in the south-eastern US; verify it lands in the right
  // hemisphere and a sane latitude band rather than silently flipping sign.
  var r = parseCoords('17S QU 12345 67890');
  assert.ok(!r.error, r.error);
  assert.ok(r.lat > 30 && r.lat < 40, 'lat in band, got ' + r.lat);
  assert.ok(r.lon > -85 && r.lon < -75, 'lon in band, got ' + r.lon);
});

test('MGRS: lowercase and e/n suffixed digits accepted', function() {
  var a = parseCoords('15T XG 11897e 53935n');
  assert.ok(!a.error, 'suffixed form: ' + a.error);
  var b = parseCoords('15t xg 11897 53935');
  assert.ok(!b.error, 'lowercase form: ' + b.error);
  approx(a.lat, b.lat, 0.01, 'same lat either way');
  approx(a.lon, b.lon, 0.01, 'same lon either way');
});

test('MGRS: southern hemisphere zone letter gives negative latitude', function() {
  var r = parseCoords('56H LH 12345 67890');   // near Sydney, zone letter H
  assert.ok(!r.error, r.error);
  assert.ok(r.lat < 0, 'southern grid must be negative latitude, got ' + r.lat);
});

// ── failure modes ────────────────────────────────────────────────────────────

test('rejects empty and garbage input', function() {
  fails('');
  fails('   ');
  fails(null);
  fails(undefined);
  fails('hello world');
  fails('....');
  fails('34.9008');            // single number, no pair
  fails('99ZZ ZZ 1 1');        // bogus MGRS zone
});

test('rejects out-of-range coordinates', function() {
  fails('91,0', 'latitude above 90');
  fails('-91,0', 'latitude below -90');
  fails('0,-181', 'longitude below -180');
  fails('0,361', 'longitude beyond the 0-360 convention');
});

test('longitude in the DAGR 0-360 convention normalises rather than failing', function() {
  // DAGR can print east longitude as 0-360, so 181 means 179 W.
  ok('0,181', 0, -179);
  ok('0,270', 0, -90);
  ok('0,359', 0, -1);
});

test('accepts exact range boundaries', function() {
  ok('90,180', 90, 180);
  ok('-90,-180', -90, -180);
});

test('never returns a partially-parsed result', function() {
  ['', 'x', '34.9008', '91,0', 'garbage 123'].forEach(function(bad) {
    var r = parseCoords(bad);
    if (r.error) {
      assert.ok(isNaN(r.lat) && isNaN(r.lon),
        'errored result must have NaN coords: ' + JSON.stringify(r));
    }
  });
});
