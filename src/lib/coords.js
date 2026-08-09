// ── COORDINATE PARSING ────────────────────────────────────────────────────────
// MGRS / DMS / decimal-degree input parsing. Extracted from HFCalc.jsx in
// v1.7.3 so the formats the app advertises are covered by unit tests — this
// is the layer a wrong grid would silently pass through.
//
// parseCoords(raw) -> { lat, lon }  or  { lat: NaN, lon: NaN, error }
//
// This module is part of the original work of Cpl Angeles-Gonzalez,
// Ezekiel S., USMC. Project signature: HFCALC-AG-EZK-USMC-v1
// ─────────────────────────────────────────────────────────────────────────────

// ── MGRS PARSER ────────────────────────────────────────────────────────────────
const _MGRS = (function() {
  var ECC_SQUARED = 0.00669438;
  var SCALE_FACTOR = 0.9996;
  var SEMI_MAJOR_AXIS = 6378137;
  var ECC_PRIME_SQUARED = ECC_SQUARED / (1 - ECC_SQUARED);
  var E1 = (1 - Math.sqrt(1 - ECC_SQUARED)) / (1 + Math.sqrt(1 - ECC_SQUARED));
  var SET_ORIGIN_COLUMN_LETTERS = 'AJSAJS';
  var SET_ORIGIN_ROW_LETTERS = 'AFAFAF';
  var NUM_100K_SETS = 6;
  var SET_ORIGIN_COLUMN_LETTERS_CHARS = SET_ORIGIN_COLUMN_LETTERS.split('');
  var SET_ORIGIN_ROW_LETTERS_CHARS = SET_ORIGIN_ROW_LETTERS.split('');
  var I_CHAR = 'I'.charCodeAt(0);
  var O_CHAR = 'O'.charCodeAt(0);

  function getLetterDesignator(lat) {
    if (lat <= 84 && lat >= 72) return 'X';
    if (lat < 72 && lat >= 64) return 'W';
    if (lat < 64 && lat >= 56) return 'V';
    if (lat < 56 && lat >= 48) return 'U';
    if (lat < 48 && lat >= 40) return 'T';
    if (lat < 40 && lat >= 32) return 'S';
    if (lat < 32 && lat >= 24) return 'R';
    if (lat < 24 && lat >= 16) return 'Q';
    if (lat < 16 && lat >= 8) return 'P';
    if (lat < 8 && lat >= 0) return 'N';
    if (lat < 0 && lat >= -8) return 'M';
    if (lat < -8 && lat >= -16) return 'L';
    if (lat < -16 && lat >= -24) return 'K';
    if (lat < -24 && lat >= -32) return 'J';
    if (lat < -32 && lat >= -40) return 'H';
    if (lat < -40 && lat >= -48) return 'G';
    if (lat < -48 && lat >= -56) return 'F';
    if (lat < -56 && lat >= -64) return 'E';
    if (lat < -64 && lat >= -72) return 'D';
    if (lat < -72 && lat >= -80) return 'C';
    return 'Z';
  }

  function getMinNorthing(zoneLetter) {
    var northing;
    switch (zoneLetter) {
      case 'C': northing = 1100000; break; case 'D': northing = 2000000; break;
      case 'E': northing = 2800000; break; case 'F': northing = 3700000; break;
      case 'G': northing = 4600000; break; case 'H': northing = 5500000; break;
      case 'J': northing = 6400000; break; case 'K': northing = 7300000; break;
      case 'L': northing = 8200000; break; case 'M': northing = 9100000; break;
      case 'N': northing = 0; break; case 'P': northing = 800000; break;
      case 'Q': northing = 1700000; break; case 'R': northing = 2600000; break;
      case 'S': northing = 3500000; break; case 'T': northing = 4400000; break;
      case 'U': northing = 5300000; break; case 'V': northing = 6200000; break;
      case 'W': northing = 7000000; break; case 'X': northing = 7900000; break;
      default: northing = -1;
    }
    return northing;
  }

  function get100kSetForZone(i) { return ((i - 1) % NUM_100K_SETS) + 1; }

  function getEastingFromChar(e, set) {
    var curCol = SET_ORIGIN_COLUMN_LETTERS_CHARS[set - 1].charCodeAt(0);
    var eastingValue = 100000;
    var rewindMarker = false;
    while (curCol !== e.charCodeAt(0)) {
      curCol++;
      if (curCol === I_CHAR) curCol++;
      if (curCol === O_CHAR) curCol++;
      if (curCol > 'Z'.charCodeAt(0)) { if (rewindMarker) throw new Error('invalid easting'); curCol = 'A'.charCodeAt(0); rewindMarker = true; }
      eastingValue += 100000;
    }
    return eastingValue;
  }

  function getNorthingFromChar(n, set) {
    if (n > 'V') throw new Error('invalid northing');
    var curRow = SET_ORIGIN_ROW_LETTERS_CHARS[set - 1].charCodeAt(0);
    var northingValue = 0;
    var rewindMarker = false;
    while (curRow !== n.charCodeAt(0)) {
      curRow++;
      if (curRow === I_CHAR) curRow++;
      if (curRow === O_CHAR) curRow++;
      if (curRow > 'V'.charCodeAt(0)) { if (rewindMarker) throw new Error('invalid northing'); curRow = 'A'.charCodeAt(0); rewindMarker = true; }
      northingValue += 100000;
    }
    return northingValue;
  }

  function decode(mgrsString) {
    var length = mgrsString.length;
    var hunK = null;
    var sb = '';
    var testChar;
    var i = 0;
    while (!(/[A-Z]/).test(testChar = mgrsString.charAt(i))) { if (i >= 2) throw new Error('bad zone'); sb += testChar; i++; }
    var zoneNumber = parseInt(sb, 10);
    if (i === 0 || i + 3 > length) throw new Error('bad zone');
    var zoneLetter = mgrsString.charAt(i++);
    // Collect the two 100 km square letters. (This loop previously carried a
    // mangled `(hunK === null ? ++i : false) !== false` condition which went
    // false on the second pass, so it could only ever gather ONE letter and
    // every grid failed the length check below — MGRS input never worked.)
    while (i < length && (/[A-Z]/).test(testChar = mgrsString.charAt(i))) {
      if (hunK === null) { hunK = ''; }
      hunK += testChar;
      i++;
      if (hunK.length === 2) break;
    }
    if (hunK === null || hunK.length < 2) throw new Error('bad 100k');
    var set = get100kSetForZone(zoneNumber);
    var east100k = getEastingFromChar(hunK.charAt(0), set);
    var north100k = getNorthingFromChar(hunK.charAt(1), set);
    var remainder = length - i;
    if (remainder % 2 !== 0) throw new Error('bad precision');
    var sep = remainder / 2;
    var sepEasting = 0;
    var sepNorthing = 0;
    if (sep > 0) {
      var accuracyBonus = 100000 / Math.pow(10, sep);
      var sepEastingString = mgrsString.substring(i, i + sep);
      var sepNorthingString = mgrsString.substring(i + sep);
      sepEasting = parseFloat(sepEastingString) * accuracyBonus;
      sepNorthing = parseFloat(sepNorthingString) * accuracyBonus;
    }
    var easting = sepEasting + east100k;
    var northing = sepNorthing + north100k;
    var minNorthing = getMinNorthing(zoneLetter);
    // ceil, not floor(x+1): the two differ only when the quotient is an
    // exact integer — a grid on its band's minimum northing — where
    // floor(x+1) added a spurious 2,000,000 m (~2000 km north).
    northing += Math.ceil((minNorthing - northing) / 2000000) * 2000000;
    return { zoneNumber: zoneNumber, zoneLetter: zoneLetter, easting: easting, northing: northing };
  }

  function UTMtoLL(utm) {
    var zoneNumber = utm.zoneNumber;
    var zoneLetter = utm.zoneLetter;
    var easting = utm.easting;
    var northing = utm.northing;
    var isNorthHemi = (zoneLetter >= 'N');
    var x = easting - 500000;
    var y = isNorthHemi ? northing : northing - 10000000;
    var longOrigin = (zoneNumber - 1) * 6 - 180 + 3;
    var eccPrimeSquared = ECC_PRIME_SQUARED;
    var M = y / SCALE_FACTOR;
    var mu = M / (SEMI_MAJOR_AXIS * (1 - ECC_SQUARED / 4 - 3 * ECC_SQUARED * ECC_SQUARED / 64 - 5 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 256));
    var phi1Rad = mu + (3 * E1 / 2 - 27 * E1 * E1 * E1 / 32) * Math.sin(2 * mu) + (21 * E1 * E1 / 16 - 55 * E1 * E1 * E1 * E1 / 32) * Math.sin(4 * mu) + (151 * E1 * E1 * E1 / 96) * Math.sin(6 * mu);
    var N1 = SEMI_MAJOR_AXIS / Math.sqrt(1 - ECC_SQUARED * Math.sin(phi1Rad) * Math.sin(phi1Rad));
    var T1 = Math.tan(phi1Rad) * Math.tan(phi1Rad);
    var C1 = eccPrimeSquared * Math.cos(phi1Rad) * Math.cos(phi1Rad);
    var R1 = SEMI_MAJOR_AXIS * (1 - ECC_SQUARED) / Math.pow(1 - ECC_SQUARED * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5);
    var D = x / (N1 * SCALE_FACTOR);
    var lat = phi1Rad - (N1 * Math.tan(phi1Rad) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * eccPrimeSquared) * D * D * D * D / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * eccPrimeSquared - 3 * C1 * C1) * D * D * D * D * D * D / 720);
    lat = lat * 180 / Math.PI;
    var lon = (D - (1 + 2 * T1 + C1) * D * D * D / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * eccPrimeSquared + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1Rad);
    lon = longOrigin + lon * 180 / Math.PI;
    return { lat: lat, lon: lon };
  }

  function toPoint(mgrsString) {
    var result = decode(mgrsString);
    var ll = UTMtoLL(result);
    return [ll.lon, ll.lat];
  }

  return { toPoint: toPoint };
})();

function parseMGRS(raw) {
  try {
    // Strip the trailing e/n markers DAGR prints ("11897e 53935n") — anchored
    // to a preceding DIGIT so a 100 km square such as "31U EN 12345 67890"
    // keeps its letters instead of losing the N.
    var clean = raw.trim().toUpperCase()
      .replace(/(\d)[EN](?=\s|$)/g, '$1')
      .replace(/\s+/g, '');
    var pt = _MGRS.toPoint(clean);
    return validated(pt[1], pt[0]);
  } catch(e) {
    return { lon: NaN, lat: NaN, error: 'Invalid MGRS: ' + e.message };
  }
}

export function looksLikeMGRS(s) {
  return /^\d{1,2}[C-X]\s*[A-HJ-NP-Z]{2}\s*\d+[eE]?\s*\d+[nN]?$/i.test(s.trim());
}

// ── COORDINATE PARSER ──────────────────────────────────────────────────────────
// Final gate for every successful parse. Without this a fat-fingered grid
// (lat 91, lon -181) sailed through as "valid" and produced a confident but
// meaningless path. Longitudes in the 180-360 range are normalised first
// because DAGR can emit east longitude that way; anything still outside the
// valid envelope is rejected rather than silently used.
function validated(lat, lon) {
  if (!isFinite(lat) || !isFinite(lon)) {
    return { lat: NaN, lon: NaN, error: 'Unrecognized format' };
  }
  if (lon > 180 && lon <= 360) lon = lon - 360;
  if (lat < -90 || lat > 90) {
    return { lat: NaN, lon: NaN, error: 'Latitude out of range (-90 to 90)' };
  }
  if (lon < -180 || lon > 180) {
    return { lat: NaN, lon: NaN, error: 'Longitude out of range (-180 to 180)' };
  }
  return { lat: lat, lon: lon, error: null };
}

export function parseCoords(raw) {
  var s = (raw || '').trim();
  if (!s) return { lat: NaN, lon: NaN, error: 'Empty input' };

  if (looksLikeMGRS(s)) return parseMGRS(s);

  // DAGR DMS: N 39:11:24.3 W 077:30:15.0  or  N 39:11:24.3 E 236:50:10.0
  var m = s.match(/^([NS])\s*(\d+):(\d+):(\d+\.?\d*)\s+([EW])\s*(\d+):(\d+):(\d+\.?\d*)$/i);
  if (m) {
    var lat = parseFloat(m[2]) + parseFloat(m[3]) / 60 + parseFloat(m[4]) / 3600;
    if (m[1].toUpperCase() === 'S') lat = -lat;
    var lon = parseFloat(m[6]) + parseFloat(m[7]) / 60 + parseFloat(m[8]) / 3600;
    if (m[5].toUpperCase() === 'W') lon = -lon;
    else if (lon > 180) lon = lon - 360;
    return validated(lat, lon);
  }

  // DAGR Deg-Min: N 39:11.405 W 077:30.250
  m = s.match(/^([NS])\s*(\d+):(\d+\.?\d*)\s+([EW])\s*(\d+):(\d+\.?\d*)$/i);
  if (m) {
    var lat2 = parseFloat(m[2]) + parseFloat(m[3]) / 60;
    if (m[1].toUpperCase() === 'S') lat2 = -lat2;
    var lon2 = parseFloat(m[5]) + parseFloat(m[6]) / 60;
    if (m[4].toUpperCase() === 'W') lon2 = -lon2;
    return validated(lat2, lon2);
  }

  // DAGR Decimal Degrees: N 39.19008 E 282.49583 or N 39.19008 W 077.30250
  m = s.match(/^([NS])\s*(\d+\.?\d*)\s+([EW])\s*(\d+\.?\d*)$/i);
  if (m) {
    var lat3 = parseFloat(m[2]);
    if (m[1].toUpperCase() === 'S') lat3 = -lat3;
    var lon3 = parseFloat(m[4]);
    if (m[3].toUpperCase() === 'W') lon3 = -lon3;
    return validated(lat3, lon3);
  }

  // Standard DMS with symbols: 34° 25' 12" N, 112° 30' 15" W
  m = s.match(/(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([NS])[,\s]+(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([EW])/i);
  if (m) {
    var lat4 = parseFloat(m[1]) + parseFloat(m[2]) / 60 + parseFloat(m[3]) / 3600;
    if (m[4].toUpperCase() === 'S') lat4 = -lat4;
    var lon4 = parseFloat(m[5]) + parseFloat(m[6]) / 60 + parseFloat(m[7]) / 3600;
    if (m[8].toUpperCase() === 'W') lon4 = -lon4;
    return validated(lat4, lon4);
  }

  // Deg + Decimal-Min: 34 25.200 N, 112 30.250 W
  m = s.match(/(\d+)\s+(\d+\.?\d+)\s+([NS])[,\s]+(\d+)\s+(\d+\.?\d+)\s+([EW])/i);
  if (m) {
    var lat5 = parseFloat(m[1]) + parseFloat(m[2]) / 60;
    if (m[3].toUpperCase() === 'S') lat5 = -lat5;
    var lon5 = parseFloat(m[4]) + parseFloat(m[5]) / 60;
    if (m[6].toUpperCase() === 'W') lon5 = -lon5;
    return validated(lat5, lon5);
  }

  // Decimal with degree symbol: 32.45545° N, 80.71868° W
  m = s.match(/(\d+\.?\d*)\s*[\u00b0\u02da°]?\s*([NS])[,\s]+(\d+\.?\d*)\s*[\u00b0\u02da°]?\s*([EW])/i);
  if (m) {
    var lat6 = parseFloat(m[1]);
    if (m[2].toUpperCase() === 'S') lat6 = -lat6;
    var lon6 = parseFloat(m[3]);
    if (m[4].toUpperCase() === 'W') lon6 = -lon6;
    return validated(lat6, lon6);
  }

  // Signed decimal: 25.00000, -77.40000
  m = s.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (m) {
    var lat7 = parseFloat(m[1]);
    var lon7 = parseFloat(m[2]);
    return validated(lat7, lon7);
  }

  return { lat: NaN, lon: NaN, error: 'Unrecognized format' };
}
