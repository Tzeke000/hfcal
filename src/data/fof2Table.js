// ── foF2 LOOKUP TABLE ─────────────────────────────────────────────────────────
// Our own table, generated from our own script, against a named engine.
//
// The coefficient map in fof2Map.js reached 7.4% and stopped improving, because
// a smooth basis forces one global shape onto an ionosphere that has genuine
// local structure — every extra coefficient buys less than the one before. A
// table has no such ceiling: it stores what the ionosphere actually does at each
// node and interpolates between, so accuracy is set by grid spacing, which is
// something we control.
//
// PROVENANCE, deliberately. Nothing here is copied out of anyone else's data
// set. Every value was produced by scripts/validation/build/build_fof2_table.py from
// VOACAP 16.1207W, and can be regenerated and re-checked by anyone with the
// repository. The physical model in freqAdvisor.js is retained in full and is
// still what keeps the table honest — see bounceFoF2.
//
// Layout, C-order: [latitude][longitude][month][UTC hour][solar activity]
// stored as uint8 at 0.1 MHz per count, so a byte covers 0–25.5 MHz. That costs
// 0.05 MHz of quantisation on a typical 8 MHz value, about 0.6%, comfortably
// under the accuracy being chased.
//
// LOADING. The table is a precached asset rather than inlined JavaScript, so it
// costs nothing to parse and is available offline through the service worker.
// Until it has loaded, every caller falls back to the coefficient map and then
// to the physical model, so the app is fully functional the moment it starts —
// the table only ever makes it more accurate, never less available.
//
// This module is part of the original work of Cpl Angeles-Gonzalez,
// Ezekiel S., USMC. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_URL = 'fof2-table.bin';
export const TABLE_SCALE = 0.1;          // MHz per count

// Filled in from the header the generator writes.
var TAB = null;
var META = null;

// Header: magic 'HFT1', then uint16 nLat,nLon,nMonth,nHour,nSsn,
// int16 lat0*10, latStep*10, lon0*10, lonStep*10, then nSsn uint16 ssn values.
export function parseFoF2Table(buffer) {
  var dv = new DataView(buffer);
  if (dv.getUint8(0) !== 0x48 || dv.getUint8(1) !== 0x46
      || dv.getUint8(2) !== 0x54 || dv.getUint8(3) !== 0x31) return null;
  var o = 4;
  var nLat = dv.getUint16(o, true); o += 2;
  var nLon = dv.getUint16(o, true); o += 2;
  var nMon = dv.getUint16(o, true); o += 2;
  var nHour = dv.getUint16(o, true); o += 2;
  var nSsn = dv.getUint16(o, true); o += 2;
  var lat0 = dv.getInt16(o, true) / 10; o += 2;
  var latStep = dv.getInt16(o, true) / 10; o += 2;
  var lon0 = dv.getInt16(o, true) / 10; o += 2;
  var lonStep = dv.getInt16(o, true) / 10; o += 2;
  var ssns = [];
  for (var i = 0; i < nSsn; i++) { ssns.push(dv.getUint16(o, true)); o += 2; }
  var need = nLat * nLon * nMon * nHour * nSsn;
  if (buffer.byteLength - o !== need) return null;
  return {
    meta: { nLat: nLat, nLon: nLon, nMon: nMon, nHour: nHour, nSsn: nSsn,
            lat0: lat0, latStep: latStep, lon0: lon0, lonStep: lonStep, ssns: ssns },
    data: new Uint8Array(buffer, o, need),
  };
}

export function installFoF2Table(parsed) {
  if (!parsed || !parsed.data || !parsed.meta) return false;
  TAB = parsed.data; META = parsed.meta;
  return true;
}

export function foF2TableReady() { return TAB !== null; }
export function foF2TableMeta() { return META; }

// Fetch and install. Safe to call more than once; failure is not an error, it
// just means callers keep using the model.
export function loadFoF2Table(base) {
  if (TAB) return Promise.resolve(true);
  var url = (base || '') + TABLE_URL;
  return fetch(url)
    .then(function(r) { return r.ok ? r.arrayBuffer() : null; })
    .then(function(buf) { return buf ? installFoF2Table(parseFoF2Table(buf)) : false; })
    .catch(function() { return false; });
}

function at(ia, ib, ic, id, ie) {
  var m = META;
  return TAB[(((ia * m.nLon + ib) * m.nMon + ic) * m.nHour + id) * m.nSsn + ie] * TABLE_SCALE;
}

// foF2 in MHz by 5-D linear interpolation, or null when the table is not
// loaded. Longitude, month and hour wrap; latitude and solar activity clamp.
export function tableFoF2(latDeg, lonDeg, month, utcHour, ssn) {
  if (!TAB) return null;
  if (typeof latDeg !== 'number' || !isFinite(latDeg)) return null;
  if (typeof lonDeg !== 'number' || !isFinite(lonDeg)) return null;
  // The month axis wraps, so the domain is the continuous year [1, 13): a
  // month of 12.5 interpolates across the December/January seam. Rejecting
  // anything above 12 made that seam unreachable even though the
  // interpolation below handles it.
  if (typeof month !== 'number' || !isFinite(month) || month < 1 || month >= 13) return null;
  if (typeof utcHour !== 'number' || !isFinite(utcHour)) return null;
  var m = META;

  var fa = (latDeg - m.lat0) / m.latStep;
  if (fa < 0) fa = 0; else if (fa > m.nLat - 1) fa = m.nLat - 1;
  var ia = Math.floor(fa); var wa = fa - ia; var ia2 = Math.min(ia + 1, m.nLat - 1);

  var fb = ((lonDeg - m.lon0) / m.lonStep) % m.nLon;
  if (fb < 0) fb += m.nLon;
  var ib = Math.floor(fb); var wb = fb - ib; var ib2 = (ib + 1) % m.nLon;

  var fc = (month - 1) % m.nMon;
  var ic = Math.floor(fc); var wc = fc - ic; var ic2 = (ic + 1) % m.nMon;

  var fd = utcHour % m.nHour;
  if (fd < 0) fd += m.nHour;
  var id = Math.floor(fd); var wd = fd - id; var id2 = (id + 1) % m.nHour;

  var s = ssn;
  if (typeof s !== 'number' || !isFinite(s)) s = m.ssns[Math.floor(m.nSsn / 2)];
  if (s < m.ssns[0]) s = m.ssns[0];
  if (s > m.ssns[m.nSsn - 1]) s = m.ssns[m.nSsn - 1];
  var ie = 0;
  while (ie < m.nSsn - 2 && s > m.ssns[ie + 1]) ie++;
  var span = m.ssns[ie + 1] - m.ssns[ie];
  var we = span > 0 ? (s - m.ssns[ie]) / span : 0;

  var v = 0;
  var lats = [ia, ia2], latw = [1 - wa, wa];
  var lons = [ib, ib2], lonw = [1 - wb, wb];
  var mons = [ic, ic2], monw = [1 - wc, wc];
  var hrs = [id, id2], hrw = [1 - wd, wd];
  var sss = [ie, ie + 1], ssw = [1 - we, we];
  for (var A = 0; A < 2; A++) {
    if (latw[A] === 0) continue;
    for (var B = 0; B < 2; B++) {
      if (lonw[B] === 0) continue;
      for (var C = 0; C < 2; C++) {
        if (monw[C] === 0) continue;
        for (var D = 0; D < 2; D++) {
          if (hrw[D] === 0) continue;
          for (var E = 0; E < 2; E++) {
            if (ssw[E] === 0) continue;
            v += latw[A] * lonw[B] * monw[C] * hrw[D] * ssw[E]
               * at(lats[A], lons[B], mons[C], hrs[D], sss[E]);
          }
        }
      }
    }
  }
  return v > 0 ? v : null;
}
