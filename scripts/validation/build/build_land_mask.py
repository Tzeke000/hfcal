#!/usr/bin/env python3
"""Rasterize Natural Earth land polygons into a 1-degree land/sea bitmask.

Why this exists: the terrain model used to decide ocean-vs-land from
hand-drawn bounding boxes (docs/VALIDATION.md Parts 25/33 — the western North
Pacific was silently classified as land because a box stopped at the wrong
meridian). Hand-maintained geometry is a defect FACTORY: every box is a chance
to get a meridian wrong. This replaces the ocean boxes with a real, exact
land/sea mask derived from a citable public-domain coastline, so that entire
class of bug cannot recur.

Source: Natural Earth 1:50m physical land (public domain, no attribution
required). https://www.naturalearthdata.com/ — the `ne_50m_land` GeoJSON.

Output: src/data/landMask.js — a generated module carrying a packed bitmask,
one bit per 1x1 degree cell (360 lon x 180 lat = 64,800 bits = 8,100 bytes),
base64-encoded, plus an isLand(lat, lon) reader. Inlined as JS (not a fetched
asset) because classifyPoint is synchronous and used during render and in the
node tests; 8 KB packed is trivially inlinable, matching how fof2Map.js and
mfactorTable.js ship.

Rasterization rule: a cell is LAND if its centre point falls inside any land
polygon (even-odd ray casting, holes handled by parity). 1 degree is the
model's own resolution, so cell-centre sampling is the honest choice.

Run: python3 scripts/validation/build/build_land_mask.py path/to/ne_50m_land.geojson
Regenerate when the source coastline is updated (rarely).

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import base64
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
NLON, NLAT = 360, 180   # 1-degree cells


def rings_of(geom):
    """Yield each polygon's exterior+interior rings as (Nx2) arrays."""
    t = geom['type']
    polys = geom['coordinates'] if t == 'Polygon' else \
        [p for mp in geom['coordinates'] for p in [mp]] if False else None
    if t == 'Polygon':
        yield geom['coordinates']
    elif t == 'MultiPolygon':
        for poly in geom['coordinates']:
            yield poly


def build_mask(features):
    """LAND mask, shape (NLAT, NLON), row 0 = latitude band [-90,-89)."""
    # Cell centres.
    lon_c = (np.arange(NLON) - 180) + 0.5     # -179.5 .. 179.5
    lat_c = (np.arange(NLAT) - 90) + 0.5      # -89.5 .. 89.5
    land = np.zeros((NLAT, NLON), dtype=bool)

    # For each polygon ring, flip parity of every cell whose centre is inside.
    # Even-odd fill over exterior AND holes gives correct land with lakes-in-
    # islands, etc. We accumulate parity per cell as an int and take odd=land.
    parity = np.zeros((NLAT, NLON), dtype=np.int32)

    LON, LAT = np.meshgrid(lon_c, lat_c)      # (NLAT, NLON)

    def ring_inside(ring):
        """Boolean grid: centre inside this single ring (ray cast to +lon)."""
        r = np.asarray(ring, dtype=float)
        x = r[:, 0]; y = r[:, 1]
        inside = np.zeros((NLAT, NLON), dtype=bool)
        n = len(r)
        j = n - 1
        for i in range(n):
            yi, yj = y[i], y[j]
            # edges straddling the cell latitude
            cond = ((yi > LAT) != (yj > LAT))
            # x coordinate of the edge at LAT
            denom = (yj - yi)
            denom = np.where(denom == 0, 1e-12, denom)
            xint = x[i] + (LAT - yi) / denom * (x[j] - x[i])
            inside ^= cond & (LON < xint)
            j = i
        return inside

    for f in features:
        for poly in rings_of(f['geometry']):
            for ring in poly:            # ring[0]=exterior, ring[1:]=holes
                parity ^= ring_inside(ring)

    land = parity  # odd parity => land (holes subtract via XOR)
    return land


def pack(land):
    """Pack (NLAT, NLON) bool grid MSB-first into bytes, row-major."""
    flat = land.reshape(-1).astype(np.uint8)
    return np.packbits(flat).tobytes()


def main():
    if len(sys.argv) < 2:
        print('usage: build_land_mask.py <ne_50m_land.geojson>')
        return 1
    data = json.load(open(sys.argv[1]))
    land = build_mask(data['features'])
    packed = pack(land)
    b64 = base64.b64encode(packed).decode('ascii')

    # Sanity: land fraction of the globe should be ~29%.
    frac = land.mean()
    print('land fraction: %.1f%% (Earth is ~29%%)' % (frac * 100))
    print('packed bytes: %d' % len(packed))

    # A few spot checks printed for the human running this.
    def island(lat, lon):
        r = int(np.floor(lat)) + 90
        c = int(np.floor(lon)) + 180
        r = min(max(r, 0), NLAT - 1); c = ((c % NLON) + NLON) % NLON
        return bool(land[r, c])
    for name, la, lo, exp in [('mid-Pacific', 30, -150, False), ('Kansas', 38, -98, True),
                              ('NW Pacific (bug #1)', 40, 160, False), ('Sahara', 23, 10, True),
                              ('Tokyo', 35.7, 139.7, True), ('open Atlantic', 30, -40, False)]:
        got = island(la, lo)
        print('  %-22s %s  (expected %s)%s' % (name, got, exp, '' if got == exp else '  <-- MISMATCH'))

    out = os.path.join(ROOT, 'src', 'data', 'landMask.js')
    with open(out, 'w') as fh:
        fh.write('''// GENERATED by scripts/validation/build/build_land_mask.py — do not hand-edit.
//
// A 1-degree land/sea bitmask of Earth, one bit per 1x1 degree cell
// (360 lon x 180 lat), packed MSB-first row-major, base64-encoded. Row 0 is
// the latitude band [-90,-89); column 0 is longitude [-180,-179).
//
// This replaced the hand-drawn ocean bounding boxes, whose maintenance was a
// bug factory (docs/VALIDATION.md Parts 25/33/35). Source: Natural Earth
// 1:50m physical land, public domain.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

export const LAND_MASK_NLON = %d;
export const LAND_MASK_NLAT = %d;
export const LAND_MASK_LAND_FRACTION = %.4f;

var B64 = '%s';

// Decode once, lazily, into a Uint8Array of packed bits.
var _bits = null;
function bits() {
  if (_bits) return _bits;
  var bin = (typeof atob === 'function')
    ? atob(B64)
    : Buffer.from(B64, 'base64').toString('binary');
  var a = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  _bits = a;
  return a;
}

// True if the 1-degree cell containing (lat, lon) is land. Longitude wraps;
// latitude clamps to the poles. Exact to the source coastline at 1-degree
// resolution — no hand-maintained geometry.
export function isLand(latDeg, lonDeg) {
  if (typeof latDeg !== 'number' || !isFinite(latDeg)) return false;
  if (typeof lonDeg !== 'number' || !isFinite(lonDeg)) return false;
  var row = Math.floor(latDeg) + 90;
  if (row < 0) row = 0; else if (row > LAND_MASK_NLAT - 1) row = LAND_MASK_NLAT - 1;
  var col = ((Math.floor(lonDeg) + 180) %% LAND_MASK_NLON + LAND_MASK_NLON) %% LAND_MASK_NLON;
  var idx = row * LAND_MASK_NLON + col;
  var byte = bits()[idx >> 3];
  return ((byte >> (7 - (idx & 7))) & 1) === 1;
}
''' % (NLON, NLAT, float(frac), b64))
    print('wrote', out, '(%d bytes on disk)' % os.path.getsize(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
