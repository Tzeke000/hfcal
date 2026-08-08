#!/usr/bin/env python3
"""Measure the seasonal behaviour of foF2 against VOACAP, by latitude.

The frequency advisor had no seasonal term: it returned one number for a
given solar activity and local time regardless of the month. That is wrong
in two ways an operator would notice — the effect reverses between
hemispheres (June is summer in Finland and winter in New Zealand), and at
mid-latitudes the DAYTIME behaviour is counter-intuitive: foF2 is higher in
local winter than local summer (the classic "winter anomaly"), while at
night the ordering flips.

This script isolates that effect. Path geometry is held fixed (1500 km due
east) so the secant factor is constant and every MUF difference is a foF2
difference. It sweeps six latitudes from 60N to 44S, all twelve months, and
two solar levels, then reports the seasonal ratio relative to the annual
mean split by day and night.

Run with no arguments to sweep VOACAP and write the raw data. Run with
--eval to skip VOACAP and just score src/freqAdvisor.js against the data
already collected, which is how the numbers in docs/VALIDATION.md are
regenerated after a coefficient change.

Output: docs/validation/seasonal-results.json

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import statistics
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import appmodel  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ITSHFBC = os.path.expanduser('~/itshfbc')
RUN_DIR = os.path.join(ITSHFBC, 'run')
OUT_DIR = os.path.join(ROOT, 'docs', 'validation')

EARTH_R = 6371.0
PATH_KM = 1500.0
FREQS = [3.50, 5.30, 7.20, 10.10, 14.20, 18.10, 21.30, 24.90, 28.50]

# Latitudes chosen to span both hemispheres and the tropics, where the
# seasonal swing is known to collapse toward zero.
SITES = [
    ('60N Finland-ish', 60.0, 25.0),
    ('44N Michigan',    44.45, -83.39),
    ('34N Cherry Pt',   34.90, -76.88),
    ('10N tropics',     10.0, -60.0),
    ('34S',            -34.0, 18.0),
    ('44S NewZealand', -44.0, 171.0),
]
MONTHS = list(range(1, 13))
SSNS = [30, 100]


def dest_east(lat, lon, dist_km):
    d = dist_km / EARTH_R
    la1, lo1 = math.radians(lat), math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(math.radians(90)))
    lo2 = lo1 + math.atan2(math.sin(math.radians(90)) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(lat1, lon1, lat2, lon2, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS) + ' 0.00 0.00'
    return """COMMENT    HFCALC seasonal study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     SEASONAL            STUDY
CIRCUIT   %6s%10s%10s%10s  S     0
SYSTEM       1. 145. 0.10  90. 73.0 3.00 0.10
FPROB      1.00 1.00 1.00 0.00
ANTENNA       1    1    2   30     0.000[default/const17.voa  ]  0.0  500.0000
ANTENNA       2    2    2   30     0.000[default/swwhip.voa   ]  0.0    0.0000
FREQUENCY %s
METHOD       30    0
EXECUTE
QUIT
""" % (month, ssn, fmt(lat1, 'N', 'S'), fmt(lon1, 'E', 'W'),
       fmt(lat2, 'N', 'S'), fmt(lon2, 'E', 'W'), fs)


def parse_muf(path):
    out = {}
    for line in open(path, errors='replace').read().splitlines():
        if line.rstrip().endswith('FREQ'):
            v = [float(x) for x in line.split()[:-1]]
            if len(v) >= 2:
                out[int(round(v[0]))] = v[1]
    return out


# Magnetic latitude of each path midpoint, from the WMM dip angle
# (magneticLatitude() in src/magnetic.js). The ionosphere is organised by the
# magnetic field, so this — not geographic latitude — is what the model takes.
MID_LAT = {
    '60N Finland-ish': appmodel.path_midpoint(60.0, 25.0, *appmodel.destination_east(60.0, 25.0, 1500.0))[0],
    '44N Michigan': appmodel.path_midpoint(44.45, -83.39, *appmodel.destination_east(44.45, -83.39, 1500.0))[0],
    '34N Cherry Pt': appmodel.path_midpoint(34.90, -76.88, *appmodel.destination_east(34.90, -76.88, 1500.0))[0],
    '10N tropics': appmodel.path_midpoint(10.0, -60.0, *appmodel.destination_east(10.0, -60.0, 1500.0))[0],
    '34S': appmodel.path_midpoint(-34.0, 18.0, *appmodel.destination_east(-34.0, 18.0, 1500.0))[0],
    '44S NewZealand': appmodel.path_midpoint(-44.0, 171.0, *appmodel.destination_east(-44.0, 171.0, 1500.0))[0],
}

MAG_LAT = {
    '60N Finland-ish': 60.1,
    '44N Michigan': 51.3,
    '34N Cherry Pt': 39.8,
    '10N tropics': 10.0,
    '34S': -44.2,
    '44S NewZealand': -49.8,
}

F2_HEIGHT_KM = 360.0


def app_muf(ssn, lst, month=None, mag_lat=None, lat=None):
    return appmodel.est_fof2(ssn, lst, month, mag_lat, lat) * appmodel.path_secant(PATH_KM)


def evaluate(rows):
    """Score the model with and without the season/latitude term."""
    def err(with_season):
        out = {}
        for name in MAG_LAT:
            sub = [r for r in rows if r['site'] == name and r['muf'] > 0]
            if not sub:
                continue
            e = []
            for r in sub:
                a = (app_muf(r['ssn'], r['lst'], r['month'], MAG_LAT[name], MID_LAT[name])
                     if with_season else app_muf(r['ssn'], r['lst']))
                e.append(abs(a - r['muf']) / r['muf'] * 100)
            out[name] = statistics.mean(e)
        return out

    before, after = err(False), err(True)
    print('\nmean absolute MUF error vs VOACAP')
    print('  %-18s %8s %8s' % ('site', 'legacy', 'solar'))
    for name in MAG_LAT:
        if name in before:
            print('  %-18s %7.1f%% %7.1f%%' % (name, before[name], after[name]))
    if before:
        print('  %-18s %7.1f%% %7.1f%%' % ('ALL SITES',
                                           statistics.mean(before.values()),
                                           statistics.mean(after.values())))


def main():
    if '--eval' in sys.argv:
        data = json.load(open(os.path.join(OUT_DIR, 'seasonal-results.json')))
        evaluate(data['rows'])
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for name, lat, lon in SITES:
        rlat, rlon = dest_east(lat, lon, PATH_KM)
        # Midpoint longitude must wrap: a naive (lon + rlon)/2 puts a path
        # crossing the antimeridian on the far side of the planet, which
        # silently corrupts every local-solar-time in the run.
        dlon = ((rlon - lon + 540) % 360) - 180
        mid_lon = ((lon + dlon / 2 + 540) % 360) - 180
        for ssn in SSNS:
            for m in MONTHS:
                open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(deck(lat, lon, rlat, rlon, m, ssn))
                subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=120)
                for hour, muf in sorted(parse_muf(os.path.join(RUN_DIR, 'voacapx.out')).items()):
                    lst = ((hour + mid_lon / 15) % 24 + 24) % 24
                    rows.append({'site': name, 'lat': lat, 'ssn': ssn, 'month': m,
                                 'utc': hour, 'lst': round(lst, 2), 'muf': muf})
        print('%-16s done (%d rows)' % (name, len([r for r in rows if r['site'] == name])))

    json.dump({'path_km': PATH_KM, 'sites': SITES, 'rows': rows},
              open(os.path.join(OUT_DIR, 'seasonal-results.json'), 'w'))

    # Seasonal ratio vs the site's annual mean, split day / night by local
    # solar time, which is where the winter anomaly shows up.
    print('\nseasonal ratio vs annual mean  (DAY = 09-15 LST, NIGHT = 21-03 LST)')
    for name, lat, lon in SITES:
        sub = [r for r in rows if r['site'] == name]
        if not sub:
            continue
        day = [r for r in sub if 9 <= r['lst'] <= 15]
        night = [r for r in sub if r['lst'] >= 21 or r['lst'] <= 3]
        dmean, nmean = statistics.mean([r['muf'] for r in day]), statistics.mean([r['muf'] for r in night])
        out = []
        for m in (1, 4, 7, 10):
            dm = [r['muf'] for r in day if r['month'] == m]
            nm = [r['muf'] for r in night if r['month'] == m]
            out.append('%s D%.2f N%.2f' % (['JAN','','','APR','','','JUL','','','OCT'][m-1],
                                           statistics.mean(dm)/dmean, statistics.mean(nm)/nmean))
        print('  %-16s %s' % (name, '  '.join(out)))

    evaluate(rows)


if __name__ == '__main__':
    sys.exit(main())
