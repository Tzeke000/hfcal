// Unit tests for commCard.js — run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dtg, fmtLatLon, formatCommCard, shotLabel, commCardFilename } from './commCard.js';

var SHOT = {
  dtg: '271430Z JUL 26',
  p1: { lat: 34.23, lon: -116.05 },
  p2: { lat: 33.95, lon: -107.69 },
  distKm: 770.4, distMi: 478.7, bearing: 90.4, cardinal: 'E',
  backBearing: 274.9, backCardinal: 'W',
  magBearing: 101, declination: -10.6,
  freqMHz: 11.104, zoneName: 'SINGLE-HOP SKYWAVE (500-2000 km)', takeoffDeg: 40.5,
  wireLabel: 'STAINLESS 14 AWG', vf: 0.89,
  legEndM: 0.0762,
  antenna: {
    name: 'INVERTED-V DIPOLE', legFtIn: '19 ft 8 in', legM: 6.007,
    totalFtIn: '39 ft 5 in', totalM: 12.014,
    apexFt: 16.4, apexM: 5.0, feasible: false,
  },
  freqCheck: { luf: 5.5, muf: 15.7, fot: 13.4, verdictLabel: 'GOOD' },
  appVersion: '1.7.0',
};

test('dtg: standard military date-time group in UTC', function() {
  assert.equal(dtg(new Date(Date.UTC(2026, 6, 27, 14, 30))), '271430Z JUL 26');
  assert.equal(dtg(new Date(Date.UTC(2026, 0, 5, 3, 7))), '050307Z JAN 26');
});

test('fmtLatLon: hemisphere letters, four decimals', function() {
  assert.equal(fmtLatLon(34.23, -116.05), '34.2300N 116.0500W');
  assert.equal(fmtLatLon(-33.9, 151.2), '33.9000S 151.2000E');
});

test('formatCommCard: contains every operationally required field', function() {
  var t = formatCommCard(SHOT);
  ['HF ANTENNA PLAN', '271430Z JUL 26', '34.2300N 116.0500W', '33.9500N 107.6900W',
   '770.4 km', '90.4 deg E', '11.104 MHz', 'SINGLE-HOP', '~41 deg',
   '(you -> target)', 'BACK AZ', '274.9 deg W', '(target -> you)',
   'SET MAG', '101 deg on compass', '(var 10.6 W)',
   'STAINLESS 14 AWG', 'VF 0.890', 'INVERTED-V DIPOLE', '19 ft 8 in',
   '39 ft 5 in', '5.5 - 15.7 MHz', '13.4 MHz', 'HFCALC-AG-EZK-USMC-v1',
  ].forEach(function(frag) {
    assert.ok(t.indexOf(frag) !== -1, 'missing: ' + frag);
  });
});

test('formatCommCard: flags a buildable-max apex', function() {
  var t = formatCommCard(SHOT);
  assert.ok(/APEX\s+16 ft \(5\.0 m\)\s+\[buildable max\]/.test(t), t);
  // A feasible apex carries no flag
  var ok = JSON.parse(JSON.stringify(SHOT));
  ok.antenna.feasible = true;
  assert.ok(formatCommCard(ok).indexOf('[buildable max]') === -1);
});

test('formatCommCard: leg end height reported in inches', function() {
  assert.ok(formatCommCard(SHOT).indexOf('3.0 in above ground') !== -1);
});

test('formatCommCard: omits optional sections cleanly', function() {
  var bare = {
    dtg: '010000Z JAN 26',
    p1: { lat: 0, lon: 0 }, p2: { lat: 1, lon: 1 },
    distKm: 157.2, distMi: 97.7, bearing: 45, freqMHz: 5.3,
    wireLabel: 'COPPER 14 AWG', vf: 0.95, appVersion: '1.7.0',
  };
  var t = formatCommCard(bare);
  assert.ok(!/^ANTENNA\s/m.test(t), 'no antenna row');
  assert.ok(t.indexOf('LUF/MUF') === -1, 'no freq check block');
  assert.ok(t.indexOf('NOTE') === -1);
  assert.ok(t.indexOf('5.3 MHz') !== -1);
  // Never emits "undefined"/"null" text
  assert.ok(!/undefined|null|NaN/.test(t), t);
});

test('formatCommCard: fixed-width label column stays aligned', function() {
  formatCommCard(SHOT).split('\n').forEach(function(line) {
    if (/^[A-Z/ ]{2,9}\s{2,}\S/.test(line)) {
      assert.ok(line.length <= 78, 'line too wide for a comm card: ' + line);
    }
  });
});

test('formatCommCard: magnetic bearing omitted when declination is unknown', function() {
  var noMag = JSON.parse(JSON.stringify(SHOT));
  delete noMag.magBearing; delete noMag.declination;
  var t = formatCommCard(noMag);
  assert.ok(t.indexOf('SET MAG') === -1);
  assert.ok(t.indexOf('BEARING') !== -1, 'true bearing still present');
});

test('formatCommCard: easterly declination is labelled E', function() {
  var east = JSON.parse(JSON.stringify(SHOT));
  east.magBearing = 80; east.declination = 10.9;
  assert.ok(/SET MAG\s+80 deg on compass\s+\(var 10\.9 E\)/.test(formatCommCard(east)));
});

test('formatCommCard: back azimuth omitted when not supplied', function() {
  var noBack = JSON.parse(JSON.stringify(SHOT));
  delete noBack.backBearing; delete noBack.backCardinal;
  var t = formatCommCard(noBack);
  assert.ok(t.indexOf('BACK AZ') === -1);
  assert.ok(t.indexOf('(you -> target)') !== -1, 'primary bearing still labelled');
});

test('shotLabel and filename', function() {
  assert.equal(shotLabel(SHOT), '11.104 MHz · 770 km · INVERTED-V DIPOLE');
  assert.equal(commCardFilename(SHOT), 'HFPLAN_271430ZJUL26_11.104MHz.txt');
});


// ── Robustness against shots written by older app versions ──────────────────
// loadShots() returns anything that parsed as an array out of localStorage, so
// a plan saved months ago by an older build reaches the exporter with fields
// that did not exist then. It used to throw on the first missing one, and the
// operator lost the card with nothing on screen explaining why.

test('a shot from an older app version still exports', function() {
  const old = {
    p1: { lat: 34.9, lon: -76.88 }, p2: { lat: 26.35, lon: 127.77 },
    distKm: 12500, bearing: 310, freq: 7.3,
    // no distMi, no vf, no freqMHz, no freqCheck — none of these existed yet
  };
  const card = formatCommCard(old);
  assert.ok(typeof card === 'string' && card.length > 0);
  assert.match(card, /FROM/);
  assert.match(card, /12500\.0 km/);
  assert.match(card, /--/, 'missing fields should print as unknown, not vanish');
});

test('a completely empty shot does not take the exporter down', function() {
  const card = formatCommCard({});
  assert.ok(typeof card === 'string' && card.length > 0);
});

test('the card carries the settings its frequencies depend on', function() {
  // The LUF moves with transmit power and the MUF with the month. A card
  // quoting either without the setting behind it cannot be checked by whoever
  // receives it.
  const card = formatCommCard({
    p1: { lat: 34.9, lon: -76.88 }, p2: { lat: 26.35, lon: 127.77 },
    distKm: 12500, distMi: 7767, bearing: 310, freqMHz: 7.3, vf: 0.95,
    freqCheck: { luf: 6.2, muf: 18.4, fot: 14.2, txWatts: 20, month: 8 },
  });
  assert.match(card, /POWER\s+20 W/, 'the power that set the LUF must be on the card');
  assert.match(card, /MONTH\s+AUG/, 'the month that set the MUF must be on the card');
});
