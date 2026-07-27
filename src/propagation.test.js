// Unit tests for propagation.js — run with `npm test` (node --test).
//
// Expected values are pinned against published radio propagation theory:
//  - Curved-earth skip geometry α = atan[(cosθ − R/(R+h))/sinθ], θ = d/2R,
//    at the F2 effective virtual reflection height (360 km).
//  - Ionospheric layer heights: E 90–130 km, F1 ≈ 200 km, F2 250–400 km.
//  - Geometric max single-hop for a 0° launch: d_max = 2·√(2·R·h).
//    Practice values: E ≈ 2000 km, F2 ≈ 4000–4500 km per hop.
//  - Great-circle distances checked against known city pairs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EARTH_RADIUS_KM, geodesics, propagationZone, bearingToCardinal,
  calcTakeoffAngle, groundWaveMultiplier, chordalHopPossible, HOP, calcHops,
} from './propagation.js';

function approx(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol,
    (msg || '') + ' expected ' + expected + ' ±' + tol + ', got ' + actual);
}

// ── geodesics ────────────────────────────────────────────────────────────────

test('geodesics: known city pairs (great-circle)', function() {
  // JFK → LHR: published great-circle ≈ 5540-5560 km
  var g1 = geodesics(40.6413, -73.7781, 51.4700, -0.4543);
  approx(g1.distKm, 5550, 40, 'JFK-LHR');
  // LA → NYC: ≈ 3936 km
  var g2 = geodesics(34.0522, -118.2437, 40.7128, -74.0060);
  approx(g2.distKm, 3936, 30, 'LA-NYC');
  approx(g2.distMi, g2.distKm * 0.621371, 0.01, 'mi conversion');
});

test('geodesics: bearing basics on the equator and meridian', function() {
  approx(geodesics(0, 0, 0, 10).bearing, 90, 0.01, 'due east');
  approx(geodesics(0, 0, 10, 0).bearing, 0, 0.01, 'due north');
  approx(geodesics(0, 0, -10, 0).bearing, 180, 0.01, 'due south');
  approx(geodesics(0, 10, 0, 0).bearing, 270, 0.01, 'due west');
});

test('geodesics: zero distance and symmetry', function() {
  approx(geodesics(33.9, -118.4, 33.9, -118.4).distKm, 0, 1e-9);
  var ab = geodesics(40.6413, -73.7781, 51.47, -0.4543).distKm;
  var ba = geodesics(51.47, -0.4543, 40.6413, -73.7781).distKm;
  approx(ab, ba, 1e-9, 'distance symmetric');
});

// ── zones & cardinals ────────────────────────────────────────────────────────

test('propagationZone boundaries', function() {
  assert.equal(propagationZone(79), 'groundwave');
  assert.equal(propagationZone(80), 'nvis');
  assert.equal(propagationZone(499), 'nvis');
  assert.equal(propagationZone(500), 'singlehop');
  assert.equal(propagationZone(1999), 'singlehop');
  assert.equal(propagationZone(2000), 'mediumdx');
  assert.equal(propagationZone(4000), 'longdx');
});

test('bearingToCardinal quadrants and wraparound', function() {
  assert.equal(bearingToCardinal(0), 'N');
  assert.equal(bearingToCardinal(90), 'E');
  assert.equal(bearingToCardinal(180), 'S');
  assert.equal(bearingToCardinal(270), 'W');
  assert.equal(bearingToCardinal(359), 'N');
  assert.equal(bearingToCardinal(45), 'NE');
});

// ── takeoff angle ────────────────────────────────────────────────────────────

test('calcTakeoffAngle: curved-earth baseline matches theory (F2 virtual height)', function() {
  // α = atan[(cosθ − R/(R+h)) / sinθ], θ = d/2R — curved-earth mirror
  // geometry (Davies) at the calibrated F2 virtual height (360 km, the
  // median of VOACAP's virtual-height output). Values cross-checked
  // against VOACAP medians in docs/VALIDATION.md.
  var h = HOP.F2.hKm;
  approx(calcTakeoffAngle(250, 7, h, null).baseDeg, 69.8, 0.2, '250 km');
  approx(calcTakeoffAngle(500, 7, h, null).baseDeg, 53.3, 0.2, '500 km');
  var t1500 = calcTakeoffAngle(1500, 7, h, null);
  approx(t1500.baseDeg, 21.6, 0.2, '1500 km');
  approx(calcTakeoffAngle(3000, 14, h, null).baseDeg, 6.3, 0.2, '3000 km');
  // No terrain → no adjustments, final == base
  assert.equal(t1500.adjustments.length, 0);
  approx(t1500.finalDeg, t1500.baseDeg, 0.11);
});

test('calcTakeoffAngle: angle floors at 0 near the geometric hop limit', function() {
  // At 4500 km the h=360 geometry has passed its limit — baseline floors
  // at 0 and the operational clamp raises the final angle to 3°.
  var t = calcTakeoffAngle(4500, 14, HOP.F2.hKm, null);
  assert.equal(t.baseDeg, 0);
  assert.equal(t.finalDeg, 3);
});

test('calcTakeoffAngle: clamps to the physical 3–85° window', function() {
  // Absurdly long single hop → tiny geometric angle → clamped up to 3°
  assert.equal(calcTakeoffAngle(30000, 14, HOP.F2.hKm, null).finalDeg, 3);
  // Absurdly short skywave hop → near-vertical → clamped to 85°
  assert.equal(calcTakeoffAngle(1, 7, HOP.F2.hKm, null).finalDeg, 85);
});

test('calcTakeoffAngle: near-field mountain raises angle to clear ridgeline', function() {
  // 4000 m ridge 20 km out on a 3000 km path: clearance = atan(4/20)+2 ≈ 13.3°
  // exceeds the 12.4° baseline → angle raised, adjustment recorded.
  var terrain = { keyObstacle: { elev: 4000, frac: 20 / 3000, name: 'Test Ridge' }, mountainFrac: 0.1 };
  var t = calcTakeoffAngle(3000, 14, HOP.F2.hKm, terrain);
  approx(t.finalDeg, 13.3, 0.2);
  assert.equal(t.adjustments[0].type, 'mountain_clearance');
});

test('calcTakeoffAngle: ocean path flattens, desert path raises', function() {
  var ocean = calcTakeoffAngle(1500, 14, HOP.F2.hKm, { oceanFrac: 0.9 });
  approx(ocean.finalDeg, 21.6 - 3, 0.2, 'heavy ocean −3°');
  assert.equal(ocean.adjustments[0].type, 'ocean');
  var desert = calcTakeoffAngle(1500, 14, HOP.F2.hKm, { oceanFrac: 0, desertFrac: 0.5 });
  approx(desert.finalDeg, 21.6 + 2, 0.2, 'desert +2°');
});

test('calcTakeoffAngle: chordal hop reduces the angle ~30%', function() {
  var t = calcTakeoffAngle(3200, 14, HOP.F2.hKm, { oceanFrac: 0.6 });
  assert.equal(t.chordal, true);
  assert.ok(t.finalDeg < t.baseDeg, 'chordal final below baseline');
  assert.ok(t.finalDeg >= 3, 'still above clamp floor');
});

// ── chordal / groundwave helpers ─────────────────────────────────────────────

test('chordalHopPossible: all three conditions required', function() {
  assert.equal(chordalHopPossible(3500, 14, 0.6), true);
  assert.equal(chordalHopPossible(3000, 14, 0.6), false); // too short
  assert.equal(chordalHopPossible(3500, 9, 0.6), false);  // freq too low
  assert.equal(chordalHopPossible(3500, 29, 0.6), false); // freq too high
  assert.equal(chordalHopPossible(3500, 14, 0.5), false); // not enough ocean
});

test('groundWaveMultiplier: sea water beats average land', function() {
  approx(groundWaveMultiplier(3), 1, 1e-9, 'average land baseline');
  approx(groundWaveMultiplier(12), 2, 1e-9);
  assert.ok(groundWaveMultiplier(5000) > groundWaveMultiplier(3), 'sea water >> land');
});

// ── hop model vs. theory ─────────────────────────────────────────────────────

test('HOP: layer heights within published ranges', function() {
  assert.ok(HOP.E.hKm >= 90 && HOP.E.hKm <= 130, 'E layer 90-130 km');
  assert.ok(HOP.F1.hKm >= 150 && HOP.F1.hKm <= 250, 'F1 layer ~200 km');
  assert.ok(HOP.F2.hKm >= 250 && HOP.F2.hKm <= 400, 'F2 layer 250-400 km');
});

test('HOP: max hop distances within the geometric limit 2·√(2·R·h)', function() {
  // A 0° tangential launch bounds the single-hop range; each layer's practical
  // max must not exceed the geometry for the top of its height range.
  var tops = { E: 130, F1: 250, F2: 400 };
  Object.keys(tops).forEach(function(k) {
    var geoMax = 2 * Math.sqrt(2 * EARTH_RADIUS_KM * tops[k]);
    assert.ok(HOP[k].maxHopKm <= geoMax + 1,
      k + ': ' + HOP[k].maxHopKm + ' km exceeds geometric limit ' + geoMax.toFixed(0));
  });
  // And sanity-match published practice: E ≈ 2000, F2 ≈ 4000–4500
  assert.ok(HOP.E.maxHopKm >= 1800 && HOP.E.maxHopKm <= 2400);
  assert.ok(HOP.F2.maxHopKm >= 4000 && HOP.F2.maxHopKm <= 4515);
});

test('calcHops: layer selection by frequency', function() {
  var low = calcHops(1000, 7, null);
  assert.deepEqual(low.map(function(r) { return r.layer; }), ['E Layer', 'F2 Layer']);
  var high = calcHops(1000, 14, null);
  assert.deepEqual(high.map(function(r) { return r.layer; }), ['F1 Layer', 'F2 Layer']);
});

test('calcHops: hop count and per-hop distance', function() {
  var r = calcHops(9000, 14, null);
  var f2 = r[1];
  assert.equal(f2.hops, 2);                       // 9000 / 4500
  approx(f2.hopDistKm, 4500, 1e-9);
  assert.equal(f2.reflectFracs.length, 1);        // one ground bounce
  approx(f2.reflectFracs[0], 0.5, 1e-9);
  // Per-hop distance sits at the geometric limit for h=330 — curved-earth
  // baseline floors at 0, operational clamp lifts the final angle to 3°.
  assert.equal(f2.toa.baseDeg, 0);
  assert.equal(f2.toa.finalDeg, 3);
});

test('calcHops: single hop short path', function() {
  var r = calcHops(800, 7, null);
  r.forEach(function(layer) {
    assert.equal(layer.hops, 1);
    assert.equal(layer.reflectFracs.length, 0);
    assert.equal(layer.bounceTerrainNote, null);
  });
});
