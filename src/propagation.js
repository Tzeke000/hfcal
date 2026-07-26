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

// Great-circle distance (haversine) + initial bearing on a spherical Earth.
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
  var y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  var bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return { distKm: distKm, distMi: distMi, bearing: bearing };
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
// Baseline skywave takeoff angles (flat earth, F2 layer at 330 km):
//   Single hop 500 km   => ~53° (steep, short range)
//   Single hop 1500 km  => ~24°
//   Single hop 3000 km  => ~13°
//   Multi-hop 8000+ km  => ~5-8°
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
  // Baseline flat-earth: atan(2h / hop_distance)
  var hopDistKm = distKm; // single-hop baseline
  var baseRad = Math.atan2(2 * layerKm, hopDistKm);
  var baseDeg = baseRad * 180 / Math.PI;

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
export var HOP = {
  E:  { hKm: 110,  maxHopKm: 2160, label: 'E Layer',  height: '90–130 km',  note: 'Day only. Sporadic E.' },
  F1: { hKm: 200,  maxHopKm: 3000, label: 'F1 Layer', height: '≈200 km',    note: 'Daytime, lower freq.' },
  F2: { hKm: 330,  maxHopKm: 4500, label: 'F2 Layer', height: '250–400 km', note: 'Day & night. Primary DX.' },
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
