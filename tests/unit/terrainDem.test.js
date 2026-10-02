// The terrain model on REAL elevation data (v1.56).
//
// terrain.test.js pins the box model, which is what the app runs on until the
// elevation grid has loaded. This file installs the shipped grid
// (public/elevation-grid.bin) and pins what changes once it has: a rectangle
// can name a range but can no longer invent one, every ridge on Earth is found
// the same way, and the far station's horizon is checked as well as yours.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseElevationGrid, installElevationGrid, elevationGridReady, elevMean, elevMax,
} from '../../src/data/elevationGrid.js';
import {
  TERRAIN_DB, classifyPoint, nearFieldObstacle, nearFieldSurvey, pathTerrainAnalysis,
} from '../../src/physics/terrain.js';
import { calcTakeoffAngle, terrainMaskAdvice } from '../../src/physics/propagation.js';

const buf = readFileSync(new URL('../../public/elevation-grid.bin', import.meta.url));
const parsed = parseElevationGrid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

test('the shipped grid parses and installs', function() {
  assert.ok(parsed, 'public/elevation-grid.bin did not parse');
  assert.equal(parsed.meta.nLat, 720);
  assert.equal(parsed.meta.nLon, 1440);
  assert.ok(installElevationGrid(parsed));
  assert.ok(elevationGridReady());
});

test('real elevations at places with known heights', function() {
  installElevationGrid(parsed);
  const near = (got, want, tol, what) =>
    assert.ok(Math.abs(got - want) <= tol, what + ': got ' + got + ' m, expected ~' + want);
  near(elevMean(39.74, -104.99), 1650, 450, 'Denver');
  near(elevMean(34.65, -77.35), 10, 60, 'Camp Lejeune');
  near(elevMean(32.66, -114.61), 60, 150, 'MCAS Yuma');
  near(elevMean(30.0, -40.0), 0, 0, 'open Atlantic');
  assert.ok(elevMax(27.99, 86.93) > 7500, 'Everest cell must be a giant');
});

test('a rectangle can name a range but can no longer invent one', function() {
  // The defect class of Parts 42-45 — Las Vegas as the Rockies, the whole East
  // Coast as the Appalachians — reproduced on purpose: a giant fake "mountain"
  // box laid over the flat middle of the country. With real data loaded it
  // must be refused, and ground the data says is rugged must still be found.
  installElevationGrid(parsed);
  TERRAIN_DB.push({ t: 'mountain', n: 'FAKE RANGE', latMin: 35, latMax: 42,
    lonMin: -101, lonMax: -94, elev: 4000 });
  try {
    for (const [name, lat, lon] of [['Wichita', 37.69, -97.34], ['Kansas', 38.0, -98.0],
                                    ['Omaha', 41.26, -95.94], ['Tulsa', 36.15, -95.99]]) {
      const r = classifyPoint(lat, lon);
      assert.notEqual(r.name, 'FAKE RANGE', name + ' was claimed by a box the ground does not support');
      assert.notEqual(r.type, 'mountain', name + ' is plains');
    }
  } finally {
    TERRAIN_DB.pop();
  }
});

test('the cities the old boxes swallowed stay flat on real data', function() {
  installElevationGrid(parsed);
  for (const [name, lat, lon] of [['Camp Lejeune', 34.65, -77.35], ['Norfolk', 36.85, -76.29],
                                  ['New York City', 40.71, -74.01], ['Boston', 42.36, -71.06],
                                  ['Las Vegas', 36.17, -115.14], ['Philadelphia', 39.95, -75.16]]) {
    assert.notEqual(classifyPoint(lat, lon).type, 'mountain', name + ' must not be a mountain');
  }
});

test('real ranges still read as mountain, named where a box names them', function() {
  installElevationGrid(parsed);
  for (const [name, lat, lon] of [['Mont Blanc', 45.83, 6.86], ['Himalaya', 28.0, 86.9],
                                  ['Colorado Rockies', 39.6, -105.9]]) {
    const r = classifyPoint(lat, lon);
    assert.ok(r.type === 'mountain' || r.type === 'highland', name + ' should be high ground, got ' + r.type);
  }
});

test('the ridge beside MCAS Yuma is found on a long eastward shot', function() {
  installElevationGrid(parsed);
  const ob = nearFieldObstacle(32.6566, -114.6060, 36.85, -76.29);   // -> Norfolk
  assert.ok(ob, 'the Gila ridge must be seen from real data');
  assert.ok(ob.distKm < 80, 'it is ~30 km out, got ' + ob.distKm);
  assert.ok(ob.reliefM > 300, 'relief above a 60 m station, got ' + ob.reliefM);
});

test('a station on a plain is told CLEAR, not "unmapped"', function() {
  // Under the box model Kansas and Okinawa both returned "nothing mapped".
  // Real data can tell flat from unknown.
  installElevationGrid(parsed);
  const k = nearFieldSurvey(38.0, -98.0, 38.0, -94.0);
  assert.equal(k.status, 'clear', 'Kansas is flat — the data can say so');
  assert.ok(k.dem);
});

test('every survey status is one of the declared values on real data', function() {
  installElevationGrid(parsed);
  for (const [lat, lon] of [[32.66, -114.61], [34.65, -77.35], [26.28, 127.78], [38, -98],
                            [13.58, 144.92], [69.06, 18.54], [36.03, 129.38], [34.14, 132.24]]) {
    const v = nearFieldSurvey(lat, lon, lat, lon + 3);
    assert.ok(['blocked', 'local_relief', 'clear'].indexOf(v.status) !== -1,
      'unexpected status at ' + [lat, lon] + ': ' + v.status);
    if (v.status === 'blocked') assert.ok(v.obstacle); else assert.equal(v.obstacle, null);
  }
});

test('mountains are now found the same way everywhere — not only where boxed', function() {
  // Part 45's audit: a ridge at Yuma, nothing at Pohang or Iwakuni. On real
  // data both sit in genuinely mountainous country and must say so.
  installElevationGrid(parsed);
  for (const [name, lat, lon, lat2, lon2] of [['Pohang, inland', 36.03, 129.38, 36.03, 127.0],
                                              ['Iwakuni, inland', 34.14, 132.24, 35.0, 133.5]]) {
    const v = nearFieldSurvey(lat, lon, lat2, lon2);
    assert.notEqual(v.status, 'clear', name + ': the ground rises inland and the data must see it');
  }
});

// ── #2: the far end's horizon ───────────────────────────────────────────────

test('the far station\'s ridge is scanned, from the far station', function() {
  // A long shot from the east INTO Yuma: the Gila ridge sits beside the FAR
  // station. The near-end scan (from the east) cannot see it; the far scan must.
  installElevationGrid(parsed);
  const r = pathTerrainAnalysis(36.85, -76.29, 32.6566, -114.6060, 32);
  assert.ok(r.farObstacle, 'the ridge beside the far station must be found');
  assert.ok(r.farObstacle.distKm < 80, 'measured from the far station, got ' + r.farObstacle.distKm);
});

test('a ridge at the far end raises the angle for both ends, and says so', function() {
  // A tall ridge close to the far station: 1,400 m at 10 km subtends ~8 deg,
  // well above the ~5 deg a 3,000 km hop leaves at on its own.
  const terrain = { farObstacle: { name: 'Far Ridge', reliefM: 1400, distKm: 10, subtendedDeg: 7.97 } };
  const t = calcTakeoffAngle(3000, 7.3, 330, terrain, { fullDistKm: 3000 });
  const adj = (t.adjustments || []).find(a => a.type === 'far_end_clearance');
  assert.ok(adj, 'expected a far-end clearance adjustment');
  assert.match(adj.note, /FAR station/);
  assert.ok(t.finalDeg >= 9.97 - 1e-9, 'angle must clear the far crest +2 deg, got ' + t.finalDeg);
  // And a far ridge LOWER than the angle already needed changes nothing.
  const low = calcTakeoffAngle(3000, 7.3, 330,
    { farObstacle: { name: 'Hill', reliefM: 300, distKm: 40, subtendedDeg: 0.43 } }, { fullDistKm: 3000 });
  assert.ok(!(low.adjustments || []).some(a => a.type === 'far_end_clearance'),
    'a far hill below the needed angle must not raise it');
});

test('a far station masked by a ridge calls for NVIS even when the near end is clear', function() {
  const advice = terrainMaskAdvice(60,
    { nearObstacle: null, farObstacle: { name: 'R', reliefM: 700, distKm: 20, subtendedDeg: 2.0 } });
  assert.ok(advice, 'a ridge beside the far station on a short path is still masking');
  assert.equal(advice.end, 'far');
  assert.equal(advice.recommend, 'nvis');
});

test('the steeper of the two ends wins', function() {
  const advice = terrainMaskAdvice(60, {
    nearObstacle: { name: 'Near', reliefM: 400, distKm: 30, subtendedDeg: 0.76 },
    farObstacle: { name: 'Far', reliefM: 900, distKm: 15, subtendedDeg: 3.4 } });
  assert.equal(advice.name, 'Far');
});

test('a ridge takes a RANGE name or none — never a valley or desert box name', function() {
  // The first cut reported the Gila foothills east of MCAS Yuma as
  // "Yuma Valley — 720 m up" because the sample sat in an irrigated-valley box.
  installElevationGrid(parsed);
  const names = new Set(TERRAIN_DB.filter(e => e.t === 'mountain' || e.t === 'highland').map(e => e.n));
  for (const [lat, lon, lat2, lon2] of [[32.66, -114.61, 36.85, -76.29], [33.35, -117.42, 33.35, -114.0],
                                        [36.62, -6.33, 36.62, -2.0], [34.23, -116.05, 34.23, -113.0]]) {
    const ob = nearFieldObstacle(lat, lon, lat2, lon2);
    if (!ob) continue;
    assert.ok(ob.name === 'high ground' || names.has(ob.name),
      'ridge named after a non-range box: ' + ob.name);
  }
});

test('the Atlas Mountains stay in Africa', function() {
  // The Atlas box reached 37N and labelled southern Spain's ranges, seen from
  // NAVSTA Rota, as "Atlas Mountains".
  installElevationGrid(parsed);
  for (const [name, lat, lon] of [['Sierra Nevada (Spain)', 37.05, -3.31], ['Rota', 36.62, -6.33],
                                  ['Malaga hills', 36.8, -4.4]]) {
    const r = classifyPoint(lat, lon);
    assert.doesNotMatch(r.name || '', /Atlas/, name + ' labelled ' + r.name);
  }
  const ob = nearFieldObstacle(36.62, -6.33, 36.62, -2.0);
  if (ob) assert.doesNotMatch(ob.name, /Atlas/, 'Rota sees Spanish ranges, not the Atlas');
  // The real Atlas still reads as mountain.
  assert.equal(classifyPoint(31.06, -7.92).type, 'mountain', 'Toubkal, Morocco');
});
