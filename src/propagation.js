// ── PROPAGATION PHYSICS ───────────────────────────────────────────────────────
// Pure geodesy + ionospheric hop model for the HF Field Antenna Calculator.
// No React, no DOM — everything here is unit-testable with `npm test`.
//
// Theory references:
//  - Flat-earth skip geometry: skip = 2h·cot(α)  ⇔  α = atan(2h/d).
//    Within a few percent of the curved-earth answer for single hops up to
//    ~3000 km and elevation angles above ~5° (ARRL Antenna Book; Siwiak,
//    "An Optimum Height for an Elevated HF Antenna", QEX May/Jun 2011).
//  - Layer heights: E ≈ 90–130 km, F1 ≈ 200 km, F2 ≈ 250–400 km.
//  - Max single-hop range is geometry-limited to ≈ 2·√(2·R·h) for a
//    tangential (0°) launch: ≈2300 km for E, ≈4500 km for F2 at 400 km.
//    Published practice: E ≈ 2000 km, F2 ≈ 4000–4500 km per hop.
//
// This module is part of the original work of Cpl Angeles-Gonzalez, Ezekiel S.,
// United States Marine Corps. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────

export const EARTH_RADIUS_KM = 6371;

// Initial great-circle bearing FROM point 1 TO point 2, degrees true (0-360).
// Direction convention for the whole app: point 1 is always YOUR station,
// point 2 is always the TARGET. Pinned by tests in propagation.test.js.
export function initialBearing(lat1, lon1, lat2, lon2) {
  var y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Great-circle distance (haversine) + bearings on a spherical Earth.
//   bearing     — from YOUR station toward the TARGET (aim your antenna here)
//   backBearing — from the TARGET back toward YOU (what the distant station
//                 aims at). On a great circle this is NOT simply bearing+180
//                 except on meridians and the equator, so it is computed
//                 properly rather than assumed.
export function geodesics(lat1, lon1, lat2, lon2) {
  var R = EARTH_RADIUS_KM;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var distKm = R * c;
  var distMi = distKm * 0.621371;
  return {
    distKm: distKm,
    distMi: distMi,
    bearing: initialBearing(lat1, lon1, lat2, lon2),
    backBearing: initialBearing(lat2, lon2, lat1, lon1),
  };
}

// Great-circle midpoint — the ionospheric reflection point for a single hop,
// and therefore the place whose local solar time and magnetic latitude drive
// the propagation model. Computed on the sphere rather than by averaging the
// two coordinates: a plain average puts a path that crosses the antimeridian
// (e.g. Guam to Hawaii) on the opposite side of the planet, which silently
// shifts local solar time by twelve hours.
export function pathMidpoint(lat1, lon1, lat2, lon2) {
  var D = Math.PI / 180;
  var dLon = (lon2 - lon1) * D;
  var la1 = lat1 * D, la2 = lat2 * D;
  var bx = Math.cos(la2) * Math.cos(dLon);
  var by = Math.cos(la2) * Math.sin(dLon);
  var lat = Math.atan2(Math.sin(la1) + Math.sin(la2),
                       Math.sqrt((Math.cos(la1) + bx) * (Math.cos(la1) + bx) + by * by));
  var lon = lon1 * D + Math.atan2(by, Math.cos(la1) + bx);
  return { lat: lat / D, lon: ((lon / D + 540) % 360) - 180 };
}

export function propagationZone(distKm) {
  if (distKm < 80) return 'groundwave';
  if (distKm < 500) return 'nvis';
  if (distKm < 2000) return 'singlehop';
  if (distKm < 4000) return 'mediumdx';
  return 'longdx';
}

export function bearingToCardinal(b) {
  var dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(b / 22.5) % 16];
}

// ── TERRAIN-ADJUSTED TAKEOFF ANGLE ────────────────────────────────────────────
//
// Baseline skywave takeoff angle: curved-earth mirror-reflection geometry.
// The ray travels in a straight line below the ionosphere; the Earth's
// surface curves away beneath it, so for a hop of ground distance d over a
// layer at virtual height h (Earth radius R, half-arc θ = d/2R):
//
//   α = atan[ (cos θ − R/(R+h)) / sin θ ]
//
// (Davies, "Ionospheric Radio"; equivalent to the ARRL curved-earth skip
// geometry. Reduces to the flat-earth atan(2h/d) for short paths.)
// Validated against VOACAP — see docs/VALIDATION.md.
//
// Reference values (F2 virtual height 360 km):
//   Single hop 500 km   => ~53° (steep, short range)
//   Single hop 1500 km  => ~22°
//   Single hop 3000 km  => ~6°
//   Near the geometric hop limit the angle approaches 0 (clamped below).
//
// Terrain adjustments:
//   1. Mountain barrier near TX: add clearance degrees so signal clears ridgeline
//      clearance_deg = atan(elev_m / (frac * distKm * 1000)) + 2° safety margin
//   2. Ocean reflection path (>50%): subtract 2-3° (flatter angles more efficient)
//   3. Desert path (>40%): add 1-2° (absorption, need stronger signal geometry)
//   4. CHORDAL HOP condition: distKm > 3000, oceanFrac > 0.5, freq 10-28 MHz
//      => angle reduced by ~30% (signal stays in ionosphere between hops)
//
export function calcTakeoffAngle(distKm, freqMHz, layerKm, terrain) {
  var hopDistKm = distKm; // single-hop baseline
  var theta = hopDistKm / (2 * EARTH_RADIUS_KM); // half-arc angle
  var baseRad = Math.atan2(
    Math.cos(theta) - EARTH_RADIUS_KM / (EARTH_RADIUS_KM + layerKm),
    Math.sin(theta)
  );
  // Beyond the geometric hop limit the expression goes negative — floor at 0
  // (the 3° operational clamp below still applies to the final angle).
  var baseDeg = Math.max(0, baseRad * 180 / Math.PI);

  var adjustments = [];
  var finalDeg = baseDeg;

  // 1. Mountain barrier clearance
  if (terrain && terrain.keyObstacle && terrain.keyObstacle.elev > 800) {
    var obs = terrain.keyObstacle;
    // Horizontal distance from TX to obstacle
    var distToObsKm = obs.frac * distKm;
    if (distToObsKm < 200 && distToObsKm > 1) {
      // Near-field mountain — must aim OVER it
      var clearRad = Math.atan2(obs.elev / 1000, distToObsKm); // radians
      var clearDeg = clearRad * 180 / Math.PI + 2; // +2° safety
      if (clearDeg > finalDeg) {
        finalDeg = clearDeg;
        adjustments.push({
          type: 'mountain_clearance',
          delta: +(clearDeg - baseDeg).toFixed(1),
          note: obs.name + ' (' + obs.elev.toFixed(0) + ' m) blocks near path — angle raised to clear ridgeline'
        });
      }
    } else if (terrain.mountainFrac > 0.2) {
      // Path runs through significant mountain terrain
      finalDeg += 3;
      adjustments.push({ type: 'mountain_path', delta: 3, note: 'Path crosses ' + obs.name + ' — +3° to compensate for terrain scatter and absorption' });
    }
  }

  // 2. Ocean path advantage
  if (terrain && terrain.oceanFrac > 0.5) {
    var oceanBonus = terrain.oceanFrac > 0.8 ? -3 : -1.5;
    finalDeg = Math.max(3, finalDeg + oceanBonus);
    adjustments.push({ type: 'ocean', delta: oceanBonus, note: Math.round(terrain.oceanFrac * 100) + '% ocean path — flatter angle more efficient over high-conductivity surface' });
  }

  // 3. Desert path penalty
  if (terrain && terrain.desertFrac > 0.4) {
    finalDeg += 2;
    adjustments.push({ type: 'desert', delta: 2, note: Math.round(terrain.desertFrac * 100) + '% desert path — +2° to compensate for poor ground conductivity' });
  }

  // 4. Chordal hop
  var chordal = distKm > 3000 && (terrain ? terrain.oceanFrac : 0) > 0.5 && freqMHz >= 10 && freqMHz <= 28;
  if (chordal) {
    finalDeg *= 0.7; // shallower — signal stays in ionosphere
    finalDeg = Math.max(3, finalDeg);
    adjustments.push({ type: 'chordal', delta: null, note: 'Chordal hop possible — signal may stay within ionosphere, effective angle reduced ≈30%' });
  }

  finalDeg = Math.max(3, Math.min(85, finalDeg));

  return {
    baseDeg:     +baseDeg.toFixed(1),
    finalDeg:    +finalDeg.toFixed(1),
    adjustments: adjustments,
    chordal:     chordal,
  };
}

// ── GROUND WAVE MULTIPLIER ────────────────────────────────────────────────────
export function groundWaveMultiplier(condMSm) {
  return Math.sqrt(condMSm / 3); // vs average land baseline
}

// ── CHORDAL HOP ───────────────────────────────────────────────────────────────
export function chordalHopPossible(distKm, freqMHz, oceanFrac) {
  return distKm > 3000 && oceanFrac > 0.5 && freqMHz >= 10 && freqMHz <= 28;
}

// ── HOP ANALYSIS ──────────────────────────────────────────────────────────────

// Longest ground distance one hop can cover off a layer at virtual height h.
// The limiting ray leaves at 0° elevation — along the horizon — so the mirror
// geometry reduces to a right triangle at the reflection point:
//
//     cos θ = R / (R + h),   d_max = 2·R·θ
//
// A max-hop figure larger than this is not "optimistic", it is impossible: it
// would need the ray launched below the horizon. This is derived rather than
// typed because the table previously carried a hand-entered 4500 km for F2,
// which exceeds the limit for its own 360 km height (4186 km) and silently
// produced single-hop solutions the geometry cannot support. Pinned by
// propagation.test.js and measured against VOACAP in
// scripts/validation/run_layer_study.py.
export function maxHopKm(hKm) {
  return 2 * EARTH_RADIUS_KM * Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + hKm));
}

export var HOP = {
  E:  { hKm: 110,  maxHopKm: maxHopKm(110), label: 'E Layer',  height: '90–130 km', note: 'Day only. Sporadic E.' },
  F1: { hKm: 200,  maxHopKm: maxHopKm(200), label: 'F1 Layer', height: '≈200 km',   note: 'Daytime, lower freq.' },
  // F2 hKm is the effective VIRTUAL reflection height used for angle
  // geometry — higher than the true layer height because ionospheric
  // refraction is gradual, not a mirror bounce. 360 km is the median of
  // VOACAP's own virtual-height output (295–466 km) across the validation
  // matrix; see docs/VALIDATION.md. The `height` string still describes
  // the true layer.
  F2: { hKm: 360,  maxHopKm: maxHopKm(360), label: 'F2 Layer', height: '250–400 km', note: 'Day & night. Primary DX.' },
};

export function calcHops(distKm, freqMHz, terrain) {
  var results = [];
  var layers = freqMHz <= 10 ? [HOP.E, HOP.F2] : [HOP.F1, HOP.F2];
  var oceanFrac = terrain ? (terrain.oceanFrac || 0) : 0;

  layers.forEach(function(layer) {
    var hops = Math.ceil(distKm / layer.maxHopKm);
    if (hops < 1) hops = 1;
    var hopDist = distKm / hops;

    var toa = calcTakeoffAngle(hopDist, freqMHz, layer.hKm, terrain);
    var reflectFracs = [];
    for (var i = 1; i < hops; i++) reflectFracs.push(i / hops);

    // Per-bounce terrain note
    var bounceTerrainNote = null;
    if (hops > 1 && terrain) {
      if (oceanFrac > 0.7)       bounceTerrainNote = 'Bounce points likely ocean — ~3–5 dB less absorption vs land per reflection.';
      else if (oceanFrac > 0.3)  bounceTerrainNote = 'Mixed land/ocean path — bounce quality varies by hop.';
      else if (terrain.mountainFrac > 0.2) bounceTerrainNote = 'Bounces partly over mountains — expect extra scatter/absorption per hop.';
      else                       bounceTerrainNote = 'Bounce points over land — ~6 dB absorption per reflection.';
    }

    results.push({
      layer:             layer.label,
      height:            layer.height,
      note:              layer.note,
      hops:              hops,
      hopDistKm:         hopDist,
      hopDistMi:         hopDist * 0.621371,
      toa:               toa,
      reflectFracs:      reflectFracs,
      bounceTerrainNote: bounceTerrainNote,
    });
  });
  return results;
}
