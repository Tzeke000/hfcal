#!/usr/bin/env python3
"""Build a GLOBAL foF2 training set from VOACAP.

Everything so far has been fitted against 4320 samples drawn from one
mid-latitude site, six latitudes on one meridian sweep, and six named
circuits. That is enough to expose bias and far too little to fit anything
richer than a handful of smooth global terms — which is exactly where the
model has plateaued, around 12%.

VOACAP's own MUF comes from the CCIR coefficient maps: a spherical-harmonic
expansion with roughly a thousand coefficients per month, fitted to worldwide
ionosonde data. It encodes real geographic structure — the equatorial anomaly,
longitude effects, the tilt of the magnetic field — that eight smooth
parameters cannot reproduce no matter how well they are fitted. To do better
the model needs a proper basis expansion, and to fit one honestly it needs
data that actually spans the globe.

This script generates that. It isolates foF2 from path geometry by running a
NEAR-VERTICAL circuit: at 200 km the takeoff angle is steep enough that the
secant factor is close to 1, so the reported MUF is essentially the critical
frequency over the midpoint. The remaining secant factor is divided out
exactly using the app's own geometry, so what comes back is foF2 itself.

Sites are spread by design rather than convenience: a quasi-uniform global
spread, with extra density through the equatorial anomaly belt where the
model is weakest. A quarter of them are held out of every fit as a TEST set,
so overfitting a rich basis to sparse data cannot hide.

Output: docs/validation/fof2-grid.json  (large; regenerate rather than commit
if it needs to change)

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import appmodel  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ITSHFBC = os.path.expanduser('~/itshfbc')
RUN_DIR = os.path.join(ITSHFBC, 'run')
OUT_DIR = os.path.join(ROOT, 'docs', 'validation')

PATH_KM = 200.0                 # near-vertical: secant factor ~1.05
FREQS = [2.0, 3.0, 4.0, 5.0, 6.5, 8.0, 10.0, 13.0, 17.0, 22.0, 28.0]
SSNS = [10, 70, 150]
MONTHS = list(range(1, 13))

# Quasi-uniform global spread via a Fibonacci sphere, which gives near-equal
# area per site without the pole crowding of a lat/lon mesh. Density matters
# more than anything else here: a fit is limited by how many DISTINCT places
# it has seen, not by how many coefficients it has (see docs/VALIDATION.md
# Part 14). Sites above 78 deg are dropped — VOACAP's auroral behaviour there
# is not something a smooth global map should be asked to carry.
N_SITES = int(os.environ.get('HFCAL_GRID_SITES', '300'))


def fibonacci_sites(n):
    out, ga = [], math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - (2 * i + 1) / n
        lat = math.degrees(math.asin(max(-1.0, min(1.0, z))))
        lon = ((math.degrees(ga * i) + 180) % 360) - 180
        if abs(lat) <= 78:
            out.append((round(lat, 2), round(lon, 2)))
    return out


SITES = fibonacci_sites(N_SITES)

# Every 4th site is never fitted, only scored — a SPATIAL holdout, so the test
# measures generalisation to places the fit has never seen.
TEST_IDX = set(range(0, len(SITES), 4))


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(la1, lo1, la2, lo2, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS)
    return """COMMENT    HFCALC foF2 grid
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     FOF2GRID            STUDY
CIRCUIT   %6s%10s%10s%10s  S     0
SYSTEM       1. 145. 0.10  90. 38.0 3.00 0.10
FPROB      1.00 1.00 1.00 0.00
ANTENNA       1    1    2   30     0.000[default/isotrope     ]  0.0    0.0200
ANTENNA       2    2    2   30     0.000[default/isotrope     ]  0.0    0.0000
FREQUENCY %s
METHOD       30    0
EXECUTE
QUIT
""" % (month, ssn, fmt(la1, 'N', 'S'), fmt(lo1, 'E', 'W'),
       fmt(la2, 'N', 'S'), fmt(lo2, 'E', 'W'), fs)


def parse_muf(path):
    out = {}
    for line in open(path, errors='replace').read().splitlines():
        if line.rstrip().endswith('FREQ'):
            v = line.split()[:-1]
            try:
                out[int(round(float(v[0])))] = float(v[1])
            except (ValueError, IndexError):
                pass
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    # Divide out the (small, constant) secant factor for this path length.
    sec = appmodel.path_secant(PATH_KM)
    print('%d sites, %d held out for test; secant factor at %.0f km = %.4f'
          % (len(SITES), len(TEST_IDX), PATH_KM, sec))

    mags = appmodel.mag_latitudes([[la, lo] for la, lo in SITES])
    rows = []
    for si, (la, lo) in enumerate(SITES):
        rx = appmodel.destination_east(la, lo, PATH_KM)
        mid = appmodel.path_midpoint(la, lo, rx[0], rx[1])
        for ssn in SSNS:
            for month in MONTHS:
                open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(
                    deck(la, lo, rx[0], rx[1], month, ssn))
                subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
                for hour, muf in sorted(parse_muf(os.path.join(RUN_DIR, 'voacapx.out')).items()):
                    if not muf or muf <= 0:
                        continue
                    rows.append({'site': si, 'lat': mid[0], 'lon': mid[1],
                                 'maglat': round(mags[si], 2), 'ssn': ssn,
                                 'month': month, 'utc': hour,
                                 'lst': round(appmodel.local_solar_time(hour, mid[1]), 3),
                                 'fof2': round(muf / sec, 3),
                                 'test': si in TEST_IDX})
        print('  site %2d/%d  %5.1f,%7.1f  (%d rows)' % (si + 1, len(SITES), la, lo, len(rows)))

    json.dump({'path_km': PATH_KM, 'secant': sec, 'sites': SITES,
               'test_sites': sorted(TEST_IDX), 'rows': rows},
              open(os.path.join(OUT_DIR, 'fof2-grid.json'), 'w'))
    tr = sum(1 for r in rows if not r['test'])
    print('\n%d samples: %d train, %d test' % (len(rows), tr, len(rows) - tr))
    print('wrote docs/validation/fof2-grid.json')


if __name__ == '__main__':
    sys.exit(main())
