// ── COMM CARD EXPORT ──────────────────────────────────────────────────────────
// Turns a saved shot into a fixed-width text block an operator can copy onto a
// real comm card, paste into a message, or hand to the next shift. Pure
// functions only, so the format is unit-tested and cannot drift silently.
//
// This module is part of the original work of Cpl Angeles-Gonzalez,
// Ezekiel S., USMC. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────

var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// DDHHMMZ MON YY — the standard military date-time group.
export function dtg(date) {
  var months = MONTHS;
  function pad(n) { return String(n).padStart(2, '0'); }
  return pad(date.getUTCDate()) + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + 'Z '
    + months[date.getUTCMonth()] + ' ' + String(date.getUTCFullYear()).slice(-2);
}

// Decimal degrees → fixed-width DD.dddd H  (H = N/S/E/W)
export function fmtLatLon(lat, lon) {
  function one(v, pos, neg) {
    return Math.abs(v).toFixed(4) + (v >= 0 ? pos : neg);
  }
  return one(lat, 'N', 'S') + ' ' + one(lon, 'E', 'W');
}

// A saved shot → the comm-card text block.
export function formatCommCard(shot) {
  var L = [];
  function row(label, value) {
    if (value === null || value === undefined || value === '') return;
    L.push((label.padEnd(9) + value).replace(/\s+$/, ''));
  }

  L.push('HF ANTENNA PLAN  ' + (shot.dtg || ''));
  L.push('='.repeat(46));
  // Saved shots outlive the app version that wrote them: loadShots() will
  // return anything that parsed as an array, so a plan saved before a field
  // existed used to make EXPORT throw and the operator lost the card with
  // nothing on screen to say why. Every field is now optional to PRINT; a
  // missing one prints as unknown rather than taking the card down with it.
  function num(v, digits, suffix) {
    return (typeof v === 'number' && isFinite(v))
      ? v.toFixed(digits) + (suffix || '') : '--';
  }
  row('FROM', shot.p1 ? fmtLatLon(shot.p1.lat, shot.p1.lon) : '--');
  row('TO', shot.p2 ? fmtLatLon(shot.p2.lat, shot.p2.lon) : '--');
  row('DIST', num(shot.distKm, 1, ' km') + ' / ' + num(shot.distMi, 1, ' mi'));
  row('BEARING', num(shot.bearing, 1, ' deg') + ' ' + (shot.cardinal || '') + '  (you -> target)');
  if (typeof shot.magBearing === 'number') {
    // The number to set on a lensatic compass — true bearing corrected for
    // local magnetic declination.
    row('SET MAG', shot.magBearing.toFixed(0) + ' deg on compass'
      + (typeof shot.declination === 'number'
        ? '  (var ' + Math.abs(shot.declination).toFixed(1) + ' ' + (shot.declination >= 0 ? 'E' : 'W') + ')'
        : ''));
  }
  if (typeof shot.backBearing === 'number') {
    row('BACK AZ', shot.backBearing.toFixed(1) + ' deg ' + (shot.backCardinal || '') + '  (target -> you)');
  }
  row('FREQ', (shot.freqMHz != null ? shot.freqMHz : '--') + ' MHz');
  row('MODE', shot.zoneName || '');
  if (typeof shot.takeoffDeg === 'number') row('TAKEOFF', '~' + shot.takeoffDeg.toFixed(0) + ' deg');
  L.push('-'.repeat(46));
  row('WIRE', (shot.wireLabel || '') + '  VF ' + num(shot.vf, 3));
  if (shot.antenna) {
    var a = shot.antenna;
    row('ANTENNA', a.name);
    if (a.legFtIn) row('EACH LEG', a.legFtIn + '  (' + a.legM.toFixed(2) + ' m)');
    if (a.totalFtIn) row('TOTAL', a.totalFtIn + '  (' + a.totalM.toFixed(2) + ' m)');
    if (typeof a.apexFt === 'number') {
      row('APEX', a.apexFt.toFixed(0) + ' ft (' + a.apexM.toFixed(1) + ' m)'
        + (a.feasible === false ? '  [buildable max]' : ''));
    }
    if (typeof shot.legEndM === 'number') {
      row('LEG ENDS', (shot.legEndM / 0.0254).toFixed(1) + ' in above ground');
    }
  }
  if (shot.freqCheck) {
    L.push('-'.repeat(46));
    row('LUF/MUF', num(shot.freqCheck.luf, 1) + ' - ' + num(shot.freqCheck.muf, 1, ' MHz'));
    row('FOT', num(shot.freqCheck.fot, 1, ' MHz'));
    // The LUF moves with transmit power and the MUF moves with the month.
    // Quoting either without the setting that produced it hands the next
    // operator a number they cannot reproduce or check.
    if (typeof shot.freqCheck.txWatts === 'number') {
      row('POWER', shot.freqCheck.txWatts + ' W  (sets the LUF)');
    }
    if (typeof shot.freqCheck.month === 'number'
        && shot.freqCheck.month >= 1 && shot.freqCheck.month <= 12) {
      row('MONTH', MONTHS[shot.freqCheck.month - 1] + '  (sets the MUF)');
    }
    if (shot.freqCheck.verdictLabel) row('CHECK', shot.freqCheck.verdictLabel);
  }
  if (shot.note) {
    L.push('-'.repeat(46));
    row('NOTE', shot.note);
  }
  L.push('='.repeat(46));
  L.push('HFCALC v' + (shot.appVersion || '') + ' - HFCALC-AG-EZK-USMC-v1');
  return L.join('\n');
}

// Short one-line label for the saved-shots list.
export function shotLabel(shot) {
  return shot.freqMHz + ' MHz · ' + shot.distKm.toFixed(0) + ' km · '
    + (shot.antenna ? shot.antenna.name : 'no antenna');
}

// Filename-safe export name.
export function commCardFilename(shot) {
  var d = (shot.dtg || '').replace(/[^0-9A-Z]/gi, '');
  return 'HFPLAN_' + (d || 'SHOT') + '_' + shot.freqMHz + 'MHz.txt';
}
