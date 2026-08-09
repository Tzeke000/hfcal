// Which source wins when they disagree.
//
// This lives in its own file on purpose: the tests install a synthetic foF2
// table, and module state is per-file under `node --test`, so doing it here
// cannot leak into freqAdvisor.test.js.
//
// The behaviour under test is the fix from docs/VALIDATION.md Part 19. Before
// v1.24 a table value had to agree with the physical model to within
// MAP_SANITY_FACTOR or it was discarded. Above the auroral oval and through
// polar night the physical model is the thing that is wrong, so the guard was
// discarding measured values and returning a MUF that was low by 46% on every
// row it fired on. The table is now guarded only by a physical band.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFoF2Table, tableFoF2, TABLE_SCALE } from '../../src/data/fof2Table.js';
import {
  bounceFoF2, estimateFoF2, localSolarTime,
  MAP_SANITY_FACTOR, TABLE_FOF2_MIN, TABLE_FOF2_MAX,
} from '../../src/physics/freqAdvisor.js';

// A table whose every cell holds the same foF2, so a test can state exactly
// what the table says and check what comes back out.
function uniformTable(mhz) {
  var meta = {
    nLat: 2, nLon: 2, nMon: 12, nHour: 24, nSsn: 2,
    lat0: -85, latStep: 170, lon0: -180, lonStep: 180, ssns: [10, 150],
  };
  var n = meta.nLat * meta.nLon * meta.nMon * meta.nHour * meta.nSsn;
  var byte = Math.round(mhz / TABLE_SCALE);
  assert.ok(byte >= 0 && byte <= 255, 'test value must fit a uint8: ' + mhz);
  return installFoF2Table({ meta: meta, data: new Uint8Array(n).fill(byte) });
}

// Deep polar night: 80 N in January, local midnight. The physical model has no
// sun here at any hour, so it predicts a very low foF2 — and the real
// ionosphere does not agree, which is the whole point.
var POLAR = { lat: 80, lon: 20, magLatDeg: 77, modipDeg: 79 };
var UTC = 23, MONTH = 1, SSN = 70;

function physicsAt(b) {
  return estimateFoF2(SSN, localSolarTime(UTC, b.lon), MONTH, b.magLatDeg, b.lat);
}

test('the table wins even when it disagrees violently with the physical model', function() {
  var phys = physicsAt(POLAR);
  var far = 8.0;
  assert.ok(far > phys * MAP_SANITY_FACTOR,
    'test is only meaningful if the value is outside the old guard band '
    + '(physics ' + phys.toFixed(2) + ', table ' + far + ')');

  assert.ok(uniformTable(far), 'table failed to install');
  assert.equal(tableFoF2(POLAR.lat, POLAR.lon, MONTH, UTC, SSN), far);

  // The regression: this used to return `phys`, which on real polar rows was
  // low by 46% every single time.
  assert.equal(bounceFoF2(SSN, UTC, MONTH, POLAR), far);
});

test('the table also wins when it is far BELOW the model', function() {
  var phys = physicsAt(POLAR);
  var low = 0.6;
  assert.ok(low * MAP_SANITY_FACTOR < phys, 'value must be outside the old band');
  assert.ok(uniformTable(low));
  assert.equal(bounceFoF2(SSN, UTC, MONTH, POLAR), low);
});

test('a table value that is not physically an foF2 is still rejected', function() {
  // The one thing the band guard is for: a corrupt or misparsed asset. The
  // physical model takes over rather than the app quoting nonsense.
  var phys = physicsAt(POLAR);

  assert.ok(uniformTable(25.0));          // above TABLE_FOF2_MAX
  assert.ok(25.0 > TABLE_FOF2_MAX);
  assert.equal(bounceFoF2(SSN, UTC, MONTH, POLAR), phys);

  assert.ok(uniformTable(0.2));           // below TABLE_FOF2_MIN
  assert.ok(0.2 < TABLE_FOF2_MIN);
  assert.equal(bounceFoF2(SSN, UTC, MONTH, POLAR), phys);
});

test('the band is wide enough to admit every real ionospheric value', function() {
  assert.ok(TABLE_FOF2_MIN <= 0.5, 'nighttime polar foF2 can be very low');
  assert.ok(TABLE_FOF2_MAX >= 18, 'solar-max equatorial noon foF2 reaches ~16 MHz');
});

test('a plausible table value is used at every latitude, month and hour', function() {
  assert.ok(uniformTable(6.4));
  for (var lat = -85; lat <= 85; lat += 17) {
    for (var lon = -180; lon < 180; lon += 90) {
      for (var m = 1; m <= 12; m += 1) {
        for (var h = 0; h < 24; h += 4) {
          var v = bounceFoF2(SSN, h, m, { lat: lat, lon: lon, magLatDeg: lat * 0.9, modipDeg: lat });
          // 0.1 MHz quantisation is not exactly representable in binary.
          assert.ok(Math.abs(v - 6.4) < 1e-9, 'table not used at ' + [lat, lon, m, h] + ': ' + v);
        }
      }
    }
  }
});

test('the map is STILL guarded against the physical model', function() {
  // The map is a fitted polynomial and can extrapolate to anything, so it
  // keeps its chaperone. Removing the guard from the table did not remove it
  // from the map. With no usable table value the map path is what runs.
  assert.ok(uniformTable(25.0));          // rejected by the band -> falls through
  for (var lat = -80; lat <= 80; lat += 20) {
    for (var m = 1; m <= 12; m += 3) {
      for (var h = 0; h < 24; h += 6) {
        var b = { lat: lat, lon: 20, magLatDeg: lat * 0.9, modipDeg: lat * 1.1 };
        var phys = estimateFoF2(SSN, localSolarTime(h, b.lon), m, b.magLatDeg, b.lat);
        var v = bounceFoF2(SSN, h, m, b);
        assert.ok(v <= phys * MAP_SANITY_FACTOR + 1e-9,
          'map escaped the band high at ' + [lat, m, h]);
        assert.ok(v * MAP_SANITY_FACTOR >= phys - 1e-9,
          'map escaped the band low at ' + [lat, m, h]);
      }
    }
  }
});
