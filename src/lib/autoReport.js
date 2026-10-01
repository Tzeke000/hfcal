// Automatic field reports — the truth log, as rows in a spreadsheet.
//
// The operator's question that produced this: "why do they have to send it
// to an email address? It can't get sent to a spreadsheet, then you or I look
// at it and graph where the app needs to be better. We don't need to know who
// it's from, just what the problem was."
//
// Exactly right. Email made a human the transport, and a human with a card
// and no address in their hand is a card that never arrives. This instead
// POSTs each logged shot to a Google Form the author owns; responses land in
// the linked Sheet, where they can be charted — and read back by the author
// directly. No account on the operator's side, no address to remember,
// nothing identifying in the row.
//
// THE LINE THIS DRAWS, stated once here and again on screen:
//
//   * It is OPT-IN, once per device. Nothing leaves until the operator says
//     yes, and NEVER is remembered.
//   * NO GRIDS GO by default. "Who" and "where" are different things — a
//     rounded grid still says where a unit was operating. What goes instead
//     is distance, bearing and the midpoint's geomagnetic-latitude band
//     (5-degree steps), which is what the model's latitude dependence needs
//     and is not a place. The operator can turn grids on; the app will not.
//   * It is disclosed. The network-footprint statement on the About screen
//     and in the README names this fetch, because the app enumerates what it
//     sends rather than claiming it sends nothing.
//   * Offline shots queue on the device and go when signal returns — the
//     same hold-don't-lose pattern as the space-weather cache.
//
// Transport note: the Form endpoint is hit with mode:'no-cors', so the
// response is opaque and a server-side rejection cannot be seen — only a
// network failure can. That is the accepted trade for needing no backend:
// a row that Google refused looks, from here, like a row that landed. The
// Sheet is the ground truth of what arrived, not this code.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { magneticLatitude } from '../physics/magnetic.js';

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
// Filled in once the Google Form exists. Until formAction is set the whole
// feature is inert: no prompt, no fetch, no disclosure. To configure: create
// the Form with one short-answer question per name in AUTO_REPORT_FIELDS,
// use "Get pre-filled link", and copy each entry.NNNN id into `fields`.
export var AUTO_REPORT_CONFIG = {
  formAction: '',          // https://docs.google.com/forms/d/e/<ID>/formResponse
  fields: {},              // { dtg: 'entry.123456', outcome: 'entry.234567', ... }
};

// The columns, in the order the Sheet should carry them. Keep this list and
// the Form in step; a field missing from `fields` is simply not sent.
export var AUTO_REPORT_FIELDS = [
  'dtg', 'outcome', 'cause',
  'freqMHz', 'distKm', 'bearingDeg', 'midGeomagBand',
  'muf', 'fot', 'luf', 'verdict',
  'txWatts', 'month', 'utcHour', 'sfi', 'kp', 'auroralDb30',
  'antenna', 'takeoffDeg', 'apexFt', 'wire', 'mode',
  'fromGrid', 'toGrid', 'gridPrecision',
  'appVersion',
];

export function getAutoReportConfig() {
  // The browser suite drives the feature against a stubbed same-origin
  // endpoint, armed by a URL flag — the same device as the install beacon's
  // ?beacontest. A real deployment never carries the flag.
  try {
    if (typeof window !== 'undefined' && window.location
        && new URLSearchParams(window.location.search).get('autoreport') === 'test') {
      var f = {};
      AUTO_REPORT_FIELDS.forEach(function(k, i) { f[k] = 'entry.' + (1000 + i); });
      return { formAction: window.location.origin + '/__autoreport-test', fields: f, test: true };
    }
  } catch (e) { /* fall through */ }
  return AUTO_REPORT_CONFIG;
}

export function isAutoReportConfigured(cfg) {
  cfg = cfg || getAutoReportConfig();
  if (!cfg || typeof cfg.formAction !== 'string' || !cfg.fields || !Object.keys(cfg.fields).length) return false;
  // Production must be https — operator data over plain http is not on. The
  // browser suite's same-origin stub is http and is let through ONLY by the
  // marker getAutoReportConfig sets from the ?autoreport=test flag.
  if (cfg.test === true) return cfg.formAction.indexOf('http') === 0;
  return cfg.formAction.indexOf('https://') === 0;
}

// ── PAYLOAD ───────────────────────────────────────────────────────────────────
// Great-circle midpoint, for the latitude band. Not the arithmetic mean of
// the endpoints — on a long path those differ by hundreds of km.
function midpoint(a, b) {
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var la1 = a.lat * D2R, lo1 = a.lon * D2R, la2 = b.lat * D2R, lo2 = b.lon * D2R;
  var bx = Math.cos(la2) * Math.cos(lo2 - lo1);
  var by = Math.cos(la2) * Math.sin(lo2 - lo1);
  var lat = Math.atan2(Math.sin(la1) + Math.sin(la2),
    Math.sqrt((Math.cos(la1) + bx) * (Math.cos(la1) + bx) + by * by));
  var lon = lo1 + Math.atan2(by, Math.cos(la1) + bx);
  return { lat: lat * R2D, lon: ((lon * R2D + 540) % 360) - 180 };
}

function num(v, dp) {
  if (typeof v !== 'number' || !isFinite(v)) return '';
  return dp == null ? String(v) : v.toFixed(dp);
}

// The row. `grids` is 'none' (default) | 'degree' | 'exact'. Everything the
// model needs to be scored and re-derived goes; the place does not, unless
// the operator chose otherwise.
export function buildAutoReport(entry, opts) {
  opts = opts || {};
  var grids = opts.grids || 'none';
  var p = (entry && entry.predicted) || {};
  var s = (entry && entry.setup) || {};
  var row = {
    dtg: (entry && entry.dtg) || '',
    outcome: entry && entry.outcome === 'worked' ? 'worked' : 'failed',
    cause: (entry && entry.outcome !== 'worked' && entry.note) ? String(entry.note).slice(0, 200) : '',
    freqMHz: num(entry && entry.freqMHz),
    distKm: num(entry && entry.distKm, 0),
    bearingDeg: num(s.bearingDeg, 0),
    midGeomagBand: '',
    muf: num(p.muf, 1), fot: num(p.fot, 1), luf: num(p.luf, 1),
    verdict: p.verdict || '',
    txWatts: num(p.txWatts), month: num(p.month), utcHour: num(p.utcHour, 1),
    sfi: num(p.sfi, 0), kp: num(p.kp, 1), auroralDb30: num(p.auroralDb30, 2),
    antenna: s.antenna || '', takeoffDeg: num(s.takeoffDeg, 0), apexFt: num(s.apexFt, 0),
    wire: s.wire || '', mode: s.mode || '',
    fromGrid: '', toGrid: '', gridPrecision: grids,
    appVersion: (entry && entry.appVersion) || '',
  };
  if (entry && entry.from && entry.to
      && typeof entry.from.lat === 'number' && typeof entry.to.lat === 'number') {
    var m = midpoint(entry.from, entry.to);
    var gm = magneticLatitude(m.lat, m.lon);
    if (typeof gm === 'number' && isFinite(gm)) {
      // 5-degree band, signed. 57.7 -> 55, -12.1 -> -10. A region, not a spot.
      row.midGeomagBand = String(Math.round(gm / 5) * 5);
    }
    if (grids === 'exact') {
      row.fromGrid = entry.from.lat.toFixed(4) + ',' + entry.from.lon.toFixed(4);
      row.toGrid = entry.to.lat.toFixed(4) + ',' + entry.to.lon.toFixed(4);
    } else if (grids === 'degree') {
      row.fromGrid = Math.round(entry.from.lat) + ',' + Math.round(entry.from.lon);
      row.toGrid = Math.round(entry.to.lat) + ',' + Math.round(entry.to.lon);
    }
  }
  return row;
}

// The row as it will actually be posted: Form entry ids -> values, only for
// fields the Form knows. Exposed so the UI can show the operator exactly
// what left the device.
export function encodeAutoReport(row, cfg) {
  cfg = cfg || getAutoReportConfig();
  var body = new URLSearchParams();
  AUTO_REPORT_FIELDS.forEach(function(k) {
    if (cfg.fields[k] && row[k] !== undefined) body.append(cfg.fields[k], String(row[k]));
  });
  return body;
}

// ── TRANSPORT ─────────────────────────────────────────────────────────────────
// Resolves true on a network-level success (opaque response), false on a
// network failure. Never throws.
export function submitAutoReport(row, cfg) {
  cfg = cfg || getAutoReportConfig();
  if (!isAutoReportConfigured(cfg)) return Promise.resolve(false);
  var body = encodeAutoReport(row, cfg);
  try {
    return fetch(cfg.formAction, {
      method: 'POST', mode: 'no-cors', cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }).then(function() { return true; }, function() { return false; });
  } catch (e) { return Promise.resolve(false); }
}

// ── QUEUE ─────────────────────────────────────────────────────────────────────
// Which entry ids have been delivered. Entries themselves live in the truth
// log store; this is only the ledger, so a shot logged with no signal is
// re-sent later, and a delivered one is never sent twice.
export var AUTO_SENT_KEY = 'hfcalc_truth_auto_sent_v1';
export function loadAutoSent() {
  try {
    var a = JSON.parse(localStorage.getItem(AUTO_SENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter(function(x) { return typeof x === 'string'; }) : [];
  } catch (e) { return []; }
}
export function markAutoSent(id) {
  try {
    var have = loadAutoSent();
    if (have.indexOf(id) === -1) localStorage.setItem(AUTO_SENT_KEY, JSON.stringify(have.concat(id).slice(-500)));
  } catch (e) { /* ignore */ }
}

// Send everything not yet delivered, one row per entry, in order logged.
// Stops at the first network failure (we are offline; the rest can wait).
// Resolves { sent, failed }.
export function flushAutoReports(entries, opts) {
  opts = opts || {};
  var cfg = opts.cfg || getAutoReportConfig();
  var sent = loadAutoSent();
  var todo = (entries || []).filter(function(e) { return e && e.id && sent.indexOf(e.id) === -1; })
    .slice().reverse();   // entries are newest-first; deliver oldest-first
  var done = 0;
  function next() {
    if (!todo.length) return Promise.resolve({ sent: done, failed: 0 });
    var e = todo.shift();
    return submitAutoReport(buildAutoReport(e, { grids: opts.grids }), cfg).then(function(ok) {
      if (!ok) return { sent: done, failed: todo.length + 1 };
      markAutoSent(e.id); done += 1;
      return next();
    });
  }
  return next();
}
