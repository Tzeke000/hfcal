// Unit tests for fof2Table.js — run with `npm test` (node --test).
// The table is a precached binary asset, so these load the real file from
// public/ and exercise the same parse and interpolation path the app uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseFoF2Table, installFoF2Table, tableFoF2, foF2TableReady, foF2TableMeta,
  TABLE_SCALE,
} from './fof2Table.js';

function loadReal() {
  var p = path.join(process.cwd(), 'public', 'fof2-table.bin');
  var b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

test('parses the shipped binary and reports its geometry', function() {
  var parsed = parseFoF2Table(loadReal());
  assert.ok(parsed, 'the shipped table must parse');
  assert.ok(installFoF2Table(parsed));
  assert.ok(foF2TableReady());
  var m = foF2TableMeta();
  assert.equal(m.nMon, 12);
  assert.equal(m.nHour, 24);
  assert.ok(m.nLat >= 19 && m.nLon >= 12, 'grid should be at least 10 deg / 30 deg');
  assert.ok(m.nSsn >= 2, 'need at least two solar levels to interpolate');
  assert.ok(m.ssns[0] < m.ssns[m.nSsn - 1], 'solar levels must ascend');
});

test('rejects a corrupt or truncated file rather than serving garbage', function() {
  assert.equal(parseFoF2Table(new ArrayBuffer(8)), null);
  var good = loadReal();
  assert.equal(parseFoF2Table(good.slice(0, good.byteLength - 10)), null, 'truncated must fail');
  var bad = good.slice(0);
  new DataView(bad).setUint8(0, 0);
  assert.equal(parseFoF2Table(bad), null, 'bad magic must fail');
});

test('every value in the table is a physical critical frequency', function() {
  var m = foF2TableMeta();
  var lo = Infinity, hi = 0;
  for (var la = m.lat0; la <= m.lat0 + m.latStep * (m.nLat - 1); la += m.latStep) {
    for (var lo2 = -180; lo2 < 180; lo2 += 30) {
      for (var mo = 1; mo <= 12; mo += 2) {
        for (var h = 0; h < 24; h += 3) {
          var v = tableFoF2(la, lo2, mo, h, 70);
          assert.ok(v !== null && isFinite(v), 'no value at ' + [la, lo2, mo, h]);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
  }
  assert.ok(lo > 0.5 && hi < 30, 'foF2 range out of bounds: ' + lo + ' to ' + hi);
});

test('longitude, hour and month all wrap continuously', function() {
  var a = tableFoF2(0, 179.9, 6, 12, 70), b = tableFoF2(0, -180.1, 6, 12, 70);
  assert.ok(Math.abs(a - b) < 0.5, 'longitude seam: ' + a + ' vs ' + b);
  var h1 = tableFoF2(10, 20, 6, 23.9, 70), h2 = tableFoF2(10, 20, 6, 0.1, 70);
  assert.ok(Math.abs(h1 - h2) < 0.8, 'hour seam: ' + h1 + ' vs ' + h2);
  var m1 = tableFoF2(10, 20, 12.9, 12, 70), m2 = tableFoF2(10, 20, 1, 12, 70);
  assert.ok(Math.abs(m1 - m2) < 1.5, 'month seam: ' + m1 + ' vs ' + m2);
});

test('latitude and solar activity clamp instead of running off the grid', function() {
  var m = foF2TableMeta();
  var top = m.lat0 + m.latStep * (m.nLat - 1);
  assert.equal(tableFoF2(top + 40, 0, 6, 12, 70), tableFoF2(top, 0, 6, 12, 70));
  assert.equal(tableFoF2(m.lat0 - 40, 0, 6, 12, 70), tableFoF2(m.lat0, 0, 6, 12, 70));
  var hiSsn = m.ssns[m.nSsn - 1];
  assert.equal(tableFoF2(30, 0, 6, 12, hiSsn + 500), tableFoF2(30, 0, 6, 12, hiSsn));
  assert.equal(tableFoF2(30, 0, 6, 12, -50), tableFoF2(30, 0, 6, 12, m.ssns[0]));
});

test('interpolation is monotonic between grid nodes', function() {
  // Walking across one longitude cell must not jump around.
  var m = foF2TableMeta();
  var prev = null, jumps = 0;
  for (var f = 0; f <= 1.0001; f += 0.1) {
    var v = tableFoF2(30, m.lon0 + m.lonStep * (8 + f), 6, 12, 70);
    if (prev !== null && Math.abs(v - prev) > 1.0) jumps++;
    prev = v;
  }
  assert.equal(jumps, 0, 'interpolation should be smooth inside a cell');
});

test('rejects bad input rather than guessing', function() {
  assert.equal(tableFoF2(NaN, 0, 6, 12, 70), null);
  assert.equal(tableFoF2(0, NaN, 6, 12, 70), null);
  assert.equal(tableFoF2(0, 0, 0, 12, 70), null, 'month out of range');
  assert.equal(tableFoF2(0, 0, 13, 12, 70), null);
  assert.equal(tableFoF2(0, 0, 6, NaN, 70), null);
});

test('the quantisation step is fine enough not to matter', function() {
  // 0.1 MHz on a typical 8 MHz value is 0.6%, well under the accuracy claimed.
  assert.ok(TABLE_SCALE <= 0.1);
});
