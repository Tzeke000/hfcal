// Unit tests for spacewx.js — run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFluxPayload, parseKIndexPayload,
  interpretSFI, interpretKp, spaceWxAdvice,
} from '../../src/lib/spacewx.js';

test('parseFluxPayload: SWPC summary object form', function() {
  var r = parseFluxPayload({ Flux: '142', TimeStamp: '2026-07-27 20:00:00' });
  assert.equal(r.sfi, 142);
  assert.equal(r.time, '2026-07-27 20:00:00');
  // Key casing tolerance
  assert.equal(parseFluxPayload({ flux: '96.4' }).sfi, 96.4);
});

test('parseFluxPayload: table form and garbage', function() {
  var table = [['time_tag', 'flux'], ['2026-07-27 17:00', '135'], ['2026-07-27 20:00', '138']];
  var r = parseFluxPayload(table);
  assert.equal(r.sfi, 138);           // last row wins
  assert.equal(r.time, '2026-07-27 20:00');
  assert.equal(parseFluxPayload(null), null);
  assert.equal(parseFluxPayload({ Flux: 'Unk' }), null);
  assert.equal(parseFluxPayload({ nothing: 1 }), null);
  assert.equal(parseFluxPayload([]), null);
});

test('parseKIndexPayload: SWPC table form', function() {
  var table = [
    ['time_tag', 'Kp', 'a_running', 'station_count'],
    ['2026-07-27 15:00:00', '2.33', '8', '8'],
    ['2026-07-27 18:00:00', '3.67', '15', '8'],
  ];
  var r = parseKIndexPayload(table);
  assert.equal(r.kp, 3.67);
  assert.equal(r.time, '2026-07-27 18:00:00');
});

test('parseKIndexPayload: object-array form and garbage', function() {
  var objs = [{ time_tag: '2026-07-27T18:00Z', kp_index: 4 }, { time_tag: '2026-07-27T21:00Z', kp_index: 5.33 }];
  assert.equal(parseKIndexPayload(objs).kp, 5.33);
  assert.equal(parseKIndexPayload(null), null);
  assert.equal(parseKIndexPayload([['time_tag', 'foo'], ['x', '1']]), null);
});

test('interpretSFI: standard band-conditions thresholds', function() {
  assert.equal(interpretSFI(65).label, 'VERY LOW');
  assert.equal(interpretSFI(70).label, 'LOW');
  assert.equal(interpretSFI(90).label, 'MODERATE');
  assert.equal(interpretSFI(120).label, 'HIGH');
  assert.equal(interpretSFI(150).label, 'VERY HIGH');
});

test('interpretKp: NOAA G-scale alignment (storm starts at Kp 5)', function() {
  assert.equal(interpretKp(1).degraded, false);
  assert.equal(interpretKp(4.67).degraded, false);
  assert.equal(interpretKp(5).degraded, true);
  assert.equal(interpretKp(5).label, 'STORM (G1–G2)');
  assert.equal(interpretKp(7).label, 'SEVERE STORM');
});

test('spaceWxAdvice: storm warning fires at Kp ≥ 5 regardless of zone', function() {
  var a = spaceWxAdvice({ sfi: 100, kp: 5.3, freqMHz: 7.1, zone: 'nvis' });
  assert.equal(a.length, 1);
  assert.ok(a[0].indexOf('Geomagnetic storm') === 0);
  assert.equal(spaceWxAdvice({ sfi: 100, kp: 2, freqMHz: 7.1, zone: 'nvis' }).length, 0);
});

test('spaceWxAdvice: low flux + high band on a skywave path warns', function() {
  var a = spaceWxAdvice({ sfi: 72, kp: 1, freqMHz: 21.3, zone: 'singlehop' });
  assert.equal(a.length, 1);
  assert.ok(a[0].indexOf('above the usable MUF') !== -1);
  // On an NVIS path the skywave MUF warning must not fire (SFI 76 also
  // sits above the NVIS punch-through threshold, so nothing fires at all)
  assert.equal(spaceWxAdvice({ sfi: 76, kp: 1, freqMHz: 21.3, zone: 'nvis' }).length, 0);
});

test('spaceWxAdvice: high flux + low band on DX suggests higher bands', function() {
  var a = spaceWxAdvice({ sfi: 135, kp: 2, freqMHz: 7.1, zone: 'longdx' });
  assert.equal(a.length, 1);
  assert.ok(a[0].indexOf('higher bands') !== -1);
});

test('spaceWxAdvice: NVIS punch-through warning at very low flux', function() {
  var a = spaceWxAdvice({ sfi: 68, kp: 1, freqMHz: 9.0, zone: 'nvis' });
  assert.equal(a.length, 1);
  assert.ok(a[0].indexOf('critical frequency') !== -1);
  assert.equal(spaceWxAdvice({ sfi: 68, kp: 1, freqMHz: 6.0, zone: 'nvis' }).length, 0);
});
