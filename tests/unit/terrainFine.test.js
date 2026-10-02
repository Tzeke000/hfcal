// The FINE terrain layer (v1.57): ~3.7 km chunks over the coarse ~28 km grid.
//
// The operator: "the map you're marking is pretty coarse — let's make it pretty
// detailed ... definitely good for all of North America and South America".
// These pin that the Americas are covered in full, that detail answers where
// it is loaded and the coarse grid everywhere else, and that the answers it
// gives at Marine bases are the real ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  parseElevationGrid, installElevationGrid, parseChunk, installChunk, uninstallChunks,
  chunkIdFor, elevMean, elevMax, elevResolution, ensureChunks, chunkLoaded,
} from '../../src/data/elevationGrid.js';
import { CHUNKS } from '../../src/data/terrainChunks.js';
import { nearFieldObstacle, nearFieldSurvey, terrainPointsForPath } from '../../src/physics/terrain.js';

const rd = (f) => { const b = readFileSync(new URL('../../' + f, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
installElevationGrid(parseElevationGrid(rd('public/elevation-grid.bin')));
const chunkFile = (id) => 'public/terrain/' + CHUNKS[id] + '/' + id + '.bin';
const load = (id) => installChunk(id, parseChunk(rd(chunkFile(id))));

test('every chunk in the manifest exists on disk and parses', function() {
  const ids = Object.keys(CHUNKS);
  assert.ok(ids.length > 100, 'expected the Americas at least, got ' + ids.length + ' chunks');
  for (const id of ids) {
    assert.ok(existsSync(new URL('../../' + chunkFile(id), import.meta.url)), 'missing ' + chunkFile(id));
    const p = parseChunk(rd(chunkFile(id)));
    assert.ok(p, id + ' did not parse');
    assert.equal(chunkIdFor(p.lat0 + 5, p.lon0 + 5), id, id + ' header disagrees with its name');
  }
});

test('the Americas are covered in full — every land chunk, pole to pole', function() {
  // Every 10-degree chunk west of 30W that holds non-ice land in the coarse
  // grid must have a fine chunk, and it must be one shipped inside the app.
  const missing = [];
  for (let lat0 = -60; lat0 < 80; lat0 += 10) {
    for (let lon0 = -180; lon0 < -30; lon0 += 10) {
      let land = false;
      for (let la = lat0 + 0.125; la < lat0 + 10 && !land; la += 0.25)
        for (let lo = lon0 + 0.125; lo < lon0 + 10 && !land; lo += 0.25)
          if (elevMax(la, lo) > 0) land = true;
      const id = chunkIdFor(lat0 + 5, lon0 + 5);
      if (land && CHUNKS[id] !== 'americas') missing.push(id);
    }
  }
  assert.deepEqual(missing, [], 'land chunks in the Americas without fine terrain');
});

test('named places sit where they should at fine resolution', function() {
  for (const id of new Set(['N30W120', 'N60W160', 'S40W080', 'N10W100'])) load(id);
  const near = (got, want, tol, what) =>
    assert.ok(Math.abs(got - want) <= tol, what + ': got ' + got + ' m, expected ~' + want);
  near(elevMax(36.578, -118.292), 4421, 200, 'Mt Whitney summit');
  near(elevMax(63.069, -151.007), 6190, 450, 'Denali summit');
  near(elevMax(-32.653, -70.011), 6961, 300, 'Aconcagua summit');
  near(elevMean(34.237, -116.06), 610, 120, 'MCAGCC Twentynine Palms mainside');
  near(elevMean(32.657, -114.606), 65, 80, 'MCAS Yuma');
  uninstallChunks();
});

test('detail answers where it is loaded, the coarse grid everywhere else', function() {
  uninstallChunks();
  assert.equal(elevResolution(32.66, -114.61), 'coarse');
  load('N30W120');
  assert.equal(elevResolution(32.66, -114.61), 'fine');
  assert.equal(elevResolution(35.0, 135.0), 'coarse', 'Japan has no fine chunk loaded in this test');
  assert.equal(elevResolution(-80, 0), null, 'ice sheets have no trustworthy data');
  uninstallChunks();
});

test('fine data places the Gila ridge where it is, not at the nearest coarse cell edge', function() {
  // On the ~28 km grid the ridge came back "720 m up at 12 km" — the nearest
  // point of the coarse cell holding the crest. Fine data reads the terrain
  // the beam actually crosses.
  uninstallChunks();
  const coarse = nearFieldObstacle(32.6566, -114.6060, 36.85, -76.29);
  load('N30W120');
  const fine = nearFieldObstacle(32.6566, -114.6060, 36.85, -76.29);
  assert.ok(coarse && fine);
  assert.ok(fine.distKm > coarse.distKm, 'fine data should not place the crest at the cell edge');
  assert.ok(fine.subtendedDeg < coarse.subtendedDeg, 'the coarse grid overstated the angle (safe side), fine corrects it');
  const v = nearFieldSurvey(32.6566, -114.6060, 32.62, -114.05);
  assert.equal(v.status, 'blocked');
  assert.equal(v.resolutionKm, 4, 'the answer must say it was made at ~4 km');
  uninstallChunks();
});

test('the points a path needs cover both ends’ 200 km horizons', function() {
  const pts = terrainPointsForPath(32.66, -114.61, 36.85, -76.29);
  const ids = new Set(pts.map(p => chunkIdFor(p[0], p[1])));
  assert.ok(ids.has('N30W120'), 'Yuma end');
  assert.ok(ids.has('N30W080'), 'Norfolk end');
  assert.ok(ids.size < 20, 'a long path should still be a handful of chunks, got ' + ids.size);
});

test('ensureChunks loads each needed chunk once, and reports what it added', async function() {
  uninstallChunks();
  let fetches = 0;
  global.fetch = (url) => {
    fetches += 1;
    const m = String(url).match(/terrain\/(\w+)\/(\w+)\.bin$/);
    const buf = rd('public/terrain/' + m[1] + '/' + m[2] + '.bin');
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
  };
  try {
    const pts = terrainPointsForPath(32.66, -114.61, 33.35, -117.42);   // Yuma -> Pendleton
    const added = await ensureChunks(pts, '');
    assert.ok(added >= 1, 'expected at least the Yuma chunk');
    assert.ok(chunkLoaded('N30W120'));
    const before = fetches;
    assert.equal(await ensureChunks(pts, ''), 0, 'nothing new the second time');
    assert.equal(fetches, before, 'a loaded chunk must not be fetched again');
  } finally { delete global.fetch; uninstallChunks(); }
});

test('an offline chunk fetch fails quietly and can be retried', async function() {
  uninstallChunks();
  global.fetch = () => Promise.reject(new Error('offline'));
  try {
    assert.equal(await ensureChunks([[32.66, -114.61]], ''), 0);
    assert.equal(chunkLoaded('N30W120'), false);
    assert.equal(elevResolution(32.66, -114.61), 'coarse', 'falls back to the coarse grid');
  } finally { delete global.fetch; }
  let called = 0;
  global.fetch = () => { called += 1; return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(rd(chunkFile('N30W120'))) }); };
  try {
    assert.equal(await ensureChunks([[32.66, -114.61]], ''), 1, 'a failed load must not be remembered as done');
    assert.equal(called, 1);
  } finally { delete global.fetch; uninstallChunks(); }
});
