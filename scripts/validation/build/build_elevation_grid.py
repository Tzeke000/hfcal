#!/usr/bin/env python3
"""Build the global elevation grid from real terrain data.

Why this exists: the terrain model decided mountains from hand-drawn boxes, and
four releases in a row (VALIDATION Parts 42-45) fixed the same defect — a
rectangle that swept in ground it should not: the Mediterranean as desert,
Las Vegas as a 3,500 m peak, the whole US East Coast as mountains, and a ridge
next to MCAS Yuma the model could not see at all. Patching ranges one at a time
does not end that class of bug. Real elevation data does, the same way
build_land_mask.py ended the hand-drawn ocean boxes (Part 35).

Source: AWS Terrain Tiles (Tilezen/Mapzen "terrarium" encoding), a public
open-data mosaic of SRTM, GMTED2010, ETOPO1 and other public-domain or openly
licensed elevation sets. https://registry.opendata.aws/terrain-tiles/
Attribution for the underlying sources is listed in docs/validation/
ELEVATION-ATTRIBUTION.md, written alongside the grid by this script.

Method: zoom-6 tiles (~2.4 km pixels at the equator) are fetched for every tile
that touches land in the app's own 1-degree coastline mask (open ocean is
skipped — the app treats sea level as 0 m and never needs bathymetry). Every
pixel is binned into a 0.25-degree cell. Two layers are kept per cell:

  MEAN — mean elevation of the cell's LAND pixels. What a station standing in
         that cell is taken to stand at.
  MAX  — highest pixel in the cell. What a ray leaving across that cell has to
         clear: a ridgeline is a maximum, not an average.

Encoding: one byte per cell per layer, nonlinear so the resolution sits where
HF siting needs it — 10 m steps to 1,270 m, then 60 m steps to 8,900 m.
Below-sea-level land (Death Valley, the Dead Sea, the Salton trough) clamps to
0. Runs of zero (ocean) are run-length encoded, which is most of the planet.

Spot checks ASSERT. A violated sanity gate kills the build rather than writing
a broken grid (the lesson of Iris round 2's minor on build_land_mask.py).

Run: python3 scripts/validation/build/build_elevation_grid.py [cache_dir]
Writes public/elevation-grid.bin. Needs numpy and Pillow, and network access
to s3.amazonaws.com for the first run (tiles are cached after that).

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import base64
import concurrent.futures as cf
import hashlib
import io
import math
import os
import re
import struct
import sys
import time
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ZOOM = 7
SEED_ZOOM = 6          # tile selection: fetch a zoom-7 tile only where its zoom-6
                       # parent quadrant holds land
TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
STEP = 0.25                      # degrees per cell
NLAT, NLON = int(180 / STEP), int(360 / STEP)
MERC_MAX_LAT = 85.0511287798


# ── quantisation (keep in step with src/data/elevationGrid.js) ───────────────
def encode_elev(m):
    """metres -> byte. 0 = sea level/below; 1..127 = 10 m steps; 128..255 = 60 m."""
    m = np.maximum(np.asarray(m, dtype=float), 0.0)
    lo = np.clip(np.round(m / 10.0), 0, 127)
    hi = np.clip(np.round((m - 1280.0) / 60.0) + 128, 128, 255)
    return np.where(m < 1275.0, lo, hi).astype(np.uint8)


def decode_elev(v):
    v = np.asarray(v, dtype=float)
    return np.where(v < 128, v * 10.0, 1280.0 + (v - 128.0) * 60.0)


def rle_zero(layer):
    """Zero runs -> 0x00 + uint16 LE count; any other byte is a literal."""
    out = bytearray()
    flat = layer.reshape(-1)
    i, n = 0, flat.size
    while i < n:
        if flat[i] == 0:
            j = i
            while j < n and flat[j] == 0 and j - i < 65535:
                j += 1
            out += b'\x00' + struct.pack('<H', j - i)
            i = j
        else:
            out.append(int(flat[i]))
            i += 1
    return bytes(out)


# ── the app's own land mask, so open ocean is never downloaded ───────────────
def load_land_mask():
    src = open(os.path.join(ROOT, 'src', 'data', 'landMask.js')).read()
    b64 = re.search(r"var B64 = '([^']+)'", src).group(1)
    bits = np.unpackbits(np.frombuffer(base64.b64decode(b64), dtype=np.uint8))
    return bits[:180 * 360].reshape(180, 360).astype(bool)   # row 0 = [-90,-89)


def tile_bounds(x, y, z):
    n = 2 ** z
    lon0 = x / n * 360 - 180
    lon1 = (x + 1) / n * 360 - 180
    lat0 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    lat1 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat0, lat1, lon0, lon1


def land_tiles(mask, z):
    n = 2 ** z
    keep = []
    for x in range(n):
        for y in range(n):
            la0, la1, lo0, lo1 = tile_bounds(x, y, z)
            r0, r1 = int(math.floor(la0)) + 90, int(math.ceil(la1)) + 90
            c0, c1 = int(math.floor(lo0)) + 180, int(math.ceil(lo1)) + 180
            # one-cell halo so coastal cells are never starved of pixels
            sub = mask[max(0, r0 - 1):min(180, r1 + 1), max(0, c0 - 1):min(360, c1 + 1)]
            if sub.any():
                keep.append((x, y))
    return keep


def fetch(x, y, z, cache):
    path = os.path.join(cache, '%d_%d_%d.png' % (z, x, y))
    if not os.path.exists(path):
        url = TILE_URL.format(z=z, x=x, y=y)
        for attempt in range(4):
            try:
                data = urllib.request.urlopen(url, timeout=30).read()
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        with open(path + '.part', 'wb') as fh:
            fh.write(data)
        os.replace(path + '.part', path)
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.elevation-cache')
    os.makedirs(cache, exist_ok=True)
    # EVERY tile. The first cut skipped tiles that touched no land in the app's
    # own 1-degree coastline mask, to save bandwidth — and so threw away
    # Okinawa, which is smaller than a 1-degree cell and reads as water in that
    # mask. Its sanity gate caught it. Islands are exactly where Marines are;
    # the bandwidth is not worth the risk.
    tiles = [(x, y) for x in range(2 ** ZOOM) for y in range(2 ** ZOOM)]
    if ZOOM > SEED_ZOOM:
        # Choose zoom-7 tiles from the zoom-6 DATA, not from a coarse mask:
        # fetch every zoom-6 tile (cheap, cached), then only the zoom-7
        # children whose quadrant of that parent has any pixel above sea level.
        # Zoom 6 alone was not enough — its ~2.4 km pixels shaved narrow ridge
        # crests (the Gila ridge beside MCAS Yuma came out at 590 m against
        # ~1,000 m), and a ridge detector that under-reads crests calls a
        # blocking ridge clear.
        f = 2 ** (ZOOM - SEED_ZOOM)
        seeds = [(x, y) for x in range(2 ** SEED_ZOOM) for y in range(2 ** SEED_ZOOM)]
        keep = set()
        with cf.ThreadPoolExecutor(max_workers=24) as pool:
            for (x, y), e in zip(seeds, pool.map(lambda xy: fetch(xy[0], xy[1], SEED_ZOOM, cache), seeds)):
                q = 256 // f
                for dx in range(f):
                    for dy in range(f):
                        if (e[dy * q:(dy + 1) * q, dx * q:(dx + 1) * q] > 0).any():
                            keep.add((x * f + dx, y * f + dy))
        tiles = sorted(keep)
    print('zoom %d: %d tiles hold land' % (ZOOM, len(tiles)))

    total = np.zeros((NLAT, NLON))        # sum of LAND elevations
    count = np.zeros((NLAT, NLON))        # LAND pixel count
    peak = np.zeros((NLAT, NLON))         # max elevation (sea level floor)

    n = 2 ** ZOOM
    px = np.arange(256) + 0.5

    def work(xy):
        x, y = xy
        return x, y, fetch(x, y, ZOOM, cache)

    done = 0
    with cf.ThreadPoolExecutor(max_workers=24) as pool:
        for x, y, e in pool.map(work, tiles):
            gx = (x * 256 + px) / (256 * n)
            gy = (y * 256 + px) / (256 * n)
            lon = gx * 360 - 180
            lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * gy))))
            LON, LAT = np.meshgrid(lon, lat)
            r = np.clip(((LAT + 90) / STEP).astype(int), 0, NLAT - 1).ravel()
            c = np.clip(((LON + 180) / STEP).astype(int), 0, NLON - 1).ravel()
            v = e.ravel()
            land = v > 0
            np.add.at(total, (r[land], c[land]), v[land])
            np.add.at(count, (r[land], c[land]), 1)
            np.maximum.at(peak, (r, c), np.maximum(v, 0))
            done += 1
            if done % 250 == 0:
                print('  %d / %d tiles' % (done, len(tiles)))

    mean = np.where(count > 0, total / np.maximum(count, 1), 0.0)
    np.savez_compressed(os.path.join(cache, 'grid-debug.npz'), mean=mean, peak=peak, count=count)

    # Beyond Web-Mercator's 85.05 deg there are no tiles. North: Arctic Ocean
    # (0 m is right). South: the Antarctic plateau — carry the last valid row
    # poleward rather than inventing a number.
    edge = int((90 - MERC_MAX_LAT) / STEP) + 1
    for row in range(edge):
        mean[row] = mean[edge]
        peak[row] = peak[edge]

    qmean, qmax = encode_elev(mean), encode_elev(peak)

    def at(lat, lon, layer):
        rr = min(NLAT - 1, int((lat + 90) / STEP))
        cc = int(((lon + 180) % 360) / STEP)
        return float(decode_elev(layer[rr, cc]))

    # ── sanity gates: these RAISE ────────────────────────────────────────────
    checks = [
        # name, lat, lon, layer, lo, hi
        ('open Atlantic mean',        30.0,  -40.0, qmean,    0,    0),
        ('Kansas mean',               38.0,  -98.0, qmean,  300,  800),
        ('Denver mean',               39.74, -104.99, qmean, 1300, 2300),
        ('Camp Lejeune mean',         34.65, -77.35, qmean,    0,  100),
        ('MCAS Yuma mean',            32.66, -114.61, qmean,   0,  300),
        # The crest is a narrow ridge; gate the highest cell over the range,
        # not one guessed coordinate.
        ('Gila Mtns range max',       None,  None,   'gila', 750, 1100),
        ('Las Vegas mean',            36.17, -115.14, qmean,  400, 1100),
        ('Tibetan Plateau mean',      33.0,   90.0, qmean, 4000, 5600),
        ('Everest cell max',          27.99,  86.93, qmax,  7500, 8900),
        ('Mont Blanc cell max',       45.83,   6.86, qmax,  3500, 4900),
        ('Bardufoss mean',            69.06,  18.54, qmean,    0, 800),
        ('Okinawa Yanbaru max',       26.72, 128.20, qmax,   250,  600),
        ('Mt Whitney cell max',       36.58, -118.29, qmax, 4000, 4500),
    ]
    # NOT gated: the two ice sheets. Over Greenland and Antarctica the source
    # mosaic carries BEDROCK, not ice surface — Greenland's 3,200 m summit
    # reads ~240 m, Vostok ~1,100 m against ~3,490 m. The app does not use
    # this grid there at all (src/data/elevationGrid.js returns no data on the
    # ice sheets and the box model carries on); stated, not papered over.
    bad = []
    def range_max(lat0, lat1, lon0, lon1):
        r0, r1 = int((lat0 + 90) / STEP), int((lat1 + 90) / STEP)
        c0, c1 = int((lon0 + 180) / STEP), int((lon1 + 180) / STEP)
        return float(decode_elev(qmax[r0:r1 + 1, c0:c1 + 1].max()))

    for name, la, lo, layer, lo_ok, hi_ok in checks:
        got = range_max(32.40, 32.85, -114.40, -114.05) if isinstance(layer, str) else at(la, lo, layer)
        ok = lo_ok <= got <= hi_ok
        print('  %-24s %7.0f m   [%d..%d]%s' % (name, got, lo_ok, hi_ok, '' if ok else '  <-- FAIL'))
        if not ok:
            bad.append(name)
    land_frac = float((qmean > 0).mean())
    print('cells above sea level: %.1f%%' % (land_frac * 100))
    if not (0.20 < land_frac < 0.40):
        bad.append('land fraction %.3f' % land_frac)
    if bad:
        raise SystemExit('sanity gates failed (%s) — refusing to write the grid' % ', '.join(bad))

    body_mean, body_max = rle_zero(qmean), rle_zero(qmax)
    header = b'HFE1' + struct.pack('<HHfff', NLAT, NLON, -90.0, -180.0, STEP)
    blob = header + struct.pack('<I', len(body_mean)) + body_mean \
                  + struct.pack('<I', len(body_max)) + body_max
    out = os.path.join(ROOT, 'public', 'elevation-grid.bin')
    with open(out, 'wb') as fh:
        fh.write(blob)
    sha = hashlib.sha256(blob).hexdigest()
    print('wrote %s: %d bytes (raw would be %d), sha256 %s' % (out, len(blob), 2 * NLAT * NLON, sha))

    attr = os.path.join(ROOT, 'docs', 'validation', 'ELEVATION-ATTRIBUTION.md')
    with open(attr, 'w') as fh:
        fh.write("""# Elevation grid — source and attribution

`public/elevation-grid.bin` is generated by
`scripts/validation/build/build_elevation_grid.py` from **AWS Terrain Tiles**
(Tilezen "terrarium" encoding, zoom %d), https://registry.opendata.aws/terrain-tiles/.

That mosaic is built from public-domain and openly licensed sources, credited
here as its terms ask:

- **SRTM** — NASA / USGS, public domain
- **GMTED2010** — USGS / NGA, public domain
- **ETOPO1** — NOAA National Centers for Environmental Information, public domain
- **NED / 3DEP** — U.S. Geological Survey, public domain
- **ArcticDEM** — Polar Geospatial Center, University of Minnesota (NSF)
- **EU-DEM** — produced using Copernicus data and information funded by the
  European Union
- **Canadian Digital Elevation Model** — Natural Resources Canada, Open
  Government Licence – Canada
- **Geoscience Australia DEM** — © Commonwealth of Australia (Geoscience
  Australia), CC BY 4.0
- **Kartverket (Norway)** — © Kartverket, CC BY 4.0
- **LINZ (New Zealand)** — Land Information New Zealand, CC BY 4.0
- **data.gov.uk / Environment Agency LIDAR** — Open Government Licence

**Known limitation — ice sheets.** Over Greenland and Antarctica the mosaic
carries bedrock rather than ice surface (Greenland's ~3,200 m summit reads
~240 m; Vostok ~1,100 m against ~3,490 m). Those cells are wrong in this grid,
are not sanity-gated, and the app does not use them: `elevationGrid.js`
returns no data there and the terrain model falls back to its boxes.

Grid: %g-degree cells, two layers (land-pixel MEAN and cell MAX), one byte
per cell, zero runs run-length encoded. Output sha256: `%s`.
Regenerate with the script; the output must reproduce byte-identically from
the same tiles.
""" % (ZOOM, STEP, sha))
    print('wrote', attr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
