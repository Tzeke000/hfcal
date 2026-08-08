#!/usr/bin/env python3
"""Validate the frequency model on HEMISPHERE-TO-HEMISPHERE paths vs VOACAP.

The seasonal study (run_seasonal_study.py) swept six latitudes, but every path
in it ran 1500 km due east and therefore stayed inside a single hemisphere and
a single season. That leaves the hardest case untested: a path whose two ends
are in OPPOSITE seasons, crossing the geomagnetic equator in between.

Three separate things can go wrong there, and this script separates them:

  1. WHICH POINT represents the path. The app takes local solar time and
     magnetic latitude at the great-circle midpoint. VOACAP/IONCAP instead
     evaluates control points and takes the LOWEST MUF along the path, which
     for a long transequatorial circuit can be a very different number.

  2. THE SEASON TERM. On a January Finland-to-South-Africa shot the north end
     is deep winter and the south end deep summer. The midpoint sits near the
     magnetic equator, where the model's own hemisphere flip is weighted to
     nearly zero — so the seasonal correction all but switches itself off. Is
     that right, or is it an accident that happens to look reasonable?

  3. THE LATITUDE TERM. The model makes foF2 highest AT the magnetic equator
     and fall monotonically toward the poles. The real low-latitude ionosphere
     has the equatorial ionization anomaly: a trough at the dip equator with
     crests near +/-15 deg magnetic. Transequatorial paths sit right on top of
     that structure, so this is where a monotonic fit should break down.

Magnetic latitudes come from the app's own WMM code via node, so the study
tests exactly what ships rather than a re-derivation.

Output: docs/validation/interhemi-results.json

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
F2_HEIGHT_KM = 360.0
FREQS = [3.50, 5.30, 7.20, 10.10, 14.20, 18.10, 21.30, 24.90, 28.50]

# Real circuits, each with its two ends in opposite hemispheres. The last two
# are deliberately short so the midpoint lands near the magnetic equator with
# the terminals still only a few degrees apart in season.
PATHS = [
    ('CherryPt-Argentina', 34.90, -76.88, -34.60, -58.40),
    ('Finland-SouthAfrica', 60.00, 25.00, -30.00, 25.00),
    ('Japan-Australia',     35.70, 139.70, -33.90, 151.20),
    ('Hawaii-NewZealand',   21.30, -157.90, -41.30, 174.80),
    ('CherryPt-Brazil',     34.90, -76.88, -5.00, -40.00),
    ('Panama-Peru',          9.00, -80.00, -10.00, -75.00),
]
CONDITIONS = [(1, 30), (1, 100), (7, 30), (7, 100)]   # Jan and Jul: opposite seasons


# ── App model — see scripts/validation/appmodel.py ───────────────────────────
est_fof2 = appmodel.est_fof2
secant = appmodel.path_secant


# ── Geodesy — see scripts/validation/appmodel.py ─────────────────────────────
great_circle_km = appmodel.great_circle_km
mag_lats = appmodel.mag_latitudes


def interpolate(la1, lo1, la2, lo2, frac):
    """Point at `frac` along the great circle (0 = start, 1 = end)."""
    p1, l1, p2, l2 = map(math.radians, (la1, lo1, la2, lo2))
    d = great_circle_km(la1, lo1, la2, lo2) / EARTH_R
    if d == 0:
        return la1, lo1
    a, b = math.sin((1 - frac) * d) / math.sin(d), math.sin(frac * d) / math.sin(d)
    x = a * math.cos(p1) * math.cos(l1) + b * math.cos(p2) * math.cos(l2)
    y = a * math.cos(p1) * math.sin(l1) + b * math.cos(p2) * math.sin(l2)
    z = a * math.sin(p1) + b * math.sin(p2)
    return (math.degrees(math.atan2(z, math.hypot(x, y))),
            ((math.degrees(math.atan2(y, x)) + 540) % 360) - 180)


# ── VOACAP ───────────────────────────────────────────────────────────────────
def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(la1, lo1, la2, lo2, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS) + ' 0.00 0.00'
    return """COMMENT    HFCALC interhemispheric study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     INTERHEMI           STUDY
CIRCUIT   %6s%10s%10s%10s  S     0
SYSTEM       1. 145. 0.10  90. 73.0 3.00 0.10
FPROB      1.00 1.00 1.00 0.00
ANTENNA       1    1    2   30     0.000[default/const17.voa  ]  0.0  500.0000
ANTENNA       2    2    2   30     0.000[default/swwhip.voa   ]  0.0    0.0000
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
            v = [float(x) for x in line.split()[:-1]]
            if len(v) >= 2:
                out[int(round(v[0]))] = v[1]
    return out


def lst_of(utc_hour, lon):
    return ((utc_hour + lon / 15) % 24 + 24) % 24


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows, meta = [], []

    for name, la1, lo1, la2, lo2 in PATHS:
        dist = great_circle_km(la1, lo1, la2, lo2)
        mid = interpolate(la1, lo1, la2, lo2, 0.5)
        # IONCAP-style control points: 2000 km inside each terminal on long
        # circuits, the midpoint on short ones.
        if dist > 4000:
            f = 2000.0 / dist
            cps = [interpolate(la1, lo1, la2, lo2, f),
                   interpolate(la1, lo1, la2, lo2, 1 - f)]
        else:
            cps = [mid]
        # Real ionospheric bounces: an n-hop path reflects at (2k-1)/(2n).
        hops = max(1, math.ceil(dist / appmodel.max_hop_km(F2_HEIGHT_KM)))
        bpts = appmodel.reflection_points(la1, lo1, la2, lo2, hops)
        ml = mag_lats([mid] + cps + bpts)
        mid_ml, cp_ml = ml[0], ml[1:1 + len(cps)]
        b_ml = ml[1 + len(cps):]
        b_md = appmodel.modips(bpts)
        bounces = [(p[0], p[1], m, md) for p, m, md in zip(bpts, b_ml, b_md)]
        meta.append({'path': name, 'dist_km': round(dist), 'hops': hops,
                     'bounces': [[round(p[0], 2), round(p[1], 2), round(m, 1)]
                                 for p, m in zip(bpts, b_ml)],
                     'mid': [round(mid[0], 2), round(mid[1], 2)],
                     'mid_mag_lat': round(mid_ml, 1),
                     'control_points': [[round(c[0], 2), round(c[1], 2)] for c in cps],
                     'cp_mag_lat': [round(x, 1) for x in cp_ml]})
        print('%-20s %5.0f km  midpoint %6.2f,%7.2f  magLat %5.1f  CPs %s'
              % (name, dist, mid[0], mid[1], mid_ml,
                 ' '.join('%.1f' % x for x in cp_ml)))

        sec = secant(dist)
        for (month, ssn) in CONDITIONS:
            open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(
                deck(la1, lo1, la2, lo2, month, ssn))
            subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
            for hour, vmuf in sorted(parse_muf(os.path.join(RUN_DIR, 'voacapx.out')).items()):
                # (a) what the app ships: every bounce, weakest governs
                app_mid = appmodel.path_fof2(ssn, hour, month, bounces,
                                             mid[1], mid[0], mid_ml) * sec
                # (b) no season term at all, for reference
                app_plain = est_fof2(ssn, lst_of(hour, mid[1])) * sec
                # (c) IONCAP-style: lowest control-point MUF along the path
                app_cp = min(est_fof2(ssn, lst_of(hour, c[1]), month, m, c[0]) * sec
                             for c, m in zip(cps, cp_ml))
                rows.append({'path': name, 'dist_km': round(dist), 'month': month,
                             'ssn': ssn, 'utc': hour, 'voacap_muf': vmuf,
                             'app_mid': round(app_mid, 2),
                             'app_plain': round(app_plain, 2),
                             'app_cp': round(app_cp, 2)})

    def err(key, subset):
        e = [abs(r[key] - r['voacap_muf']) / r['voacap_muf'] * 100
             for r in subset if r['voacap_muf'] > 0]
        return statistics.mean(e) if e else float('nan')

    print('\nmean absolute MUF error vs VOACAP')
    print('  %-20s %9s %9s %9s' % ('path', 'no season', 'bounces', 'ctrl pts'))
    summary = {}
    for name, *_ in PATHS:
        sub = [r for r in rows if r['path'] == name]
        summary[name] = {'no_season': round(err('app_plain', sub), 1),
                         'bounces': round(err('app_mid', sub), 1),
                         'control_points': round(err('app_cp', sub), 1)}
        print('  %-20s %8.1f%% %8.1f%% %8.1f%%'
              % (name, summary[name]['no_season'], summary[name]['bounces'],
                 summary[name]['control_points']))
    overall = {'no_season': round(err('app_plain', rows), 1),
               'bounces': round(err('app_mid', rows), 1),
               'control_points': round(err('app_cp', rows), 1)}
    print('  %-20s %8.1f%% %8.1f%% %8.1f%%'
          % ('ALL', overall['no_season'], overall['bounces'], overall['control_points']))

    # Bias: is the model systematically high or low on these paths?
    for key in ('app_mid', 'app_cp'):
        b = statistics.mean((r[key] - r['voacap_muf']) / r['voacap_muf'] * 100
                            for r in rows if r['voacap_muf'] > 0)
        print('  mean signed bias, %-8s %+.1f%%' % (key, b))

    json.dump({'paths': meta, 'summary': summary, 'overall': overall, 'rows': rows},
              open(os.path.join(OUT_DIR, 'interhemi-results.json'), 'w'), indent=2)
    print('\nwrote docs/validation/interhemi-results.json')


if __name__ == '__main__':
    sys.exit(run())
