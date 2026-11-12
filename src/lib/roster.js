// Who is using the app — an optional, one-time roster entry (v1.66).
//
// The author asked to see which MOSs and units actually use the app, and
// maybe names, while anyone can stay anonymous: on first open, four boxes —
// name, rank, unit, MOS — and a clear SKIP. Whatever the operator fills in
// goes, once, as one row to a Google Form the author owns; the rows land in
// the linked Google Sheet, where the author sees the table and the counts by
// unit and MOS. Same transport as the field reports (src/lib/autoReport.js):
// no backend, no account on the operator's side.
//
// THE LINE THIS DRAWS:
//   * Optional, asked once per device. SKIP sends nothing and is remembered.
//     Any box may be left empty; an all-empty entry is treated as SKIP.
//   * Only what was typed, plus which kind of app it is (website, iPhone,
//     Android app, Windows app), the app version and the date. No location,
//     no device identifier, nothing about the shots planned.
//   * Disclosed on screen before sending, in the About tab and the README.
//   * No signal: the entry waits on the device and goes when there is.
//   * Inert until the Form is configured below: no prompt at all.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { isInstalledApp } from './platform.js';

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
// To configure: create a Google Form with one short-answer question per name
// in ROSTER_FIELDS (in that order), link it to a Sheet, use "Get pre-filled
// link", and copy each entry.NNNN id into `fields`. formAction is the form's
// .../formResponse address.
// The author's form, set up 2026-11-12 with five questions: Name, Rank,
// Unit, MOS, Platform. (appVersion and firstOpened have no question, so they
// are simply not sent.)
export var ROSTER_CONFIG = {
  formAction: 'https://docs.google.com/forms/d/e/1FAIpQLSdF1Y1piEvC03deEz_1OTrZv2Yzy0H4GJJofiTDl2gV1Z2kJQ/formResponse',
  fields: {
    name: 'entry.1662943421',
    rank: 'entry.965611597',
    unit: 'entry.1490053423',
    mos: 'entry.1721362995',
    platform: 'entry.352488216',
  },
};

export var ROSTER_FIELDS = ['name', 'rank', 'unit', 'mos', 'platform', 'appVersion', 'firstOpened'];

// Ranks offered in the box (free text is allowed too). Grouped the way they
// are read; the box also takes anything typed.
export var RANKS = [
  'Pvt', 'PFC', 'LCpl', 'Cpl', 'Sgt', 'SSgt', 'GySgt', 'MSgt', '1stSgt', 'MGySgt', 'SgtMaj',
  'WO', 'CWO2', 'CWO3', 'CWO4', 'CWO5',
  '2ndLt', '1stLt', 'Capt', 'Maj', 'LtCol', 'Col',
  'Civilian', 'Other service',
];

export var ROSTER_KEY = 'hfcalc_roster_v1';
// Shape: { state: 'skipped' | 'pending' | 'sent', at: ISO, entry?: {...} }

export function getRosterConfig() {
  // The browser suite drives the feature against a stubbed same-origin
  // endpoint, armed by ?roster=test — the same device as ?autoreport=test.
  try {
    if (typeof window !== 'undefined' && window.location
        && new URLSearchParams(window.location.search).get('roster') === 'test') {
      var f = {};
      ROSTER_FIELDS.forEach(function(k, i) { f[k] = 'entry.' + (2000 + i); });
      return { formAction: window.location.origin + '/__roster-test', fields: f, test: true };
    }
    // The browser-test harness and dev servers never see the card (it would
    // sit over every test) and never post a row to the real Sheet — the same
    // guard as the install counter. The installed Android app is served from
    // localhost too, and does see it.
    if (typeof window !== 'undefined' && window.location) {
      var h = window.location.hostname;
      if (h === '127.0.0.1' || (h === 'localhost' && !isInstalledApp())) return { formAction: '', fields: {} };
    }
  } catch (e) { /* fall through */ }
  return ROSTER_CONFIG;
}

export function isRosterConfigured(cfg) {
  cfg = cfg || getRosterConfig();
  if (!cfg || typeof cfg.formAction !== 'string' || !cfg.fields || !Object.keys(cfg.fields).length) return false;
  if (cfg.test === true) return cfg.formAction.indexOf('http') === 0;
  return cfg.formAction.indexOf('https://') === 0;
}

export function loadRoster() {
  try {
    var v = JSON.parse(localStorage.getItem(ROSTER_KEY) || 'null');
    return (v && typeof v === 'object' && /^(skipped|pending|sent)$/.test(v.state)) ? v : null;
  } catch (e) { return null; }
}
function saveRoster(v) {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(v)); return true; } catch (e) { return false; }
}

// Trim, cap the length, and drop anything that is not plain text.
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// The four boxes, cleaned. MOS is upper-cased (0621, 2621, 0602…).
export function cleanEntry(input) {
  input = input || {};
  return {
    name: clean(input.name, 60),
    rank: clean(input.rank, 20),
    unit: clean(input.unit, 80),
    mos: clean(input.mos, 12).toUpperCase(),
  };
}

export function isEmptyEntry(e) {
  e = cleanEntry(e);
  return !e.name && !e.rank && !e.unit && !e.mos;
}

// The row as it will be posted: Form entry ids -> values, only for fields the
// Form knows. `meta` is { platform, appVersion, firstOpened }.
export function encodeRoster(entry, meta, cfg) {
  cfg = cfg || getRosterConfig();
  var row = Object.assign({}, cleanEntry(entry), {
    platform: clean(meta && meta.platform, 20),
    appVersion: clean(meta && meta.appVersion, 20),
    firstOpened: clean(meta && meta.firstOpened, 30),
  });
  var body = new URLSearchParams();
  ROSTER_FIELDS.forEach(function(k) { if (cfg.fields[k]) body.append(cfg.fields[k], row[k]); });
  return body;
}

// Resolves true on a network-level success (opaque response), false on a
// network failure. Never throws. (no-cors: a row Google refused looks, from
// here, like one that landed — the Sheet is the ground truth.)
export function submitRoster(entry, meta, cfg) {
  cfg = cfg || getRosterConfig();
  if (!isRosterConfigured(cfg)) return Promise.resolve(false);
  try {
    return fetch(cfg.formAction, {
      method: 'POST', mode: 'no-cors', cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeRoster(entry, meta, cfg).toString(),
    }).then(function() { return true; }, function() { return false; });
  } catch (e) { return Promise.resolve(false); }
}

// SKIP: remembered, nothing sent.
export function skipRoster(now) {
  return saveRoster({ state: 'skipped', at: (now || new Date()).toISOString() });
}

// SEND: stored as pending first (so no signal loses nothing), then sent.
// Resolves the state it ended in: 'sent' | 'pending' | 'skipped'.
export function sendRoster(input, meta, now, cfg) {
  if (isEmptyEntry(input)) { skipRoster(now); return Promise.resolve('skipped'); }
  var rec = { state: 'pending', at: (now || new Date()).toISOString(), entry: cleanEntry(input), meta: meta || {} };
  saveRoster(rec);
  return flushRoster(cfg);
}

// Deliver a pending entry if there is one. Resolves the resulting state, or
// null when there is nothing on record.
export function flushRoster(cfg) {
  var rec = loadRoster();
  if (!rec) return Promise.resolve(null);
  if (rec.state !== 'pending') return Promise.resolve(rec.state);
  return submitRoster(rec.entry, rec.meta, cfg).then(function(ok) {
    if (!ok) return 'pending';
    saveRoster({ state: 'sent', at: new Date().toISOString(), entry: rec.entry });
    return 'sent';
  });
}

// Should the first-open card show? Only when the Form is live and this device
// has never answered (sent, pending or skipped).
export function shouldAskRoster(cfg) {
  return isRosterConfigured(cfg) && !loadRoster();
}
