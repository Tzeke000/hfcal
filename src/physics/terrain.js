// Terrain lookup and great-circle path sampling.
//
// Pure functions with no React in them, split out of HFCalc.jsx in v1.26 so
// they can be unit-tested. They had never been under test: they were 230
// lines in the middle of a 4300-line component file.
//
// The terrain database is a coarse bounding-box model, not a DEM. It is good
// enough to answer "does this path cross ocean, desert or mountains" and is
// not good enough for anything finer; the adjustments it drives are stated as
// unmeasured heuristics in docs/VALIDATION.md.
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

// ══════════════════════════════════════════════════════════════════════════════
// EMBEDDED TERRAIN DATABASE
// All coordinates in decimal degrees (WGS-84).
// Each entry is a bounding box { latMin, latMax, lonMin, lonMax, type, name, elev? }
//   type: 'ocean' | 'lake' | 'mountain' | 'desert' | 'highland'
//   elev: approximate peak elevation in meters (mountains/highlands only)
// Points sampled along the great-circle path are classified using these boxes.
// When multiple boxes overlap, highest priority wins: mountain > lake > ocean > highland > desert
// ══════════════════════════════════════════════════════════════════════════════


import { isLand } from '../data/landMask.js';
export const TERRAIN_DB = [
  // ── OCEANS & MAJOR SEAS ────────────────────────────────────────────────────
  // Open NW/central Pacific east of Japan and the Philippine Sea to the
  // dateline — was defaulting to land, wrecking WESTPAC path physics.

  // ── MAJOR LAKES ───────────────────────────────────────────────────────────
  { t:'lake', n:'Lake Superior',         latMin: 46.4,latMax: 49.0,lonMin:-92.0, lonMax:-84.5 },
  { t:'lake', n:'Lake Michigan',         latMin: 41.6,latMax: 46.1,lonMin:-88.0, lonMax:-84.7 },
  { t:'lake', n:'Lake Huron',            latMin: 43.0,latMax: 46.2,lonMin:-84.7, lonMax:-79.5 },
  { t:'lake', n:'Lake Erie',             latMin: 41.4,latMax: 43.0,lonMin:-83.5, lonMax:-78.9 },
  { t:'lake', n:'Lake Ontario',          latMin: 43.2,latMax: 44.3,lonMin:-79.9, lonMax:-76.0 },
  { t:'lake', n:'Lake Victoria',         latMin: -3.0,latMax:  0.5,lonMin: 31.5, lonMax:  35.0},
  { t:'lake', n:'Lake Tanganyika',       latMin: -8.8,latMax: -3.5,lonMin: 28.8, lonMax:  31.2},
  { t:'lake', n:'Lake Malawi',           latMin:-14.5,latMax: -9.5,lonMin: 33.7, lonMax:  35.3},
  { t:'lake', n:'Lake Baikal',           latMin: 51.5,latMax: 55.8,lonMin:103.7, lonMax: 110.0},
  { t:'lake', n:'Aral Sea',             latMin: 43.0,latMax: 47.0,lonMin: 58.0, lonMax:  62.0},
  { t:'lake', n:'Lake Chad',             latMin: 12.0,latMax: 14.5,lonMin: 13.0, lonMax:  16.0},
  { t:'lake', n:'Lake Titicaca',         latMin:-16.5,latMax:-15.2,lonMin:-70.0, lonMax: -68.5},
  { t:'lake', n:'Great Bear Lake',       latMin: 64.5,latMax: 67.0,lonMin:-124,  lonMax:-118  },
  { t:'lake', n:'Great Slave Lake',      latMin: 60.8,latMax: 62.5,lonMin:-117,  lonMax:-109  },

  // ── MOUNTAIN RANGES ───────────────────────────────────────────────────────
  // elev = typical peak height in meters (used for propagation penalty)
  { t:'mountain', n:'Himalayas / Tibetan Plateau', latMin: 27, latMax: 38, lonMin:  73, lonMax:  97,  elev: 6500 },
  { t:'mountain', n:'Karakoram / Hindu Kush',      latMin: 33, latMax: 38, lonMin:  69, lonMax:  77,  elev: 7000 },
  { t:'mountain', n:'Pamir Knot',                  latMin: 36, latMax: 40, lonMin:  70, lonMax:  76,  elev: 5500 },
  { t:'mountain', n:'Alps',                         latMin: 44, latMax: 48, lonMin:   6, lonMax:  15,  elev: 3800 },
  { t:'mountain', n:'Pyrenees',                     latMin: 42, latMax: 43.5,lonMin: -2, lonMax:   3,  elev: 3400 },
  { t:'mountain', n:'Caucasus',                     latMin: 41, latMax: 44, lonMin:  39, lonMax:  49,  elev: 4500 },
  { t:'mountain', n:'Andes (Colombia–Venezuela)',   latMin:  4, latMax: 12, lonMin: -75, lonMax: -65,  elev: 4500 },
  { t:'mountain', n:'Andes (Ecuador–Peru)',         latMin:-14, latMax:  4, lonMin: -81, lonMax: -74,  elev: 5500 },
  { t:'mountain', n:'Andes (Bolivia–Chile)',        latMin:-34, latMax:-14, lonMin: -72, lonMax: -65,  elev: 6500 },
  { t:'mountain', n:'Andes (Patagonia)',            latMin:-56, latMax:-34, lonMin: -73, lonMax: -68,  elev: 3800 },
  { t:'mountain', n:'Rocky Mountains',              latMin: 35, latMax: 60, lonMin:-117, lonMax:-104,  elev: 3500 },
  { t:'mountain', n:'Sierra Nevada (CA)',           latMin: 36, latMax: 42, lonMin:-122, lonMax:-118,  elev: 3600 },
  { t:'mountain', n:'Cascade Range',                latMin: 42, latMax: 49, lonMin:-122, lonMax:-120,  elev: 3300 },
  { t:'mountain', n:'Appalachians',                 latMin: 33, latMax: 47, lonMin: -85, lonMax: -68,  elev:  900 },
  { t:'mountain', n:'Atlas Mountains',              latMin: 29, latMax: 37, lonMin:  -9, lonMax:   9,  elev: 3200 },
  { t:'mountain', n:'Ethiopian Highlands',          latMin:  6, latMax: 15, lonMin:  35, lonMax:  42,  elev: 3500 },
  { t:'mountain', n:'Drakensberg',                  latMin:-31, latMax:-27, lonMin:  27, lonMax:  31,  elev: 3400 },
  { t:'mountain', n:'Ural Mountains',               latMin: 50, latMax: 67, lonMin:  58, lonMax:  62,  elev: 1700 },
  { t:'mountain', n:'Altai Mountains',              latMin: 48, latMax: 52, lonMin:  83, lonMax:  90,  elev: 3500 },
  { t:'mountain', n:'Tian Shan',                    latMin: 39, latMax: 44, lonMin:  70, lonMax:  82,  elev: 5000 },
  { t:'mountain', n:'Zagros Mountains',             latMin: 28, latMax: 38, lonMin:  45, lonMax:  52,  elev: 4200 },
  { t:'mountain', n:'Pontic/Taurus',                latMin: 36, latMax: 42, lonMin:  30, lonMax:  44,  elev: 3800 },
  { t:'mountain', n:'Scandinavian Mountains',       latMin: 57, latMax: 71, lonMin:  12, lonMax:  28,  elev: 2400 },
  { t:'mountain', n:'New Guinea Highlands',         latMin: -8, latMax: -3, lonMin: 134, lonMax: 148,  elev: 4500 },
  { t:'mountain', n:'Southern Alps (NZ)',           latMin:-45, latMax:-43, lonMin: 167, lonMax: 172,  elev: 3700 },
  { t:'mountain', n:'Great Dividing Range (AU)',    latMin:-38, latMax:-16, lonMin: 146, lonMax: 153,  elev: 2200 },
  { t:'mountain', n:'Sierra Madre (Mexico)',        latMin: 20, latMax: 30, lonMin:-110, lonMax:-100,  elev: 3300 },
  { t:'mountain', n:'Brooks Range (Alaska)',        latMin: 67, latMax: 70, lonMin:-165, lonMax:-141,  elev: 2700 },
  { t:'mountain', n:'Alaska Range',                latMin: 61, latMax: 64, lonMin:-155, lonMax:-146,  elev: 5500 },
  { t:'mountain', n:'Coast Mountains (BC)',         latMin: 49, latMax: 60, lonMin:-133, lonMax:-122,  elev: 3500 },

  // ── DESERTS (affect conductivity negatively) ───────────────────────────────
  { t:'desert', n:'Sahara',             latMin: 15, latMax: 35, lonMin: -18, lonMax:  40, elev:  400 },
  { t:'desert', n:'Arabian Desert',     latMin: 20, latMax: 32, lonMin:  44, lonMax:  58, elev:  600 },
  { t:'desert', n:'Gobi Desert',        latMin: 38, latMax: 50, lonMin:  95, lonMax: 120, elev: 1200 },
  { t:'desert', n:'Karakum/Kyzylkum',   latMin: 37, latMax: 46, lonMin:  55, lonMax:  70, elev:  200 },
  { t:'desert', n:'Thar Desert',        latMin: 22, latMax: 30, lonMin:  68, lonMax:  76, elev:  200 },
  { t:'desert', n:'Atacama Desert',     latMin:-30, latMax:-18, lonMin: -72, lonMax: -67, elev: 2400 },
  { t:'desert', n:'Patagonian Desert',  latMin:-52, latMax:-38, lonMin: -70, lonMax: -63, elev:  600 },
  { t:'desert', n:'Great Basin (US)',   latMin: 35, latMax: 43, lonMin:-118, lonMax:-111, elev: 1500 },
  { t:'desert', n:'Mojave/Sonoran',     latMin: 30, latMax: 37, lonMin:-118, lonMax:-109, elev:  800 },
  { t:'desert', n:'Australian Outback', latMin:-33, latMax:-20, lonMin: 117, lonMax: 142, elev:  400 },
  { t:'desert', n:'Namib Desert',       latMin:-28, latMax:-17, lonMin:  11, lonMax:  17, elev:  700 },
  { t:'desert', n:'Kalahari',           latMin:-26, latMax:-20, lonMin:  20, lonMax:  27, elev: 1000 },

  // ── HIGHLANDS / PLATEAUS ──────────────────────────────────────────────────
  { t:'highland', n:'Tibetan Plateau',  latMin: 28, latMax: 38, lonMin:  78, lonMax: 100, elev: 4500 },
  { t:'highland', n:'East African Rift',latMin:-12, latMax: 15, lonMin:  29, lonMax:  38, elev: 2000 },
  { t:'highland', n:'Colombian Massif', latMin:  1, latMax:  6, lonMin: -78, lonMax: -74, elev: 3200 },
  { t:'highland', n:'Anatolian Plateau',latMin: 37, latMax: 42, lonMin:  30, lonMax:  44, elev: 1200 },
  { t:'highland', n:'Iranian Plateau',  latMin: 26, latMax: 40, lonMin:  52, lonMax:  62, elev: 1200 },
  { t:'highland', n:'Central Asian Steppe',latMin:44,latMax:56,lonMin:  55, lonMax:  90, elev:  500 },
  { t:'highland', n:'Greenland Ice Sheet',latMin:60,latMax:84,lonMin:-55,  lonMax: -18, elev: 2800 },
];

// Priority for overlap resolution
export const TERRAIN_PRIORITY = { mountain: 5, lake: 4, ocean: 3, highland: 2, desert: 1 };

// Conductivity table (mS/m) per terrain type
export const TERRAIN_COND = {
  ocean:    5000,   // seawater — near perfect
  lake:     3,      // freshwater — similar to wet land
  mountain: 1,      // rocky, thin soil — poor
  desert:   0.3,    // very dry — terrible
  highland: 2,      // mixed
  land:     3,      // average continental interior
};

// Classify a single lat/lon point — returns { type, name, elev }
export function classifyPoint(lat, lon) {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  // Feature boxes carry elevation, fresh-water, and conductivity a land/sea
  // mask cannot — but they are rectangles, and the desert/highland rectangles
  // overhang open water (the Sahara box spans the Mediterranean and Red Sea;
  // the Arabian box spans the Persian Gulf). The old ocean boxes outranked
  // desert/highland; when the mask replaced them, that ordering was silently
  // lost and the Med scored as desert (Iris round 2, finding A). So: where the
  // coastline mask says WATER, a desert/highland box does not apply. Mountain
  // and lake boxes still win outright, same as they outranked ocean boxes
  // before — coastal ranges and the Great Lakes rely on that.
  var best = null;
  var bestPri = -1;
  for (var i = 0; i < TERRAIN_DB.length; i++) {
    var e = TERRAIN_DB[i];
    if (lat >= e.latMin && lat <= e.latMax && lon >= e.lonMin && lon <= e.lonMax) {
      var pri = TERRAIN_PRIORITY[e.t] || 0;
      if (pri > bestPri) { bestPri = pri; best = e; }
    }
  }
  var water = !isLand(lat, lon);
  if (best && !(water && (best.t === 'desert' || best.t === 'highland'))) {
    return { type: best.t, name: best.n, elev: best.elev || 0, cond: TERRAIN_COND[best.t] };
  }
  // Ocean vs land comes from a real 1-degree coastline bitmask, not from
  // hand-drawn ocean boxes (whose maintenance was a bug factory — the western
  // North Pacific was silently land for months, VALIDATION Parts 33/35).
  if (!water) return { type: 'land', name: null, elev: 0, cond: TERRAIN_COND.land };
  return { type: 'ocean', name: 'Ocean', elev: 0, cond: TERRAIN_COND.ocean };
}

// ── GREAT-CIRCLE PATH SAMPLER ─────────────────────────────────────────────────
// Returns array of { lat, lon, frac, terrain }
export function samplePath(lat1, lon1, lat2, lon2, n) {
  n = n || 32;
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var la1 = lat1 * D2R, lo1 = lon1 * D2R;
  var la2 = lat2 * D2R, lo2 = lon2 * D2R;
  var d = 2 * Math.asin(Math.sqrt(
    Math.pow(Math.sin((la2 - la1) / 2), 2) +
    Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2)
  ));
  var pts = [];
  for (var i = 0; i <= n; i++) {
    var f = i / n;
    var lat, lon;
    if (d < 1e-6) {
      lat = lat1; lon = lon1;
    } else {
      var A = Math.sin((1 - f) * d) / Math.sin(d);
      var B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      var y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      var z = A * Math.sin(la1) + B * Math.sin(la2);
      lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D;
      lon = Math.atan2(y, x) * R2D;
    }
    pts.push({ lat: lat, lon: lon, frac: f, terrain: classifyPoint(lat, lon) });
  }
  return pts;
}

// ── PATH TERRAIN SUMMARY ──────────────────────────────────────────────────────
export function pathTerrainAnalysis(lat1, lon1, lat2, lon2, n) {
  var pts = samplePath(lat1, lon1, lat2, lon2, n || 32);
  var counts = { ocean: 0, lake: 0, mountain: 0, desert: 0, highland: 0, land: 0 };
  var names  = {};
  var maxElev = 0;
  var condSum = 0;
  var obstacleElevs = []; // elevations of mountain/highland hits

  pts.forEach(function(p) {
    var t = p.terrain;
    counts[t.type] = (counts[t.type] || 0) + 1;
    if (t.name) names[t.name] = (names[t.name] || 0) + 1;
    if (t.elev > maxElev) maxElev = t.elev;
    if (t.type === 'mountain' || t.type === 'highland') {
      obstacleElevs.push({ frac: p.frac, elev: t.elev, name: t.name });
    }
    condSum += Math.log(t.cond);
  });

  var total = pts.length;
  var fracs = {};
  Object.keys(counts).forEach(function(k) { fracs[k] = counts[k] / total; });

  // Geometric-mean effective conductivity (log-weighted)
  var condMSm = Math.exp(condSum / total);

  // Key obstacle: the highest point along the path (for takeoff angle calc)
  var keyObstacle = null;
  if (obstacleElevs.length > 0) {
    obstacleElevs.sort(function(a, b) { return b.elev - a.elev; });
    keyObstacle = obstacleElevs[0];
  }

  var namedBodies = Object.keys(names).filter(function(k) {
    return TERRAIN_DB.some(function(e) { return e.n === k && (e.t === 'ocean' || e.t === 'lake'); });
  });
  var namedMountains = Object.keys(names).filter(function(k) {
    return TERRAIN_DB.some(function(e) { return e.n === k && (e.t === 'mountain' || e.t === 'highland'); });
  });

  return {
    pts:           pts,
    fracs:         fracs,
    condMSm:       condMSm,
    maxElev:       maxElev,
    keyObstacle:   keyObstacle,
    namedBodies:   namedBodies,
    namedMountains:namedMountains,
    oceanFrac:     fracs.ocean || 0,
    landFrac:      (fracs.land || 0) + (fracs.highland || 0),
    mountainFrac:  fracs.mountain || 0,
    desertFrac:    fracs.desert || 0,
  };
}

// calcTakeoffAngle(), groundWaveMultiplier(), chordalHopPossible(), HOP,
// and calcHops() now live in propagation.js (imported above).
