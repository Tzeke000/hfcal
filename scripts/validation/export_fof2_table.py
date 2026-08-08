#!/usr/bin/env python3
"""Export the generated foF2 grid as the binary the app precaches.

Reads docs/validation/fof2-table.npz (from build_fof2_table.py), optionally
subsamples it to the shipped resolution, quantises to uint8 at 0.1 MHz and
writes public/fof2-table.bin with a small self-describing header so the JS
never has to hard-code the grid geometry.

Header, little-endian:
  'HFT1'                                     4 bytes
  uint16 nLat, nLon, nMonth, nHour, nSsn    10 bytes
  int16  lat0*10, latStep*10, lon0*10, lonStep*10   8 bytes
  uint16 ssn[nSsn]
  uint8  data[nLat*nLon*nMonth*nHour*nSsn]   C-order

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import os
import struct
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NPZ = os.path.join(ROOT, 'docs', 'validation', 'fof2-table.npz')
OUT = os.path.join(ROOT, 'public', 'fof2-table.bin')

LAT_KEEP = int(os.environ.get('HFCAL_LAT_KEEP', '1'))   # subsample stride
LON_KEEP = int(os.environ.get('HFCAL_LON_KEEP', '1'))
SCALE = 0.1


def main():
    z = np.load(NPZ)
    tab, lats, lons, ssns = z['table'], z['lats'], z['lons'], z['ssns']
    tab = tab[::LAT_KEEP, ::LON_KEEP]
    lats = lats[::LAT_KEEP]
    lons = lons[::LON_KEEP]

    q = np.clip(np.round(tab / SCALE), 0, 255).astype(np.uint8)
    nLat, nLon, nMon, nHour, nSsn = q.shape

    hdr = b'HFT1' + struct.pack('<5H', nLat, nLon, nMon, nHour, nSsn)
    hdr += struct.pack('<4h', int(round(lats[0] * 10)),
                       int(round((lats[1] - lats[0]) * 10)),
                       int(round(lons[0] * 10)),
                       int(round((lons[1] - lons[0]) * 10)))
    hdr += struct.pack('<%dH' % nSsn, *[int(x) for x in ssns])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'wb') as f:
        f.write(hdr)
        f.write(q.tobytes(order='C'))

    size = os.path.getsize(OUT)
    print('grid  %d lat x %d lon x %d month x %d hour x %d ssn'
          % (nLat, nLon, nMon, nHour, nSsn))
    print('      lat %.1f step %.1f   lon %.1f step %.1f   ssn %s'
          % (lats[0], lats[1] - lats[0], lons[0], lons[1] - lons[0], list(ssns)))
    print('range %.2f - %.2f MHz' % (q.min() * SCALE, q.max() * SCALE))
    print('wrote public/fof2-table.bin  (%.0f KB)' % (size / 1024.0))


if __name__ == '__main__':
    sys.exit(main())
