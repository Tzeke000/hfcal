// Tests for the terrain model.
//
// These 230 lines had never been under test. They were not skipped on purpose
// — they were buried in the middle of a 4300-line component file, where the
// only way to reach them was to render the whole app. Extracting them into
// terrain.js (v1.26) is what made this file possible, and that is the actual
// argument for the split: not tidiness, testability.
//
// The terrain database is a coarse bounding-box model. These tests check that
// it is SELF-CONSISTENT and behaves the way the rest of the app assumes, not
// that its geography is accurate to the coastline.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TERRAIN_DB, TERRAIN_PRIORITY, TERRAIN_COND,
  classifyPoint, samplePath, pathTerrainAnalysis,
} from '../../src/physics/terrain.js';

test('every database entry is well formed', function() {
  assert.ok(TERRAIN_DB.length > 0);
  for (const e of TERRAIN_DB) {
    assert.ok(TERRAIN_PRIORITY[e.t] !== undefined, 'unknown terrain type: ' + e.t);
    assert.ok(TERRAIN_COND[e.t] !== undefined, 'no conductivity for type: ' + e.t);
    assert.ok(typeof e.n === 'string' && e.n.length, 'entry has no name: ' + JSON.stringify(e));
    assert.ok(e.latMin < e.latMax, 'inverted latitude box: ' + e.n);
    assert.ok(e.lonMin < e.lonMax, 'inverted longitude box: ' + e.n);
    assert.ok(e.latMin >= -90 && e.latMax <= 90, 'latitude out of range: ' + e.n);
    assert.ok(e.lonMin >= -180 && e.lonMax <= 180, 'longitude out of range: ' + e.n);
    if (e.t === 'mountain' || e.t === 'highland') {
      assert.ok(typeof e.elev === 'number' && e.elev > 0,
        'mountain/highland needs an elevation: ' + e.n);
      assert.ok(e.elev < 9000, 'elevation above Everest: ' + e.n + ' = ' + e.elev);
    }
  }
});

test('classifyPoint returns a usable answer anywhere on Earth', function() {
  for (let lat = -85; lat <= 85; lat += 5) {
    for (let lon = -180; lon < 180; lon += 10) {
      const t = classifyPoint(lat, lon);
      assert.ok(t && typeof t.type === 'string', 'no classification at ' + [lat, lon]);
      assert.ok(TERRAIN_COND[t.type] !== undefined, 'unknown type at ' + [lat, lon]);
      assert.ok(t.cond > 0, 'non-positive conductivity at ' + [lat, lon]);
      assert.ok(typeof t.elev === 'number' && isFinite(t.elev) && t.elev >= 0);
    }
  }
});

test('overlapping boxes resolve by priority, highest wins', function() {
  // The documented rule: mountain > lake > ocean > highland > desert. If two
  // boxes cover a point, the winner must be the higher-priority type.
  for (let lat = -80; lat <= 80; lat += 7) {
    for (let lon = -175; lon < 180; lon += 11) {
      const hits = TERRAIN_DB.filter(e =>
        lat >= e.latMin && lat <= e.latMax && lon >= e.lonMin && lon <= e.lonMax);
      if (hits.length < 2) continue;
      const best = Math.max(...hits.map(e => TERRAIN_PRIORITY[e.t]));
      const got = classifyPoint(lat, lon);
      assert.equal(TERRAIN_PRIORITY[got.type], best,
        'priority not respected at ' + [lat, lon] + ': got ' + got.type);
    }
  }
});

test('ocean conducts far better than desert', function() {
  // This ordering is what the ground-wave and takeoff adjustments rest on.
  assert.ok(TERRAIN_COND.ocean > TERRAIN_COND.land);
  assert.ok(TERRAIN_COND.land > TERRAIN_COND.desert);
  assert.ok(TERRAIN_COND.ocean / TERRAIN_COND.desert > 100,
    'salt water should conduct orders of magnitude better than dry sand');
});

test('samplePath spans the path and stays on the great circle', function() {
  const a = [34.90, -76.88], b = [26.35, 127.77];   // Cherry Point → Okinawa
  const pts = samplePath(a[0], a[1], b[0], b[1], 32);
  // n is the number of SEGMENTS, so both endpoints are included: n + 1 points.
  assert.equal(pts.length, 33);
  assert.ok(Math.abs(pts[0].lat - a[0]) < 0.5 && Math.abs(pts[0].lon - a[1]) < 0.5,
    'first sample should be at the start');
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(last.lat - b[0]) < 0.5 && Math.abs(last.lon - b[1]) < 0.5,
    'last sample should be at the target');
  for (const p of pts) {
    assert.ok(p.lat >= -90 && p.lat <= 90, 'latitude off the globe: ' + p.lat);
    assert.ok(p.lon >= -180 && p.lon <= 180, 'longitude off the globe: ' + p.lon);
    assert.ok(p.frac >= 0 && p.frac <= 1);
    assert.ok(p.terrain && p.terrain.type);
  }
  // frac must increase monotonically — the hop diagram draws in this order.
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].frac > pts[i - 1].frac);
});

test('samplePath crosses the dateline without leaving the globe', function() {
  const pts = samplePath(13.45, 144.78, 21.30, -157.86, 24);   // Guam → Hawaii
  for (const p of pts) {
    assert.ok(p.lon >= -180 && p.lon <= 180, 'longitude wrapped badly: ' + p.lon);
    assert.ok(isFinite(p.lat) && isFinite(p.lon));
  }
});

test('an all-ocean path reports itself as such', function() {
  // Mid-Pacific, well clear of any land box in the database.
  const r = pathTerrainAnalysis(20, -150, 10, -140, 32);
  assert.ok(r.oceanFrac > 0.9, 'expected open ocean, got ' + r.oceanFrac);
  assert.equal(r.keyObstacle, null, 'open ocean has no mountain obstacle');
  assert.ok(r.condMSm > TERRAIN_COND.land, 'sea water should raise the effective conductivity');
});

test('fractions are a probability distribution and conductivity is bounded', function() {
  const paths = [
    [34.9, -76.88, 26.35, 127.77],
    [60, 25, -30, 25],
    [-33.9, 151.2, 35.7, 139.7],
    [64.8, -147.7, 69.68, 18.92],
    [0, 0, 0, 40],
  ];
  for (const [a, b, c, d] of paths) {
    const r = pathTerrainAnalysis(a, b, c, d, 32);
    const sum = Object.values(r.fracs).reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, 'fractions must sum to 1, got ' + sum);
    for (const v of Object.values(r.fracs)) assert.ok(v >= 0 && v <= 1);
    // Geometric mean of per-point conductivities must lie inside their range.
    const conds = r.pts.map(p => p.terrain.cond);
    assert.ok(r.condMSm >= Math.min(...conds) - 1e-9);
    assert.ok(r.condMSm <= Math.max(...conds) + 1e-9);
    assert.ok(r.maxElev >= 0);
  }
});

test('the key obstacle is the highest point on the path, not just any', function() {
  const r = pathTerrainAnalysis(28.0, 82.0, 40.0, 90.0, 40);   // across the Himalaya
  if (r.keyObstacle) {
    const peaks = r.pts
      .filter(p => p.terrain.type === 'mountain' || p.terrain.type === 'highland')
      .map(p => p.terrain.elev);
    assert.equal(r.keyObstacle.elev, Math.max(...peaks),
      'keyObstacle must be the highest obstacle, not the first found');
    assert.equal(r.maxElev, Math.max(...peaks));
  }
});

test('a zero-length path does not divide by zero', function() {
  const r = pathTerrainAnalysis(34.9, -76.88, 34.9, -76.88, 8);
  assert.ok(isFinite(r.condMSm) && r.condMSm > 0);
  assert.ok(Math.abs(Object.values(r.fracs).reduce((x, y) => x + y, 0) - 1) < 1e-9);
});

// ── WESTPAC ocean coverage (v1.40) ─────────────────────────────────────────
// The open North Pacific east of Japan (145E..dateline, north of the equator)
// had no ocean box and defaulted to LAND, so Tokyo->Honolulu scored ~48%
// ocean and got land ground-physics on a path that is almost all water.

test('the open western North Pacific is ocean, not land', function() {
  // A point in the empty NW Pacific, well east of Japan, west of the dateline.
  assert.equal(classifyPoint(38, 165).type, 'ocean', '38N 165E should be open ocean');
  assert.equal(classifyPoint(20, 150).type, 'ocean', '20N 150E should be open ocean');
});

test('Tokyo to Honolulu reads as an ocean path', function() {
  const r = pathTerrainAnalysis(35.7, 139.7, 21.3, -157.9, 32);
  assert.ok(r.oceanFrac > 0.9, 'expected a near-all-ocean WESTPAC path, got ' + r.oceanFrac);
});
