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
  classifyPoint, samplePath, pathTerrainAnalysis, nearFieldObstacle, nearFieldSurvey,
} from '../../src/physics/terrain.js';
import { isLand } from '../../src/data/landMask.js';

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
  // The documented rule: mountain > lake beat everything; desert/highland
  // boxes apply only where the coastline mask says LAND (their rectangles
  // overhang open water — Iris round 2, finding A). So the expected winner is
  // the highest-priority box hit, after dropping desert/highland hits on
  // water; if nothing remains, the mask decides land vs ocean.
  for (let lat = -80; lat <= 80; lat += 7) {
    for (let lon = -175; lon < 180; lon += 11) {
      const hitsAll = TERRAIN_DB.filter(e =>
        lat >= e.latMin && lat <= e.latMax && lon >= e.lonMin && lon <= e.lonMax);
      if (hitsAll.length < 2) continue;
      const isWater = !isLand(lat, lon);
      const hits = hitsAll.filter(e =>
        !(isWater && (e.t === 'desert' || e.t === 'highland')));
      const got = classifyPoint(lat, lon);
      if (hits.length === 0) {
        assert.equal(got.type, isWater ? 'ocean' : 'land',
          'mask should decide at ' + [lat, lon] + ': got ' + got.type);
        continue;
      }
      const best = Math.max(...hits.map(e => TERRAIN_PRIORITY[e.t]));
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

// ── Real coastline mask, not hand-drawn boxes (v1.42) ───────────────────────
// classifyPoint's ocean-vs-land answer now comes from a 1-degree land/sea
// bitmask built from Natural Earth coastlines, replacing the hand-drawn ocean
// boxes whose maintenance produced bug #1 (western North Pacific = land).

test('open ocean far from any old box is now ocean everywhere', function() {
  // Points the hand-drawn boxes never covered — all open water.
  const water = [[30, 160], [40, 170], [-20, 100], [0, -30], [50, -30],
                 [-40, 80], [10, 65], [25, -140]];
  for (const [la, lo] of water) {
    assert.equal(classifyPoint(la, lo).type, 'ocean', 'expected ocean at ' + [la, lo]);
  }
});

test('major landmass interiors are land', function() {
  const land = [[38, -98], [55, 40], [0, 20], [-25, 135], [45, 105], [-10, -55]];
  for (const [la, lo] of land) {
    const t = classifyPoint(la, lo).type;
    assert.ok(t !== 'ocean', 'expected land-ish at ' + [la, lo] + ', got ' + t);
  }
});

// ── Water beats desert/highland boxes (v1.46, Iris round 2 finding A) ───────
// The v1.42 mask rewrite checked feature boxes FIRST, silently losing the old
// ocean-above-desert ordering: the Sahara box (which overhangs the whole
// Mediterranean and Red Sea) and the Arabian box (which overhangs the Persian
// Gulf) claimed open water and gave 5th Fleet / EUCOM paths desert physics —
// +2° takeoff penalty, no sea-path bonus, conductivity 0.3 instead of
// 5000 mS/m. These pins make that regression impossible to reintroduce.

test('the Mediterranean, Red Sea and Persian Gulf are water, not desert', function() {
  const seas = [
    ['open Mediterranean', 33, 20],
    ['Mediterranean south of Crete', 34, 24],
    ['Red Sea', 20, 38.5],
    ['Persian Gulf', 27, 51.5],
    ['Gulf of Oman', 24.5, 59.5],
  ];
  for (const [name, la, lo] of seas) {
    assert.equal(classifyPoint(la, lo).type, 'ocean',
      name + ' at ' + [la, lo] + ' must classify as ocean');
  }
});

test('the deserts those boxes exist for are still desert on land', function() {
  assert.equal(classifyPoint(23, 10).type, 'desert', 'central Sahara');
  assert.equal(classifyPoint(24, 45).type, 'desert', 'Arabian interior');
  assert.equal(classifyPoint(-25, 130).type, 'desert', 'Australian outback');
});

test('mountain and lake boxes still outrank the water mask', function() {
  // Great Lakes cells read water in the coastline mask; the lake boxes must
  // keep winning so they get freshwater (3 mS/m), not seawater, conductivity.
  assert.equal(classifyPoint(44, -87.5).type, 'lake', 'Lake Michigan');
  assert.equal(classifyPoint(47.5, -88).type, 'lake', 'Lake Superior');
});

test('Malta to Alexandria is a sea path, not a desert path', function() {
  const r = pathTerrainAnalysis(35.9, 14.5, 31.2, 29.9, 32);
  assert.ok(r.oceanFrac > 0.8,
    'near-all-sea path must score as ocean, got oceanFrac ' + r.oceanFrac.toFixed(2));
  assert.ok(r.desertFrac < 0.1,
    'desert must not claim the Mediterranean, got desertFrac ' + r.desertFrac.toFixed(2));
});

test('Bahrain to Jask across the Gulf is mostly water', function() {
  const r = pathTerrainAnalysis(26.2, 50.6, 25.6, 57.8, 32);
  assert.ok(r.oceanFrac > 0.5,
    'Persian Gulf crossing should be majority water, got ' + r.oceanFrac.toFixed(2));
});

// ── WTI / Yuma training area (v1.51) ────────────────────────────────────────
// Marines are using this at WTI on the Barry M. Goldwater Range, so the
// southwest is pinned rather than left to a regional average. Before the
// split, ONE box called the whole southwest 800 m dry desert: MCAS Yuma (65 m,
// irrigated Colorado valley), Camp Pendleton (Pacific coast) and the Salton
// Sea (890 km² lake) were all "Mojave/Sonoran desert, 800 m".

test('the Yuma valley is irrigated cropland, not 800 m of dry sand', function() {
  const yuma = classifyPoint(32.66, -114.61);        // MCAS Yuma
  assert.equal(yuma.type, 'irrigated', 'MCAS Yuma sits in irrigated valley');
  assert.ok(yuma.elev < 200, 'Yuma is ~65 m, got ' + yuma.elev);
  assert.ok(yuma.cond > TERRAIN_COND.land,
    'irrigated soil must conduct better than average land, got ' + yuma.cond);
  // The whole point: ground wave carries much further here than the old
  // desert classification implied.
  assert.ok(yuma.cond / TERRAIN_COND.desert > 10,
    'irrigated vs desert should be an order of magnitude apart');
});

test('the Imperial Valley is irrigated and near sea level', function() {
  const ic = classifyPoint(32.79, -115.56);          // El Centro
  assert.equal(ic.type, 'irrigated');
  assert.ok(ic.elev < 100, 'the Imperial Valley is at/below sea level');
});

test('Camp Pendleton is coastal land, not desert', function() {
  const cp = classifyPoint(33.35, -117.42);
  assert.notEqual(cp.type, 'desert', 'a Pacific-coast base must not be desert');
  assert.ok(cp.cond >= TERRAIN_COND.land,
    'coastal ground must not be charged desert conductivity');
});

test('the Salton Sea is water', function() {
  const ss = classifyPoint(33.33, -115.83);
  assert.equal(ss.type, 'lake', 'an 890 km2 lake must not classify as desert');
  assert.ok(ss.cond > TERRAIN_COND.desert);
});

test('the ranges around the BMGR are mountains with real peak heights', function() {
  // These are above the 800 m obstacle-clearance threshold, so they actually
  // shape the recommended takeoff angle for a station shooting across them.
  const gila = classifyPoint(32.60, -114.20);
  assert.equal(gila.type, 'mountain');
  assert.ok(gila.elev > 900 && gila.elev < 1100, 'Sheep Mtn is ~962 m, got ' + gila.elev);
  const kofa = classifyPoint(33.30, -114.10);
  assert.equal(kofa.type, 'mountain');
  assert.ok(kofa.elev > 1400 && kofa.elev < 1600, 'Signal Peak is ~1486 m, got ' + kofa.elev);
});

test('Twentynine Palms gets its own elevation, not the Mojave average', function() {
  // Regression on the ordering trap: equal-priority boxes used to resolve by
  // array order, so the general Mojave box (900 m) beat the specific MCAGCC
  // box (700 m) purely by being listed first.
  const tp = classifyPoint(34.23, -116.05);
  assert.equal(tp.name, 'Twentynine Palms',
    'the specific box must win over the regional one, got ' + tp.name);
  assert.equal(tp.elev, 700);
});

test('on equal priority the smaller box wins, whatever the array order', function() {
  // The general rule behind the test above, checked directly so a future
  // reordering of TERRAIN_DB cannot quietly undo it.
  for (const [lat, lon] of [[34.23, -116.05], [32.66, -114.61], [32.79, -115.56]]) {
    const hits = TERRAIN_DB.filter(e =>
      lat >= e.latMin && lat <= e.latMax && lon >= e.lonMin && lon <= e.lonMax);
    const topPri = Math.max(...hits.map(e => TERRAIN_PRIORITY[e.t]));
    const tied = hits.filter(e => TERRAIN_PRIORITY[e.t] === topPri);
    if (tied.length < 2) continue;
    const areas = tied.map(e => (e.latMax - e.latMin) * (e.lonMax - e.lonMin));
    const smallest = tied[areas.indexOf(Math.min(...areas))];
    assert.equal(classifyPoint(lat, lon).name, smallest.n,
      'smallest tied box should win at ' + [lat, lon]);
  }
});

test('Las Vegas is desert basin, not the Rocky Mountains', function() {
  // Pre-existing defect found while fixing the southwest: the Rockies box
  // spanned 117W, sweeping in all of Nevada. Las Vegas came back as
  // "Rocky Mountains, 3500 m", charging a 3.5 km obstacle clearance to
  // southwest paths.
  const lv = classifyPoint(36.17, -115.14);
  assert.equal(lv.type, 'desert', 'Las Vegas is in the Mojave basin, got ' + lv.name);
  assert.ok(lv.elev < 1200, 'got ' + lv.elev + ' m for Las Vegas');
  // The split must not lose the real Rockies at either end.
  assert.equal(classifyPoint(39.74, -104.99).type, 'mountain', 'Denver');
  assert.equal(classifyPoint(46.87, -113.99).type, 'mountain', 'Missoula');
});

test('a local WTI path reads as workable ground, not dead sand', function() {
  // MCAS Yuma -> Camp Pendleton, the obvious WTI regional shot. It used to
  // run desert-to-desert; it now crosses irrigated valley, desert and
  // coastal land, so the effective conductivity is far more favourable.
  const r = pathTerrainAnalysis(32.66, -114.61, 33.35, -117.42, 32);
  assert.ok(r.condMSm > TERRAIN_COND.desert * 2,
    'effective conductivity should beat bare desert, got ' + r.condMSm.toFixed(2));
  assert.ok((r.fracs.irrigated || 0) > 0, 'the path should register irrigated ground');
  assert.ok(Math.abs(Object.values(r.fracs).reduce((a, b) => a + b, 0) - 1) < 1e-9,
    'fractions must still sum to 1 with the new class');
});

// ── The ridge next to the base (v1.52) ──────────────────────────────────────
// The Gila Mountains sit ~30 km east of MCAS Yuma and are the first thing a
// low-angle eastward shot has to clear. The main path sampler could not see
// them: 32 samples across a 3,500 km path puts the first one 110 km out, so a
// ridge at 30 km fell straight through the gap. The near-field scan exists
// because of exactly that.

test('the near-field scan finds the ridge beside MCAS Yuma on a long path', function() {
  const near = nearFieldObstacle(32.6566, -114.6060, 36.85, -76.29);  // -> Norfolk
  assert.ok(near, 'a long eastward shot from Yuma must still see the Gila ridge');
  assert.match(near.name, /Gila/, 'got ' + near.name);
  assert.ok(near.distKm < 60, 'the ridge is ~30 km out, got ' + near.distKm);
  // Relief is measured above the STATION, not above sea level.
  assert.ok(near.reliefM > 850 && near.reliefM < 950,
    '962 m ridge seen from a 65 m station is ~900 m of relief, got ' + near.reliefM);
  assert.ok(near.subtendedDeg > 1 && near.subtendedDeg < 3,
    'a 900 m rise at 30 km subtends ~1.7 deg, got ' + near.subtendedDeg);
});

test('relief is measured above the station, so a high station is not blocked', function() {
  // Same class of ridge, but from Twentynine Palms at 700 m the Mojave's own
  // relief is not a horizon. Using height above SEA LEVEL would wrongly
  // charge a station for terrain it is already standing on top of.
  const fromLow = nearFieldObstacle(32.6566, -114.6060, 36.85, -76.29);
  const fromHigh = nearFieldObstacle(34.23, -116.05, 36.85, -76.29);
  assert.ok(fromLow, 'the low station should see a ridge');
  if (fromHigh) {
    assert.ok(fromHigh.reliefM < fromLow.reliefM,
      'the higher station must see less relief, not more');
  }
});

test('the near-field scan reports nothing when there is no near ridge', function() {
  // Mid-ocean: nothing to clear in the first 200 km.
  assert.equal(nearFieldObstacle(20, -150, 10, -140), null);
});

test('a near ridge and a mountainous path are charged independently', function() {
  // They are different mechanisms — the local horizon sets a minimum angle,
  // the range 900 km downpath scatters. A shot can suffer both.
  const r = pathTerrainAnalysis(32.6566, -114.6060, 36.85, -76.29, 32);
  assert.ok(r.nearObstacle, 'the Yuma->Norfolk path has a near ridge');
  assert.ok(typeof r.txElevM === 'number', 'the TX elevation must travel with the path');
  assert.ok(r.txElevM < 200, 'MCAS Yuma is low, got ' + r.txElevM);
});

test('the land mask is a plausible model of Earth', function() {
  // Sanity on the whole grid: land fraction near the real ~29-34% (1-degree
  // cell-centre sampling rounds coastal cells to land, so slightly high).
  let land = 0, total = 0;
  for (let la = -89.5; la < 90; la += 1) {
    for (let lo = -179.5; lo < 180; lo += 1) {
      total++;
      if (classifyPoint(la, lo).type !== 'ocean') land++;
    }
  }
  const frac = land / total;
  assert.ok(frac > 0.25 && frac < 0.40, 'land fraction implausible: ' + frac.toFixed(3));
});

// ── Mountains are handled the same way everywhere (v1.54) ───────────────────
// An audit after the Yuma work found the near-field scan saw a ridge at MCAS
// Yuma and NOTHING at Pohang, Iwakuni, Okinawa or Camp Lejeune — not because
// those places are flat, but because the database stopped at continental-scale
// ranges while Yuma had been surveyed in detail. Answer quality depended on
// where the work had happened, which is not a property a model should have.

test('the near-field survey never reports "clear", only what it knows', function() {
  // Three genuinely different situations that used to return an identical
  // null, indistinguishable from flat ground.
  const yuma = nearFieldSurvey(32.6566, -114.6060, 36.85, -76.29);
  assert.equal(yuma.status, 'blocked', 'a mapped ridge must be reported');

  const inRange = nearFieldSurvey(69.06, 18.54, 69.06, 26.0);   // Bardufoss
  assert.equal(inRange.status, 'in_range',
    'a station inside a range cannot have its local horizon resolved');
  assert.ok(inRange.txInRange);

  const blind = nearFieldSurvey(26.28, 127.78, 26.28, 130.0);   // Okinawa
  assert.equal(blind.status, 'none_mapped',
    'unmapped terrain must not be reported as clear');
});

test('every survey status is one of the three declared values', function() {
  const probes = [[32.66, -114.61], [34.65, -77.35], [26.28, 127.78],
                  [38, -98], [13.58, 144.92], [69.06, 18.54], [-33.9, 151.2]];
  for (const [lat, lon] of probes) {
    const v = nearFieldSurvey(lat, lon, lat, lon + 3);
    assert.ok(['blocked', 'in_range', 'none_mapped'].indexOf(v.status) !== -1,
      'unknown status at ' + [lat, lon] + ': ' + v.status);
    // 'blocked' is the only status that may carry an obstacle.
    if (v.status === 'blocked') assert.ok(v.obstacle);
    else assert.equal(v.obstacle, null);
  }
});

test('the Appalachians do not reach the Atlantic', function() {
  // The box spanned 33-47N / 85-68W and made the whole eastern seaboard a
  // mountain — Camp Lejeune, Norfolk, Philadelphia, New York and Boston all
  // took rocky-highland conductivity. Same class of defect as the Rockies box
  // that swallowed Las Vegas.
  for (const [name, lat, lon] of [['Camp Lejeune', 34.65, -77.35],
                                  ['Norfolk', 36.85, -76.29],
                                  ['Philadelphia', 39.95, -75.16],
                                  ['New York City', 40.71, -74.01],
                                  ['Boston', 42.36, -71.06]]) {
    const r = classifyPoint(lat, lon);
    assert.notEqual(r.type, 'mountain', name + ' is coastal, got ' + r.name);
    assert.ok(r.cond >= TERRAIN_COND.land,
      name + ' must not take rocky conductivity, got ' + r.cond);
  }
});

test('the split keeps the real Appalachian peaks', function() {
  // A fix that loses the mountains is not a fix.
  for (const [name, lat, lon] of [['Mt Mitchell', 35.77, -82.27],
                                  ['Asheville', 35.60, -82.55],
                                  ['Allegheny PA', 41.0, -78.5],
                                  ['Mt Washington', 44.27, -71.30],
                                  ['Adirondacks', 44.11, -73.92]]) {
    assert.equal(classifyPoint(lat, lon).type, 'mountain', name + ' should be mountain');
  }
});

test('the ranges around a base are seen at the bases Marines use', function() {
  // MCAGCC Twentynine Palms: cantonment on the desert floor, Bullion
  // Mountains just north of it. The base must not itself be a mountain, and
  // the ridge must be visible to a shot that crosses it.
  assert.equal(classifyPoint(34.23, -116.05).type, 'desert', 'the cantonment is on the floor');
  const v = nearFieldSurvey(34.23, -116.05, 34.45, -115.6);
  assert.equal(v.status, 'blocked', 'the Bullion Mountains should be seen');
  assert.ok(v.obstacle.reliefM > 300 && v.obstacle.reliefM < 900,
    'relief above a 700 m base should be a few hundred m, got ' + v.obstacle.reliefM);
});
