// When each app version first opened on THIS device (v1.61), for WHAT'S NEW.
// A small map { "1.61.0": "2026-10-08T14:03:00.000Z", ... } in local storage.
// Recorded once per version, never overwritten, capped so it cannot grow
// without bound. Nothing here leaves the device.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

export var VERSIONS_SEEN_KEY = 'hfcalc_versions_seen_v1';
var MAX = 40;

export function loadVersionsSeen() {
  try {
    var o = JSON.parse(localStorage.getItem(VERSIONS_SEEN_KEY) || '{}');
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    var out = {};
    Object.keys(o).forEach(function(k) { if (typeof o[k] === 'string') out[k] = o[k]; });
    return out;
  } catch (e) { return {}; }
}

// Record the running version's first-seen time if it is not already there.
export function recordVersionSeen(version, now) {
  try {
    var m = loadVersionsSeen();
    if (m[version]) return false;
    m[version] = (now || new Date()).toISOString();
    var keys = Object.keys(m).sort(function(a, b) { return m[a] < m[b] ? -1 : 1; });
    while (keys.length > MAX) delete m[keys.shift()];
    localStorage.setItem(VERSIONS_SEEN_KEY, JSON.stringify(m));
    return true;
  } catch (e) { return false; }
}
