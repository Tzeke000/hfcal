// Is this phone actually ready to work with no signal? (v1.59)
//
// The operator kept iPhone on the web app rather than paying for TestFlight,
// which makes this the question that matters on iPhone: since v1.58 the app
// stores ~36 MB offline, including every terrain chunk on Earth, and the
// browser's offline install is ALL OR NOTHING — if an older phone runs out of
// space partway through, the whole offline install fails, not just the
// terrain, and nobody finds out until they lose signal in the field. So the
// app checks, and says so in words before it matters.
//
// Pure decision function plus a reader for the live browser state; the card
// lives in src/ui/OfflineStatus.jsx.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

// s: { supported, active, installing, failed, cached, total }
//   supported   the browser can install the app offline at all
//   active      a service worker is active for this page
//   installing  a worker is installing right now (the world is downloading)
//   failed      the last install attempt was rejected (storage full, etc.)
//   cached      terrain chunks found in the offline cache
//   total       terrain chunks the app ships
// Returns { state, cached, total } with state one of:
//   'unsupported' | 'installing' | 'failed' | 'incomplete' | 'ready'
export function offlineState(s) {
  s = s || {};
  var cached = s.cached || 0, total = s.total || 0;
  var out = function(state) { return { state: state, cached: cached, total: total }; };
  if (!s.supported) return out('unsupported');
  if (s.failed) return out('failed');
  if (s.installing) return out('installing');
  if (!s.active) return out('incomplete');
  // An older version can be active with an older, smaller cache — a phone
  // that has not taken the update yet has the Americas but not the world.
  if (total > 0 && cached < total) return out('incomplete');
  return out('ready');
}

var CHUNK_RE = /\/terrain\/(?:americas|world)\/[A-Z0-9]+\.bin/;

// Count terrain chunks in every cache this origin holds. Never throws;
// resolves 0 when caches are unavailable.
export function countCachedChunks() {
  try {
    if (typeof caches === 'undefined') return Promise.resolve(0);
    return caches.keys().then(function(names) {
      return Promise.all(names.map(function(n) {
        return caches.open(n).then(function(c) { return c.keys(); });
      }));
    }).then(function(lists) {
      var seen = {};
      lists.forEach(function(reqs) {
        reqs.forEach(function(r) {
          var m = String(r.url).match(CHUNK_RE);
          if (m) seen[m[0]] = true;
        });
      });
      return Object.keys(seen).length;
    }).catch(function() { return 0; });
  } catch (e) { return Promise.resolve(0); }
}

// Read the live state of the browser. `failed` is remembered by the caller
// from a worker that went 'redundant' while installing.
export function readOfflineState(total, failed) {
  var supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof caches !== 'undefined';
  if (!supported) return Promise.resolve(offlineState({ supported: false, total: total }));
  return navigator.serviceWorker.getRegistration().then(function(reg) {
    return countCachedChunks().then(function(cached) {
      return offlineState({
        supported: true,
        active: !!(reg && reg.active),
        installing: !!(reg && reg.installing),
        failed: !!failed,
        cached: cached,
        total: total,
      });
    });
  }).catch(function() {
    return offlineState({ supported: true, failed: !!failed, total: total });
  });
}
