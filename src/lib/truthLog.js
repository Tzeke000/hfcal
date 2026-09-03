// Field truth log — prediction vs. reality, accumulated on the device.
//
// After a shot the operator taps one of two buttons: it CLOSED (worked) or it
// DIDN'T. Each tap records what the app PREDICTED alongside what actually
// happened, so over time the device holds a real validation set from real
// paths — the one thing a VOACAP study can never give, because VOACAP is
// itself a model. Exported as a plain-text card the operator can hand back for
// the model to be measured and tuned against ground truth.
//
// Pure functions + storage helpers only; the UI lives in src/ui/. Storage and
// formatting are deliberately tolerant of missing fields — an entry logged by
// an older app version must never crash the list or the export (the lesson of
// the saved-shots white-screen, VALIDATION Part 33).
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { dtg, fmtLatLon } from './commCard.js';

export const TRUTH_KEY = 'hfcalc_truth_v1';
export const TRUTH_MAX = 200;   // plenty of field history; ~200 entries is tiny

// Date.now() alone collides for two taps in one millisecond; the same id
// collision that once deleted two saved shots at once (Part 30).
var _seq = 0;
export function newTruthId() {
  _seq += 1;
  return 'truth_' + Date.now() + '_' + _seq;
}

// Build a record from the current plan + the operator's outcome.
//   shot     the currentShot object (same shape SavedShots/commCard use)
//   outcome  'worked' | 'failed'
//   note     optional free-text (antenna, terrain, interference, anything)
//   when     Date (injectable for tests)
export function makeTruthEntry(shot, outcome, note, when) {
  shot = shot || {};
  var fc = shot.freqCheck || {};
  var d = when || new Date();
  return {
    id: newTruthId(),
    dtg: dtg(d),
    outcome: outcome === 'worked' ? 'worked' : 'failed',
    note: (typeof note === 'string' && note.trim()) ? note.trim().slice(0, 200) : null,
    from: shot.p1 ? { lat: shot.p1.lat, lon: shot.p1.lon } : null,
    to: shot.p2 ? { lat: shot.p2.lat, lon: shot.p2.lon } : null,
    distKm: (typeof shot.distKm === 'number') ? shot.distKm : null,
    freqMHz: (shot.freqMHz != null) ? shot.freqMHz : null,
    // THE SETUP THE OPERATOR ACTUALLY BUILT. Without this a failed shot is
    // unattributable: "7.3 MHz didn't close" could be the model being wrong,
    // or a longwire pointed 40° off, or an NVIS dipole strung for a 3,000 km
    // path. The prediction alone cannot tell those apart, and they need
    // different fixes.
    setup: {
      bearingDeg: numOrNull(shot.bearing),
      magBearingDeg: numOrNull(shot.magBearing),
      antenna: (shot.antenna && shot.antenna.name) ? shot.antenna.name : null,
      antennaKey: (shot.antenna && shot.antenna.key) ? shot.antenna.key : null,
      takeoffDeg: numOrNull(shot.takeoffDeg),
      apexFt: (shot.antenna && numOrNull(shot.antenna.apexFt) !== null)
        ? shot.antenna.apexFt : null,
      wire: shot.wireLabel || null,
      mode: shot.zoneName || null,
    },
    // The prediction, so reality can be scored against it later.
    predicted: {
      muf: numOrNull(fc.muf), fot: numOrNull(fc.fot), luf: numOrNull(fc.luf),
      verdict: fc.verdictLabel || null,
      txWatts: numOrNull(fc.txWatts != null ? fc.txWatts : shot.txWatts),
      month: numOrNull(fc.month),
      utcHour: numOrNull(fc.utcHour),
      // The space weather the prediction was made UNDER. Without these an
      // entry cannot be re-derived later: the same path and hour give a
      // different MUF at SFI 70 than at SFI 200, and the auroral term is
      // driven entirely by Kp. A returned card missing them is an anecdote;
      // with them it is a reproducible data point.
      sfi: numOrNull(fc.sfi),
      kp: numOrNull(fc.kp),
      auroralDb30: numOrNull(fc.auroralDb30),
    },
    appVersion: shot.appVersion || null,
  };
}

// ── SENDING A CARD BACK ──────────────────────────────────────────────────────
// The operator can hand the log back so the model gets measured against real
// paths — the one thing a VOACAP study cannot provide, because VOACAP is
// itself a model.
//
// COORDINATES ARE THE WHOLE PROBLEM. A truth entry records where a Marine was
// and what they were shooting at, and this app's first promise is that
// position never leaves the device. So the default precision is WHOLE DEGREES:
//
//   - it costs the science NOTHING. The foF2 map and the land/sea mask this
//     app validates against are themselves 1-degree grids, so a rounded
//     coordinate lands in the same cell the model used.
//   - it costs an adversary almost everything: a degree is ~60 nautical miles
//     of ambiguity, which is a region, not a position report.
//
// 'exact' exists for training, ham use, and anyone who simply does not care —
// but the operator has to choose it, on screen, having been told.
export function redactEntry(e, precision) {
  if (!e || typeof e !== 'object') return e;
  var out = JSON.parse(JSON.stringify(e));
  if (precision === 'exact') return out;
  out.from = coarsen(out.from);
  out.to = coarsen(out.to);
  out.coordPrecision = 'degree';
  return out;
}

function coarsen(p) {
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return p;
  return { lat: Math.round(p.lat), lon: Math.round(p.lon) };
}

// The plain-text card the operator sends back, plus a subject line. Built from
// redacted copies so nothing here can carry a precise grid unless the operator
// asked for that.
export function buildSubmission(entries, appVersion, precision) {
  var list = (Array.isArray(entries) ? entries : []).map(function(e) {
    return redactEntry(e, precision);
  });
  var scored = list.map(scoreEntry);
  var hits = scored.filter(function(s) { return s === 'hit'; }).length;
  var misses = scored.filter(function(s) { return s === 'miss'; }).length;
  var subject = 'HFCALC field truth log — ' + list.length + ' shot'
    + (list.length === 1 ? '' : 's')
    + (hits + misses > 0 ? ' (' + hits + ' hit / ' + misses + ' miss)' : '')
    + (appVersion ? ' — v' + appVersion : '');
  var head = [
    'Field truth log from an HFCALC user.',
    precision === 'exact'
      ? 'Coordinates: EXACT, sent deliberately by the operator.'
      : 'Coordinates: rounded to whole degrees by the app (~60 NM), which is the'
        + ' resolution the model itself works at.',
    '',
  ].join('\n');
  return { subject: subject, body: head + formatTruthReport(list, appVersion) };
}

function numOrNull(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

export function loadTruth() {
  try {
    var raw = localStorage.getItem(TRUTH_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(function(e) { return e && typeof e === 'object'; }) : [];
  } catch (e) { return []; }
}

export function persistTruth(list) {
  try {
    localStorage.setItem(TRUTH_KEY, JSON.stringify(list.slice(0, TRUTH_MAX)));
    return true;
  } catch (e) { return false; }
}

// Did the prediction match reality? The app says a path is workable when the
// operator's frequency sits between LUF and MUF (verdict.ok). We do not store
// the boolean verdict.ok on the entry, so infer agreement from the label:
// an "ABOVE MUF"/"BELOW LUF"/CLOSED prediction that then WORKED is a miss the
// other way, and a GOOD/USABLE prediction that FAILED is a miss. Anything else
// agrees. Returns 'hit' | 'miss' | 'unknown'.
export function scoreEntry(e) {
  if (!e || !e.predicted || !e.predicted.verdict) return 'unknown';
  var predictedWorkable = !/ABOVE MUF|BELOW LUF|CLOSED/i.test(e.predicted.verdict);
  var actuallyWorked = e.outcome === 'worked';
  return predictedWorkable === actuallyWorked ? 'hit' : 'miss';
}

// A plain-text report of the whole log, for the operator to hand back. Leads
// with a summary (n, hit rate) because that is the headline; then one line per
// entry, prediction beside outcome.
export function formatTruthReport(entries, appVersion) {
  entries = Array.isArray(entries) ? entries : [];
  var L = [];
  var W = 60;
  L.push('='.repeat(W));
  L.push('HFCALC FIELD TRUTH LOG');
  L.push('HFCALC-AG-EZK-USMC-v1' + (appVersion ? '  ·  app v' + appVersion : ''));
  L.push('='.repeat(W));

  var scored = entries.map(scoreEntry);
  var hits = scored.filter(function(s) { return s === 'hit'; }).length;
  var misses = scored.filter(function(s) { return s === 'miss'; }).length;
  var worked = entries.filter(function(e) { return e.outcome === 'worked'; }).length;
  L.push('ENTRIES: ' + entries.length
    + '   WORKED: ' + worked + '   DIDN’T: ' + (entries.length - worked));
  if (hits + misses > 0) {
    L.push('PREDICTION vs REALITY: ' + hits + ' hit / ' + misses + ' miss'
      + '  (' + Math.round(100 * hits / (hits + misses)) + '% agreement, '
      + (hits + misses) + ' scorable)');
  }
  L.push('Send this card back so the model can be measured against real paths.');
  L.push('='.repeat(W));

  entries.forEach(function(e, i) {
    var mark = e.outcome === 'worked' ? '[WORKED]' : '[DIDN’T]';
    var sc = scoreEntry(e);
    var scTag = sc === 'hit' ? ' (predicted)' : sc === 'miss' ? ' (SURPRISE)' : '';
    L.push('');
    L.push((i + 1) + '. ' + mark + scTag + '   ' + (e.dtg || ''));
    var from = e.from ? fmtLatLon(e.from.lat, e.from.lon) : '--';
    var to = e.to ? fmtLatLon(e.to.lat, e.to.lon) : '--';
    L.push('   ' + from + '  ->  ' + to
      + (typeof e.distKm === 'number' ? '   ' + e.distKm.toFixed(0) + ' km' : ''));
    var p = e.predicted || {};
    var freq = (e.freqMHz != null) ? e.freqMHz + ' MHz' : '?';
    var atwx = (p.txWatts != null ? p.txWatts + ' W' : '?')
      + (p.month != null ? '  mon ' + p.month : '')
      + (p.utcHour != null ? '  ' + String(Math.floor(((p.utcHour % 24) + 24) % 24)).padStart(2, '0') + 'Z' : '');
    L.push('   TRIED ' + freq + ' at ' + atwx);
    L.push('   APP SAID  LUF ' + fx(p.luf) + '  FOT ' + fx(p.fot) + '  MUF ' + fx(p.muf)
      + (p.verdict ? '  [' + p.verdict + ']' : ''));
    // The space weather behind those numbers — without it the entry cannot be
    // recomputed, and an entry that cannot be recomputed cannot correct the
    // model. Printed only when known, so older entries stay readable.
    if (p.sfi != null || p.kp != null) {
      L.push('   SPACE WX  ' + (p.sfi != null ? 'SFI ' + p.sfi.toFixed(0) : 'SFI --')
        + '  ' + (p.kp != null ? 'Kp ' + p.kp.toFixed(1) : 'Kp --')
        + (p.auroralDb30 ? '  (auroral ' + p.auroralDb30.toFixed(2) + ' dB @30MHz)' : ''));
    }
    // What was actually built and where it was pointed. A failed shot with no
    // setup recorded cannot be diagnosed.
    var s = e.setup || {};
    if (s.antenna || s.bearingDeg != null || s.wire || s.mode) {
      L.push('   BUILT     ' + (s.antenna || 'antenna not recorded')
        + (s.wire ? ' · ' + s.wire : '')
        + (s.apexFt != null ? ' · apex ' + s.apexFt.toFixed(0) + ' ft' : ''));
      L.push('   AIMED     ' + (s.bearingDeg != null ? s.bearingDeg.toFixed(0) + '° true' : 'bearing not recorded')
        + (s.magBearingDeg != null ? ' (' + s.magBearingDeg.toFixed(0) + '° mag)' : '')
        + (s.takeoffDeg != null ? ' · takeoff ' + s.takeoffDeg.toFixed(0) + '°' : '')
        + (s.mode ? ' · ' + s.mode : ''));
    }
    if (e.coordPrecision === 'degree') L.push('   GRIDS ROUNDED to whole degrees by the app');
    if (e.note) L.push((e.outcome === 'worked' ? '   NOTE: ' : '   WHY IT DIDN’T: ') + e.note);
  });

  L.push('');
  L.push('='.repeat(W));
  return L.join('\n');
}

function fx(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(1) : '--'; }

export function truthFilename(when) {
  var d = when || new Date();
  var stamp = dtg(d).replace(/[^0-9A-Z]/gi, '');
  return 'HFCALC_TRUTHLOG_' + (stamp || 'LOG') + '.txt';
}
