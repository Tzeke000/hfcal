// ── MAGNETIC DECLINATION ──────────────────────────────────────────────────────
// Every bearing this app computes is TRUE (great-circle, referenced to true
// north). Every lensatic compass reads MAGNETIC. The difference — declination,
// or "variation" — is 7-11 degrees across CONUS and reverses sign between the
// east and west coasts, so handing an operator a true bearing to dial into a
// compass is a silent error on every directional antenna.
//
// Declination comes from the World Magnetic Model (WMM), the joint NOAA/NCEI
// and British Geological Survey model that also underlies GPS receivers and
// military land-nav references. It is computed on-device from bundled
// coefficients — no network, no lookup table, valid worldwide.
//
// MAINTENANCE: WMM is reissued every five years. The bundled 2025 coefficients
// are valid until roughly November 2029; after that the `geomagnetism`
// dependency needs bumping to pick up WMM 2030. isDeclinationModelCurrent()
// below reports whether the model still covers a given date so the UI can say
// so rather than quietly drifting.
//
// Sign convention (standard): declination is POSITIVE EAST.
//   magnetic = true - declination
//   true     = magnetic + declination
// Cherry Point NC sits at about -10 deg (west), so a 279 true bearing is
// dialled as 289 magnetic.
//
// This module is part of the original work of Cpl Angeles-Gonzalez,
// Ezekiel S., USMC. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────
import geomagnetism from 'geomagnetism';

// Last date the bundled WMM epoch is valid for.
export const WMM_VALID_UNTIL = new Date('2029-11-13T03:00:00.000Z');

export function isDeclinationModelCurrent(date) {
  var d = date || new Date();
  return d.getTime() < WMM_VALID_UNTIL.getTime();
}

// Normalise any angle into 0-360.
export function norm360(deg) {
  if (typeof deg !== 'number' || !isFinite(deg)) return NaN;
  return ((deg % 360) + 360) % 360;
}

// Magnetic declination in degrees at a position, positive east.
// Returns null when the position is unusable or the model cannot be evaluated.
export function declination(lat, lon, date) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  try {
    // Past the model epoch, fall back to evaluating at the last valid date
    // rather than refusing — a slightly stale declination beats none, and
    // isDeclinationModelCurrent() lets the UI flag it.
    var when = date || new Date();
    if (when.getTime() >= WMM_VALID_UNTIL.getTime()) when = new Date(WMM_VALID_UNTIL.getTime() - 86400000);
    var info = geomagnetism.model(when).point([lat, lon]);
    return (info && typeof info.decl === 'number' && isFinite(info.decl)) ? info.decl : null;
  } catch (e) {
    return null;
  }
}

// True bearing -> the number to set on a lensatic compass.
export function trueToMagnetic(trueDeg, declDeg) {
  if (typeof trueDeg !== 'number' || !isFinite(trueDeg)) return NaN;
  if (typeof declDeg !== 'number' || !isFinite(declDeg)) return NaN;
  return norm360(trueDeg - declDeg);
}

// Compass reading -> true bearing.
export function magneticToTrue(magDeg, declDeg) {
  if (typeof magDeg !== 'number' || !isFinite(magDeg)) return NaN;
  if (typeof declDeg !== 'number' || !isFinite(declDeg)) return NaN;
  return norm360(magDeg + declDeg);
}

// "10.2 deg W" / "3.4 deg E" — how declination is written on a map margin.
export function formatDeclination(declDeg) {
  if (typeof declDeg !== 'number' || !isFinite(declDeg)) return '';
  var d = Math.abs(declDeg);
  return d.toFixed(1) + '° ' + (declDeg >= 0 ? 'E' : 'W');
}

// Smallest signed turn from one heading to another, -180..180. Used by the
// compass to say "turn 40 deg right" rather than making the operator subtract.
export function relativeTurn(fromDeg, toDeg) {
  if (!isFinite(fromDeg) || !isFinite(toDeg)) return NaN;
  var d = norm360(toDeg) - norm360(fromDeg);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
