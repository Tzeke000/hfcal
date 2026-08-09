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
  EARTH_RADIUS_KM, geodesics, initialBearing, propagationZone, bearingToCardinal,
  calcTakeoffAngle, groundWaveMultiplier, chordalHopPossible, HOP, calcHops,
  pathMidpoint,
  maxHopKm,
  interpolatePath, reflectionPoints,
} from '../../src/physics/propagation.js';

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

test('geodesics: bearing runs FROM your station TO the target', function() {
  // Direction convention guard. 29 Palms CA -> San Diego CA is south-west;
  // if the arguments were ever swapped this would read north-east instead.
  var g = geodesics(34.23, -116.05, 32.72, -117.16);
  approx(g.bearing, 211.8, 0.5, '29 Palms -> San Diego');
  assert.equal(bearingToCardinal(g.bearing), 'SSW');
  // Real-world check both ways: LA -> NYC is ENE, NYC -> LA is W-ish.
  approx(geodesics(34.0522, -118.2437, 40.7128, -74.0060).bearing, 65.9, 0.5);
  approx(geodesics(40.7128, -74.0060, 34.0522, -118.2437).bearing, 273.7, 0.5);
});

test('geodesics: backBearing is what the far station aims at', function() {
  var g = geodesics(34.0522, -118.2437, 40.7128, -74.0060);
  // Equals the initial bearing computed in the opposite direction
  approx(g.backBearing, initialBearing(40.7128, -74.0060, 34.0522, -118.2437), 1e-9);
  approx(g.backBearing, 273.7, 0.5);
  // On a long great circle it is NOT simply bearing + 180
  var naive = (g.bearing + 180) % 360;
  assert.ok(Math.abs(g.backBearing - naive) > 5,
    'back azimuth should differ from bearing+180 on this path');
  // ...but on a meridian it is exactly the reciprocal
  var m = geodesics(0, 0, 10, 0);
  approx(m.bearing, 0, 1e-9);
  approx(m.backBearing, 180, 1e-9);
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
  // Exactly two F2 hops by construction, so the split is unambiguous.
  var d = 2 * HOP.F2.maxHopKm - 200;
  var f2 = calcHops(d, 14, null)[1];
  assert.equal(f2.hops, 2);
  approx(f2.hopDistKm, d / 2, 1e-9);
  assert.equal(f2.reflectFracs.length, 1);        // one ground bounce
  approx(f2.reflectFracs[0], 0.5, 1e-9);
});

test('calcHops: a hop at the layer limit launches along the horizon', function() {
  // At exactly maxHopKm the curved-earth baseline is 0° by definition. The
  // app still reports its 3° operational floor, because no field antenna
  // radiates at the horizon — the clamp is honest, not a fudge.
  var f2 = calcHops(HOP.F2.maxHopKm, 14, null)[1];
  assert.equal(f2.hops, 1);
  assert.equal(f2.toa.baseDeg, 0);
  assert.equal(f2.toa.finalDeg, 3);
});

test('calcHops: never asks a hop to exceed its own layer geometry', function() {
  // The bug this pins: HOP.F2 once carried a hand-entered 4500 km max hop
  // while its height (360 km) only supports 4186 km, so 4200-4500 km paths
  // were reported as a single hop the geometry cannot produce.
  [800, 2000, 3000, 4000, 4300, 6000, 9000, 15000].forEach(function(d) {
    calcHops(d, 7, null).concat(calcHops(d, 14, null)).forEach(function(r) {
      var layer = [HOP.E, HOP.F1, HOP.F2].find(function(l) { return l.label === r.layer; });
      assert.ok(r.hopDistKm <= layer.maxHopKm + 1e-6,
        r.layer + ' at ' + d + ' km: hop of ' + r.hopDistKm.toFixed(0)
        + ' km exceeds its ' + layer.maxHopKm.toFixed(0) + ' km limit');
    });
  });
});

test('calcHops: single hop short path', function() {
  var r = calcHops(800, 7, null);
  r.forEach(function(layer) {
    assert.equal(layer.hops, 1);
    assert.equal(layer.reflectFracs.length, 0);
    assert.equal(layer.bounceTerrainNote, null);
  });
});


// ── PATH MIDPOINT ────────────────────────────────────────────────────────────
// The reflection point drives local solar time and magnetic latitude in the
// frequency advisor, so it has to survive the antimeridian.

test('pathMidpoint: halfway along a meridian', function() {
  var m = pathMidpoint(0, 0, 60, 0);
  approx(m.lat, 30, 1e-6);
  approx(m.lon, 0, 1e-6);
});

test('pathMidpoint: equatorial path splits the longitude', function() {
  var m = pathMidpoint(0, -80, 0, -60);
  approx(m.lat, 0, 1e-6);
  approx(m.lon, -70, 1e-6);
});

test('pathMidpoint: does not fly to the far side of the planet across the dateline', function() {
  // Guam to Hawaii. A naive (lon1+lon2)/2 gives about -13 deg — the middle of
  // Africa — which would shift local solar time by roughly twelve hours.
  var m = pathMidpoint(13.4, 144.8, 21.3, -157.9);
  assert.ok(m.lon > 160 || m.lon < -170, 'midpoint should stay in the Pacific, got ' + m.lon);
  assert.ok(m.lat > 13 && m.lat < 25, 'latitude should stay between the endpoints, got ' + m.lat);
  // Exactly on the dateline
  var d = pathMidpoint(0, 170, 0, -170);
  assert.ok(Math.abs(Math.abs(d.lon) - 180) < 1e-6, 'expected +/-180, got ' + d.lon);
});

test('pathMidpoint: symmetric and idempotent for a zero-length path', function() {
  var a = pathMidpoint(34.9, -76.88, 51.5, -0.13);
  var b = pathMidpoint(51.5, -0.13, 34.9, -76.88);
  approx(a.lat, b.lat, 1e-9);
  approx(a.lon, b.lon, 1e-9);
  var same = pathMidpoint(34.9, -76.88, 34.9, -76.88);
  approx(same.lat, 34.9, 1e-6);
  approx(same.lon, -76.88, 1e-6);
});

test('pathMidpoint: lies on the great circle, not the average of endpoints', function() {
  // A high-latitude east-west path bulges poleward of the endpoint latitudes.
  var m = pathMidpoint(60, -20, 60, 20);
  assert.ok(m.lat > 60.5, 'great-circle midpoint should sit north of 60, got ' + m.lat);
  approx(m.lon, 0, 1e-6);
});


// ── LAYER TABLE ──────────────────────────────────────────────────────────────
// Reflection heights and per-hop limits. Published reference: Australian
// Bureau of Meteorology Space Weather Services, "Introduction to HF Radio
// Propagation" — with E and F heights of 100 and 300 km, maximum hop lengths
// are 2000 km and 4000 km at 0° elevation. Measured against VOACAP in
// scripts/validation/studies/run_layer_study.py.

test('maxHopKm: matches the closed-form 0-degree limit', function() {
  var R = EARTH_RADIUS_KM;
  [90, 110, 200, 300, 360, 450].forEach(function(h) {
    approx(maxHopKm(h), 2 * R * Math.acos(R / (R + h)), 1e-9);
  });
  // Published spot values, to the rounding the references themselves use.
  assert.ok(Math.abs(maxHopKm(100) - 2000) < 250, 'E at 100 km should land near 2000 km');
  assert.ok(Math.abs(maxHopKm(300) - 4000) < 250, 'F at 300 km should land near 4000 km');
});

test('maxHopKm: rises with height and stays below the half-circumference', function() {
  var prev = 0;
  for (var h = 50; h <= 500; h += 25) {
    var d = maxHopKm(h);
    assert.ok(d > prev, 'should increase with height, broke at ' + h);
    assert.ok(d < Math.PI * EARTH_RADIUS_KM, 'a single hop cannot span half the planet');
    prev = d;
  }
});

test('HOP: every layer is internally consistent with its own height', function() {
  ['E', 'F1', 'F2'].forEach(function(k) {
    var l = HOP[k];
    approx(l.maxHopKm, maxHopKm(l.hKm), 1e-9);
    // Round-trip: the limit must imply back the height it came from.
    var R = EARTH_RADIUS_KM;
    approx(R / Math.cos(l.maxHopKm / (2 * R)) - R, l.hKm, 1e-6);
  });
});

test('HOP: layers are ordered and land in published ranges', function() {
  assert.ok(HOP.E.hKm < HOP.F1.hKm && HOP.F1.hKm < HOP.F2.hKm);
  assert.ok(HOP.E.maxHopKm < HOP.F1.maxHopKm && HOP.F1.maxHopKm < HOP.F2.maxHopKm);
  // E 90-130 km, F1 ~200 km, F2 virtual height above the 250-400 true layer
  assert.ok(HOP.E.hKm >= 90 && HOP.E.hKm <= 130);
  assert.ok(HOP.F1.hKm >= 160 && HOP.F1.hKm <= 240);
  assert.ok(HOP.F2.hKm >= 250 && HOP.F2.hKm <= 450);
  // VOACAP served single-hop F2 out to ~4400 km in the layer study and stopped
  // offering it entirely past that; the F2 limit must sit in that neighbourhood.
  assert.ok(HOP.F2.maxHopKm > 3800 && HOP.F2.maxHopKm < 4600,
    'F2 single-hop limit ' + HOP.F2.maxHopKm.toFixed(0) + ' km is outside what VOACAP offers');
});


// ── REFLECTION POINTS ────────────────────────────────────────────────────────
// Where the signal actually touches the ionosphere. An n-hop path reflects at
// the middle of each hop — fractions (2k-1)/(2n) — which for two hops is
// neither the midpoint nor either station.

test('interpolatePath: endpoints, midpoint and the dateline', function() {
  var a = interpolatePath(0, 0, 0, 60, 0);
  approx(a.lat, 0, 1e-9); approx(a.lon, 0, 1e-9);
  var b = interpolatePath(0, 0, 0, 60, 1);
  approx(b.lat, 0, 1e-9); approx(b.lon, 60, 1e-6);
  var m = interpolatePath(0, 0, 0, 60, 0.5);
  approx(m.lon, 30, 1e-6);
  // Agrees with the dedicated midpoint routine, including across the dateline.
  var pm = pathMidpoint(13.4, 144.8, 21.3, -157.9);
  var ip = interpolatePath(13.4, 144.8, 21.3, -157.9, 0.5);
  approx(ip.lat, pm.lat, 1e-6);
  approx(ip.lon, pm.lon, 1e-6);
});

test('reflectionPoints: one hop reflects at the midpoint', function() {
  var p = reflectionPoints(34.9, -76.9, 44.45, -70, 1);
  assert.equal(p.length, 1);
  var m = pathMidpoint(34.9, -76.9, 44.45, -70);
  approx(p[0].lat, m.lat, 1e-6);
  approx(p[0].lon, m.lon, 1e-6);
});

test('reflectionPoints: multi-hop bounces are NOT the midpoint or the ends', function() {
  // Two hops on a due-south meridian path: bounces at 1/4 and 3/4.
  var p = reflectionPoints(60, 25, -30, 25, 2);
  assert.equal(p.length, 2);
  approx(p[0].lat, 37.5, 0.01);
  approx(p[1].lat, -7.5, 0.01);
  p.forEach(function(q) { approx(q.lon, 25, 1e-6); });
  // Three hops: 1/6, 1/2, 5/6.
  var t = reflectionPoints(60, 25, -30, 25, 3);
  assert.equal(t.length, 3);
  approx(t[0].lat, 45, 0.01);
  approx(t[1].lat, 15, 0.01);
  approx(t[2].lat, -15, 0.01);
});

test('reflectionPoints: a long path can put bounces in different hemispheres', function() {
  // Finland to South Africa: three bounces, the first far north and the last
  // south of the equator — different hemisphere, therefore opposite season.
  var p = reflectionPoints(60, 25, -30, 25, 3);
  assert.ok(p[0].lat > 30, 'first bounce should be well north');
  assert.ok(p[2].lat < 0, 'last bounce should be in the southern hemisphere');
  assert.ok(Math.sign(p[0].lat) !== Math.sign(p[2].lat), 'hemispheres must differ');
});

test('reflectionPoints: symmetric and defensive', function() {
  var fwd = reflectionPoints(34.9, -76.9, -34.6, -58.4, 2);
  var rev = reflectionPoints(-34.6, -58.4, 34.9, -76.9, 2).reverse();
  fwd.forEach(function(q, i) {
    approx(q.lat, rev[i].lat, 1e-6);
    approx(q.lon, rev[i].lon, 1e-6);
  });
  assert.equal(reflectionPoints(0, 0, 0, 10, 0).length, 1, 'zero hops floors at one');
  assert.equal(reflectionPoints(0, 0, 0, 10).length, 1, 'missing hop count floors at one');
});


// ── GEOMETRIC vs ANTENNA ANGLE ───────────────────────────────────────────────
// calcTakeoffAngle returns two different things and they must not be confused.
// geoDeg is what the RAY needs to reach the target and is what the MUF is
// computed from; finalDeg is advice for the ANTENNA and carries terrain.

test('calcTakeoffAngle: geoDeg ignores terrain, finalDeg does not', function() {
  var ocean = { oceanFrac: 0.9, landFrac: 0.1, mountainFrac: 0, desertFrac: 0 };
  var desert = { oceanFrac: 0, landFrac: 1, mountainFrac: 0, desertFrac: 0.6 };
  [500, 1500, 3000].forEach(function(d) {
    var plain = calcTakeoffAngle(d, 14, HOP.F2.hKm, null);
    var o = calcTakeoffAngle(d, 14, HOP.F2.hKm, ocean);
    var de = calcTakeoffAngle(d, 14, HOP.F2.hKm, desert);
    assert.equal(o.geoDeg, plain.geoDeg, 'ocean must not move the ray geometry at ' + d + ' km');
    assert.equal(de.geoDeg, plain.geoDeg, 'desert must not move the ray geometry at ' + d + ' km');
    // ...but it does move the antenna advice.
    assert.ok(o.finalDeg < plain.finalDeg, 'ocean should flatten the antenna angle');
    assert.ok(de.finalDeg > plain.finalDeg, 'desert should steepen it');
  });
});

test('calcTakeoffAngle: geoDeg is the clamped pure geometry', function() {
  [250, 800, 1500, 3000, 4000].forEach(function(d) {
    var t = calcTakeoffAngle(d, 14, HOP.F2.hKm, null);
    approx(t.geoDeg, Math.max(3, Math.min(85, t.baseDeg)), 0.051);
    assert.equal(t.geoDeg, t.finalDeg, 'with no terrain the two must agree');
  });
  // At and beyond the hop limit the geometry floors and the clamp takes over.
  assert.equal(calcTakeoffAngle(HOP.F2.maxHopKm, 14, HOP.F2.hKm, null).geoDeg, 3);
});

test('calcTakeoffAngle: a chordal path does not distort the ray geometry', function() {
  // The chordal rule multiplies the ANTENNA angle by 0.7. That must not leak
  // into the MUF: a 30% angle change moves the secant factor a long way.
  var terr = { oceanFrac: 0.9, landFrac: 0.1, mountainFrac: 0, desertFrac: 0 };
  var t = calcTakeoffAngle(3500, 14, HOP.F2.hKm, terr);
  assert.ok(t.chordal, 'this case should trigger the chordal rule');
  assert.equal(t.geoDeg, calcTakeoffAngle(3500, 14, HOP.F2.hKm, null).geoDeg);
  assert.ok(t.finalDeg < t.geoDeg, 'the antenna angle should still be reduced');
});


test('calcTakeoffAngle: mufDeg drops the 3 degree antenna floor', function() {
  // geoDeg carries the antenna floor; mufDeg must not, because that floor caps
  // the secant factor at 3.06 where VOACAP measures 3.25 (Part 16).
  var t = calcTakeoffAngle(HOP.F2.maxHopKm, 14, HOP.F2.hKm, null);
  assert.equal(t.geoDeg, 3, 'the antenna angle still floors at 3');
  assert.ok(t.mufDeg < 1, 'the MUF angle must be free to approach the horizon');
  // Away from the limit the two agree.
  var mid = calcTakeoffAngle(1500, 14, HOP.F2.hKm, null);
  assert.ok(Math.abs(mid.geoDeg - mid.mufDeg) < 0.06);
  // And terrain must not touch either.
  var terr = calcTakeoffAngle(1500, 14, HOP.F2.hKm,
    { oceanFrac: 0.9, landFrac: 0.1, mountainFrac: 0, desertFrac: 0 });
  assert.equal(terr.mufDeg, mid.mufDeg);
});


// ── One copy of each physical constant ──────────────────────────────────────
// Earth radius and the F2 reflection height each used to exist in three
// modules, every copy carrying a comment promising it matched the others. A
// promise is not a constraint, and this project has already shipped a release
// where the MUF used a different takeoff angle from every validation run
// (docs/VALIDATION.md Part 10). propagation.js now owns both.

test('the F2 height used by the hop table is the exported constant', async function() {
  const { F2_HEIGHT_KM, EARTH_RADIUS_KM, HOP } = await import('../../src/physics/propagation.js');
  assert.equal(HOP.F2.hKm, F2_HEIGHT_KM, 'the hop table forked its own F2 height');
  assert.equal(EARTH_RADIUS_KM, 6371);
});

test('antennaMath and freqAdvisor use the same constants, not their own', async function() {
  const p = await import('../../src/physics/propagation.js');
  const a = await import('../../src/physics/antennaMath.js');
  const f = await import('../../src/physics/freqAdvisor.js');
  assert.equal(a.F2_HEIGHT_KM, p.F2_HEIGHT_KM);
  assert.equal(a.EARTH_RADIUS_KM, p.EARTH_RADIUS_KM);
  assert.equal(f.LUF_F2_HEIGHT_KM, p.F2_HEIGHT_KM,
    'the LUF geometry forked from the layer height everything else uses');
});


// ── Nothing computed twice ─────────────────────────────────────────────────
// The chordal-hop condition used to be spelled out inline inside
// calcTakeoffAngle AND exported as chordalHopPossible, agreeing only by
// whoever edited both last. Same class as the Earth-radius triplication.

test('calcTakeoffAngle uses the exported chordal predicate, not a copy', async function() {
  const { calcTakeoffAngle, chordalHopPossible } = await import('../../src/physics/propagation.js');
  const cases = [
    [5000, 14.2, 0.9], [5000, 14.2, 0.1], [2000, 14.2, 0.9],
    [5000, 7.0, 0.9], [5000, 29.0, 0.9], [3001, 10.0, 0.51],
    [3000, 10.0, 0.51], [8000, 21.0, 1.0],
  ];
  for (const [dist, freq, ocean] of cases) {
    const toa = calcTakeoffAngle(dist, freq, 360, { oceanFrac: ocean });
    assert.equal(toa.chordal, chordalHopPossible(dist, freq, ocean),
      'the two chordal determinations disagree at ' + [dist, freq, ocean]);
  }
});

test('groundWaveMultiplier is anchored to average land', async function() {
  // It is now shown to the operator on ground-wave paths, so its scale is
  // load-bearing: 1.0 must mean "average land", not an arbitrary reference.
  const { groundWaveMultiplier } = await import('../../src/physics/propagation.js');
  assert.ok(Math.abs(groundWaveMultiplier(3) - 1) < 1e-9, 'average land should be 1.0x');
  assert.ok(groundWaveMultiplier(5000) > 5, 'salt water should be worth several times average land');
  assert.ok(groundWaveMultiplier(0.1) < 0.5, 'dry sand should be a fraction of average land');
  for (const c of [0, 0.001, 1, 3, 100, 5000]) {
    assert.ok(isFinite(groundWaveMultiplier(c)) && groundWaveMultiplier(c) >= 0);
  }
});

// ── Takeoff angle: hop distance vs full path (v1.40) ────────────────────────
// calcHops passes the PER-HOP distance for the angle geometry, but the chordal
// test and the obstacle-position math are properties of the WHOLE path. Passing
// only one number made a 2-hop ocean path test chordal on its half-length leg
// and silently lose it, and put obstacles at the wrong distance from the TX.

test('chordal survives a multi-hop ocean path when the full length is given', function() {
  const ocean = { oceanFrac: 0.95, mountainFrac: 0, desertFrac: 0 };
  const hop = 5000 / 2;   // per-hop distance of a 2-hop 5000 km path
  const withoutFull = calcTakeoffAngle(hop, 14, 360, ocean);
  const withFull = calcTakeoffAngle(hop, 14, 360, ocean, { fullDistKm: 5000, hops: 2 });
  assert.equal(withoutFull.chordal, false, 'a 2500 km leg is correctly below the chordal threshold');
  assert.equal(withFull.chordal, true, 'the 5000 km PATH should qualify for chordal propagation');
});

test('takeoff geometry still uses the per-hop distance', function() {
  // The angle itself must come from the single-bounce geometry, so splitting a
  // path into more hops raises the takeoff angle of each.
  const oneHop = calcTakeoffAngle(2000, 14, 360, null);
  const halfHop = calcTakeoffAngle(1000, 14, 360, null);
  assert.ok(halfHop.baseDeg > oneHop.baseDeg, 'a shorter hop must launch steeper');
});
