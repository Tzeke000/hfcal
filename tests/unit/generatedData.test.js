// Integrity of the two GENERATED data modules.
//
// src/data/fof2Map.js and src/data/mfactorTable.js are written by scripts under
// scripts/validation/ and are the only two source files nobody hand-edits.
// They were also the only two with no test at all, which is backwards: a
// generated file is exactly the kind that can be silently truncated, exported
// at the wrong precision, or written with its axes in a different order, and
// none of that shows up as a crash. It shows up as quietly wrong frequencies.
//
// This has bitten the project twice already, both recorded in
// docs/VALIDATION.md: coefficients exported at 7 significant figures caused a
// 0.4% JS/Python divergence, and the M table was once fitted on raw minima
// while the app fed it corrected ones.
//
// These tests do not re-validate the physics — the VOACAP studies do that.
// They check that what is on disk is shaped the way the code that reads it
// believes, and that it still produces physically possible numbers everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOF2_MAP_ORDERS, FOF2_MAP_MODIP_SCALE, FOF2_MAP_SSN_SCALE,
  FOF2_MAP_COEFFS, FOF2_MAP_HELDOUT_PCT,
} from '../../src/data/fof2Map.js';
import {
  MFACTOR_DISTANCES, MFACTOR_SSNS, MFACTOR_NLST, MFACTOR_SCALE,
  MFACTOR_TABLE, MFACTOR_HELDOUT_PCT,
} from '../../src/data/mfactorTable.js';
import {
  mapFoF2, mFactorLookup, MFACTOR_MIN, MFACTOR_MAX,
  MAP_FOF2_MIN, MAP_FOF2_MAX,
} from '../../src/physics/freqAdvisor.js';

// ── The M-factor table ───────────────────────────────────────────────────────

test('the M table length matches its own declared geometry exactly', function() {
  // Truncation is the failure mode this catches: a short write leaves the
  // trailing cells reading as zero, which decodes to M = 0 and a MUF of zero.
  const expected = MFACTOR_DISTANCES.length * MFACTOR_NLST * 12 * MFACTOR_SSNS.length;
  assert.equal(MFACTOR_TABLE.length, expected,
    'declared ' + MFACTOR_DISTANCES.length + ' dist x ' + MFACTOR_NLST + ' lst x 12 month x '
    + MFACTOR_SSNS.length + ' ssn = ' + expected + ' cells, file has ' + MFACTOR_TABLE.length);
});

test('every M cell decodes to a physically possible oblique factor', function() {
  // M = MUF / foF2. It cannot be below 1 (that would be less than vertical
  // incidence) and the secant law caps it near 3.5 at realistic takeoff angles.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < MFACTOR_TABLE.length; i++) {
    const m = MFACTOR_TABLE[i] * MFACTOR_SCALE;
    assert.ok(isFinite(m), 'non-finite M at cell ' + i);
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  assert.ok(lo >= 1.0, 'an M below 1 means the table is misindexed or truncated: ' + lo);
  assert.ok(hi <= 4.0, 'an M above 4 is not reachable by the secant law: ' + hi);
});

test('the M table axes are sorted and free of duplicates', function() {
  // The lookup interpolates by scanning these, so an unsorted axis silently
  // returns the wrong cell rather than failing.
  for (const [name, axis] of [['distances', MFACTOR_DISTANCES], ['ssns', MFACTOR_SSNS]]) {
    for (let i = 1; i < axis.length; i++) {
      assert.ok(axis[i] > axis[i - 1], name + ' axis is not strictly increasing at ' + i);
    }
  }
  assert.ok(MFACTOR_NLST > 0 && 24 % MFACTOR_NLST === 0,
    'local-time bins must divide the day evenly, got ' + MFACTOR_NLST);
});

test('the M lookup stays in band across the whole input space', function() {
  // Catches a reordered or rescaled table: the output would leave the band
  // long before any individual cell looked wrong.
  for (const dist of [100, 250, 800, 1500, 3000, 6000, 12000, 20000]) {
    for (let lst = 0; lst < 24; lst += 3) {
      for (let month = 1; month <= 12; month += 1) {
        for (const ssn of [0, 10, 70, 150, 300]) {
          const m = mFactorLookup(dist, lst, month, ssn);
          if (m === null) continue;
          assert.ok(m >= MFACTOR_MIN - 1e-9 && m <= MFACTOR_MAX + 1e-9,
            'M out of band at ' + [dist, lst, month, ssn] + ': ' + m);
        }
      }
    }
  }
});

test('the M table records the accuracy it was measured at', function() {
  assert.ok(MFACTOR_HELDOUT_PCT > 0 && MFACTOR_HELDOUT_PCT < 10,
    'held-out accuracy should be recorded and single-digit: ' + MFACTOR_HELDOUT_PCT);
});

// ── The foF2 coefficient map ─────────────────────────────────────────────────

test('every map coefficient is finite and carried at full precision', function() {
  assert.ok(FOF2_MAP_COEFFS.length > 0);
  for (let i = 0; i < FOF2_MAP_COEFFS.length; i++) {
    assert.ok(isFinite(FOF2_MAP_COEFFS[i]), 'non-finite coefficient at ' + i);
  }
  // The 7-significant-figure export bug: coefficients written through a
  // formatter rather than repr() cost 0.4% against the Python mirror. A
  // full-precision double round-trips through its own string form.
  const rounded = FOF2_MAP_COEFFS.filter(function(c) {
    return c !== 0 && Number(c.toPrecision(7)) === c && String(c).length < 9;
  });
  assert.ok(rounded.length < FOF2_MAP_COEFFS.length * 0.5,
    rounded.length + ' of ' + FOF2_MAP_COEFFS.length
    + ' coefficients look truncated to ~7 significant figures');
});

test('the map orders and scales are sane', function() {
  for (const k of ['nt', 'nm', 'nl', 'ns']) {
    assert.ok(Number.isInteger(FOF2_MAP_ORDERS[k]) && FOF2_MAP_ORDERS[k] >= 0,
      'bad order ' + k + ': ' + FOF2_MAP_ORDERS[k]);
  }
  assert.ok(FOF2_MAP_MODIP_SCALE > 0);
  assert.ok(FOF2_MAP_SSN_SCALE > 0);
  assert.ok(FOF2_MAP_HELDOUT_PCT > 0 && FOF2_MAP_HELDOUT_PCT < 15,
    'held-out accuracy should be recorded: ' + FOF2_MAP_HELDOUT_PCT);
});

test('the map returns a physical foF2 everywhere, or refuses', function() {
  // The map is the fallback the app runs on before the lookup table arrives,
  // so it has to be safe over the whole input space rather than only where it
  // was fitted. Out of band it must return null, never a wrong number.
  let served = 0;
  for (let modip = -90; modip <= 90; modip += 10) {
    for (let lst = 0; lst < 24; lst += 3) {
      for (let month = 1; month <= 12; month += 1) {
        for (const ssn of [0, 70, 200]) {
          for (const lon of [-180, -60, 0, 60, 179]) {
            const v = mapFoF2(modip, lst, month, ssn, lon);
            if (v === null) continue;
            served++;
            assert.ok(isFinite(v), 'non-finite foF2 at ' + [modip, lst, month, ssn, lon]);
            assert.ok(v >= MAP_FOF2_MIN && v <= MAP_FOF2_MAX,
              'foF2 outside its clamp at ' + [modip, lst, month, ssn, lon] + ': ' + v);
          }
        }
      }
    }
  }
  assert.ok(served > 1000, 'the map refused almost everything (' + served + ' served)');
});

test('the map rejects inputs it cannot evaluate rather than guessing', function() {
  assert.equal(mapFoF2(NaN, 12, 6, 70, 0), null);
  assert.equal(mapFoF2(30, 12, NaN, 70, 0), null);
  assert.equal(mapFoF2(30, 12, 0, 70, 0), null, 'month 0 is not a month');
  assert.equal(mapFoF2(30, 12, 13, 70, 0), null, 'month 13 is not a month');
  assert.equal(mapFoF2(30, 12, 6, 70, NaN), null);
});


// ── The land/sea bitmask (v1.42) ────────────────────────────────────────────
// Generated by scripts/validation/build/build_land_mask.py from Natural Earth
// coastlines. Like the other generated tables, it can be silently truncated or
// mis-decoded without crashing, so its shape is checked here.

import { isLand, LAND_MASK_NLON, LAND_MASK_NLAT, LAND_MASK_LAND_FRACTION } from '../../src/data/landMask.js';

test('the land mask has the declared 1-degree geometry', function() {
  assert.equal(LAND_MASK_NLON, 360);
  assert.equal(LAND_MASK_NLAT, 180);
  assert.ok(LAND_MASK_LAND_FRACTION > 0.25 && LAND_MASK_LAND_FRACTION < 0.40,
    'recorded land fraction implausible: ' + LAND_MASK_LAND_FRACTION);
});

test('isLand is defined and stable everywhere, and wraps longitude', function() {
  for (let la = -89.5; la < 90; la += 7) {
    for (let lo = -179.5; lo < 180; lo += 11) {
      const v = isLand(la, lo);
      assert.equal(typeof v, 'boolean', 'non-boolean at ' + [la, lo]);
      // Longitude wraps: lon and lon+360 are the same cell.
      assert.equal(isLand(la, lo), isLand(la, lo + 360), 'lon wrap broken at ' + [la, lo]);
    }
  }
});

test('isLand agrees with known land and sea points', function() {
  assert.equal(isLand(38, -98), true, 'Kansas');
  assert.equal(isLand(23, 10), true, 'Sahara');
  assert.equal(isLand(30, -150), false, 'mid-Pacific');
  assert.equal(isLand(40, 160), false, 'NW Pacific (bug #1)');
  assert.equal(isLand(NaN, 0), false, 'NaN is not land');
});
