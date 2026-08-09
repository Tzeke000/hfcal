#!/usr/bin/env python3
"""Measure the frequency model at HIGH LATITUDE against VOACAP.

Every accuracy figure this project publishes is mid-latitude (Part 2, 4.4%),
seasonal to 60 deg (Part 3), or transequatorial (Part 17, 6.0%). Nothing
states the error ABOVE 60 deg, and the app happily plans paths that bounce
there: an Alaska-to-Norway circuit reflects at 72N, 86N and 77N.

Three things could go wrong up there, and this script separates them:

  1. THE foF2 TABLE. It spans -85..+85 in 5 deg steps, so polar cells exist.
     Before v1.24 the app only USED a table value if it agreed with the
     physical model to within MAP_SANITY_FACTOR. Above the auroral oval the
     physical model is at its worst, so the suspicion was that the guard was
     throwing good table values away and falling back to the very model it
     was meant to replace.

     THAT IS WHAT THIS STUDY FOUND. On the 5% of rows where the guard fired,
     the returned MUF was low by 46% - every single row, no exceptions. The
     guard was removed for the table (kept for the map) and those rows went to
     7.0% with no bias. Every row still records which source served it AND
     whether the old guard would have rejected it, so the finding stays
     reproducible after the fix.

  2. POLAR DAY AND POLAR NIGHT. Above the Arctic circle in December the sun
     never rises and in June it never sets. The app's illumination term is
     built on the solar zenith angle with a recombination lag, which should
     handle that continuously - but "should" is not a measurement, and no
     test in this repository has ever evaluated a point in polar night.

  3. THE AURORAL ZONE ITSELF. freqAdvisor.js states outright that there is no
     auroral-zone term. VOACAP's CCIR coefficients do carry the high-latitude
     trough, so any structure the app is missing shows up as error here.

Design: a latitude sweep of identical 1500 km due-east paths from 35N (the
mid-latitude control, directly comparable to Part 2) up to 80N, mirrored into
the southern hemisphere, plus five real transpolar and high-latitude circuits.
Four months to catch both solstices and both equinoxes, three solar levels.

Output: docs/validation/polar-results.json

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import statistics
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import appmodel  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ITSHFBC = os.path.expanduser('~/itshfbc')
RUN_DIR = os.path.join(ITSHFBC, 'run')
OUT_DIR = os.path.join(ROOT, 'docs', 'validation')

EARTH_R = 6371.0
F2_HEIGHT_KM = 360.0
FREQS = [3.50, 5.30, 7.20, 10.10, 14.20, 18.10, 21.30, 24.90, 28.50]

# Latitude sweep: same 1500 km due-east path at every latitude, so the ONLY
# variable is latitude. 35N is the mid-latitude control.
SWEEP_LATS = [35, 55, 60, 65, 70, 75, 80, -55, -65, -75]
SWEEP_LON = 20.0
SWEEP_KM = 1500.0

# Real circuits whose bounces land in or above the auroral oval.
CIRCUITS = [
    ('Thule-Anadyr',        76.53, -68.70,  64.73, 177.51),
    ('Alaska-Norway',       64.80, -147.70, 69.68,  18.92),
    ('Iceland-Alaska',      64.13, -21.90,  61.17, -149.99),
    ('Norway-Japan',        69.68,  18.92,  43.06, 141.35),
    ('Greenland-Scotland',  72.58, -38.46,  57.48,  -4.22),
]

MONTHS = [1, 4, 7, 10]
SSNS = [10, 70, 150]
CONDITIONS = [(m, s) for m in MONTHS for s in SSNS]

great_circle_km = appmodel.great_circle_km
mag_lats = appmodel.mag_latitudes
secant = appmodel.path_secant


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(la1, lo1, la2, lo2, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS) + ' 0.00 0.00'
    return """COMMENT    HFCALC polar study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     POLAR               STUDY
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


def bounce_source(ssn, utc_hour, month, b):
    """(source actually used, would the OLD guard have rejected the table).

    The first value mirrors appmodel.bounce_fof2 as it ships. The second is the
    diagnostic that motivated the change: the pre-v1.24 guard demanded the
    table agree with the physical model to within MAP_SANITY_FACTOR, and this
    reports where that test would have thrown the table away. Reported
    separately so the two are never confused again.
    """
    lst = appmodel.local_solar_time(utc_hour, b[1])
    phys = appmodel.est_fof2(ssn, lst, month, b[2], b[0])
    tv = appmodel.table_fof2(b[0], b[1], month, utc_hour, ssn)

    old_would_reject = not (tv is not None and tv > 0
                            and tv <= phys * appmodel.MAP_SANITY_FACTOR
                            and tv * appmodel.MAP_SANITY_FACTOR >= phys)

    if tv is not None and appmodel.TABLE_FOF2_MIN <= tv <= appmodel.TABLE_FOF2_MAX:
        return 'table', old_would_reject
    if len(b) >= 4 and b[3] is not None:
        m = appmodel._map_eval(b[3], lst, month, ssn, b[1])
        if (m is not None and m > 0 and m <= phys * appmodel.MAP_SANITY_FACTOR
                and m * appmodel.MAP_SANITY_FACTOR >= phys):
            return 'map', old_would_reject
    return 'physics', old_would_reject


def sun_never_rises(lat, month):
    """True if the sun stays below the horizon all day at this lat/month."""
    decl = appmodel.solar_declination(month)
    return math.tan(math.radians(lat)) * math.tan(math.radians(decl)) <= -1.0


def sun_never_sets(lat, month):
    decl = appmodel.solar_declination(month)
    return math.tan(math.radians(lat)) * math.tan(math.radians(decl)) >= 1.0


def build_paths():
    paths = []
    for lat in SWEEP_LATS:
        la2, lo2 = appmodel.destination_east(lat, SWEEP_LON, SWEEP_KM)
        paths.append(('sweep%+03d' % lat, lat, SWEEP_LON, la2, lo2, 'sweep'))
    for name, la1, lo1, la2, lo2 in CIRCUITS:
        paths.append((name, la1, lo1, la2, lo2, 'circuit'))
    return paths


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows, meta = [], []
    paths = build_paths()
    print('%d paths x %d conditions = %d VOACAP runs\n'
          % (len(paths), len(CONDITIONS), len(paths) * len(CONDITIONS)))

    for name, la1, lo1, la2, lo2, kind in paths:
        dist = great_circle_km(la1, lo1, la2, lo2)
        mid = appmodel.interpolate_path(la1, lo1, la2, lo2, 0.5)
        hops = max(1, math.ceil(dist / appmodel.max_hop_km(F2_HEIGHT_KM)))
        bpts = appmodel.reflection_points(la1, lo1, la2, lo2, hops)
        ml = mag_lats([mid] + bpts)
        mid_ml, b_ml = ml[0], ml[1:]
        b_md = appmodel.modips(bpts)
        bounces = [(p[0], p[1], m, md) for p, m, md in zip(bpts, b_ml, b_md)]
        # The bounce that actually determines whether this is a polar path.
        peak_geo = max(abs(p[0]) for p in bpts)
        peak_mag = max(abs(m) for m in b_ml)
        meta.append({'path': name, 'kind': kind, 'dist_km': round(dist), 'hops': hops,
                     'peak_bounce_lat': round(peak_geo, 1),
                     'peak_bounce_mag_lat': round(peak_mag, 1),
                     'bounces': [[round(p[0], 2), round(p[1], 2), round(m, 1)]
                                 for p, m in zip(bpts, b_ml)]})
        print('%-20s %5.0f km  %d hop(s)  highest bounce %5.1f geo / %5.1f mag'
              % (name, dist, hops, peak_geo, peak_mag))

        sec = secant(dist)
        for (month, ssn) in CONDITIONS:
            open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(
                deck(la1, lo1, la2, lo2, month, ssn))
            subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
            for hour, vmuf in sorted(parse_muf(os.path.join(RUN_DIR, 'voacapx.out')).items()):
                lst = lst_of(hour, mid[1])
                m = sec
                mt = appmodel.m_factor_lookup(dist, lst, month, ssn)
                if mt is not None and mt <= sec * appmodel.MAP_SANITY_FACTOR \
                        and mt * appmodel.MAP_SANITY_FACTOR >= sec:
                    m = mt
                app = appmodel.path_fof2(ssn, hour, month, bounces,
                                         mid[1], mid[0], mid_ml) * m
                got = [bounce_source(ssn, hour, month, b) for b in bounces]
                srcs = [g[0] for g in got]
                rows.append({
                    'path': name, 'kind': kind, 'dist_km': round(dist),
                    'peak_lat': round(peak_geo, 1), 'peak_mag_lat': round(peak_mag, 1),
                    'month': month, 'ssn': ssn, 'utc': hour,
                    'voacap_muf': vmuf, 'app_muf': round(app, 2),
                    'source': 'physics' if 'physics' in srcs
                              else ('map' if 'map' in srcs else 'table'),
                    'old_guard_would_reject': any(g[1] for g in got),
                    'polar_night': sun_never_rises(peak_geo if la1 >= 0 else -peak_geo, month),
                    'polar_day': sun_never_sets(peak_geo if la1 >= 0 else -peak_geo, month),
                })

    good = [r for r in rows if r['voacap_muf'] > 0]

    def err(subset):
        e = [abs(r['app_muf'] - r['voacap_muf']) / r['voacap_muf'] * 100 for r in subset]
        return statistics.mean(e) if e else float('nan')

    def bias(subset):
        e = [(r['app_muf'] - r['voacap_muf']) / r['voacap_muf'] * 100 for r in subset]
        return statistics.mean(e) if e else float('nan')

    def med(subset):
        e = [abs(r['app_muf'] - r['voacap_muf']) / r['voacap_muf'] * 100 for r in subset]
        return statistics.median(e) if e else float('nan')

    print('\n' + '=' * 74)
    print('MUF ERROR BY LATITUDE (identical 1500 km due-east path at each)')
    print('  %-10s %6s %8s %8s %8s   %s' % ('latitude', 'n', 'mean', 'median', 'bias', 'source mix'))
    by_lat = {}
    for lat in SWEEP_LATS:
        sub = [r for r in good if r['path'] == 'sweep%+03d' % lat]
        if not sub:
            continue
        mix = {}
        for r in sub:
            mix[r['source']] = mix.get(r['source'], 0) + 1
        mixs = ' '.join('%s %d%%' % (k, round(100 * v / len(sub))) for k, v in sorted(mix.items()))
        by_lat[lat] = {'n': len(sub), 'mean': round(err(sub), 2), 'median': round(med(sub), 2),
                       'bias': round(bias(sub), 2), 'sources': mix}
        print('  %-10s %6d %7.2f%% %7.2f%% %+7.2f%%   %s'
              % ('%+d' % lat, len(sub), err(sub), med(sub), bias(sub), mixs))

    print('\n' + '=' * 74)
    print('REAL HIGH-LATITUDE CIRCUITS')
    print('  %-22s %6s %8s %8s %8s' % ('circuit', 'n', 'mean', 'median', 'bias'))
    by_circuit = {}
    for name, *_ in CIRCUITS:
        sub = [r for r in good if r['path'] == name]
        if not sub:
            continue
        by_circuit[name] = {'n': len(sub), 'mean': round(err(sub), 2),
                            'median': round(med(sub), 2), 'bias': round(bias(sub), 2)}
        print('  %-22s %6d %7.2f%% %7.2f%% %+7.2f%%'
              % (name, len(sub), err(sub), med(sub), bias(sub)))

    print('\n' + '=' * 74)
    print('BANDS (all paths, by the highest bounce on the path)')
    bands = [('control 35 deg', lambda r: r['peak_lat'] < 45),
             ('45-60 deg',      lambda r: 45 <= r['peak_lat'] < 60),
             ('60-70 deg',      lambda r: 60 <= r['peak_lat'] < 70),
             ('70-80 deg',      lambda r: 70 <= r['peak_lat'] < 80),
             ('above 80 deg',   lambda r: r['peak_lat'] >= 80)]
    by_band = {}
    for label, f in bands:
        sub = [r for r in good if f(r)]
        if not sub:
            continue
        by_band[label] = {'n': len(sub), 'mean': round(err(sub), 2),
                          'median': round(med(sub), 2), 'bias': round(bias(sub), 2)}
        print('  %-16s %6d %7.2f%% %7.2f%% %+7.2f%%'
              % (label, len(sub), err(sub), med(sub), bias(sub)))

    print('\n' + '=' * 74)
    print('POLAR DAY / POLAR NIGHT (the case no test has ever evaluated)')
    special = {}
    for label, sub in (('polar night', [r for r in good if r['polar_night']]),
                       ('polar day', [r for r in good if r['polar_day']]),
                       ('normal day/night', [r for r in good
                                             if not r['polar_night'] and not r['polar_day']])):
        if not sub:
            print('  %-18s (none in this sample)' % label)
            continue
        special[label] = {'n': len(sub), 'mean': round(err(sub), 2),
                          'median': round(med(sub), 2), 'bias': round(bias(sub), 2)}
        print('  %-18s %6d %7.2f%% %7.2f%% %+7.2f%%'
              % (label, len(sub), err(sub), med(sub), bias(sub)))

    print('\n' + '=' * 74)
    print('WHICH SOURCE SERVED THE PATH')
    by_source = {}
    for s in ('table', 'map', 'physics'):
        sub = [r for r in good if r['source'] == s]
        if not sub:
            continue
        by_source[s] = {'n': len(sub), 'mean': round(err(sub), 2), 'bias': round(bias(sub), 2)}
        print('  %-10s %6d rows (%2.0f%%)  mean %6.2f%%  bias %+6.2f%%'
              % (s, len(sub), 100 * len(sub) / len(good), err(sub), bias(sub)))

    print('\n' + '=' * 74)
    print('ROWS THE PRE-v1.24 GUARD WOULD HAVE SENT TO THE PHYSICAL MODEL')
    rej = [r for r in good if r['old_guard_would_reject']]
    kept = [r for r in good if not r['old_guard_would_reject']]
    guard = {}
    for label, sub in (('would have been rejected', rej), ('would have been kept', kept)):
        if not sub:
            continue
        guard[label] = {'n': len(sub), 'mean': round(err(sub), 2), 'bias': round(bias(sub), 2)}
        print('  %-26s %6d rows (%2.0f%%)  now %6.2f%%  bias %+6.2f%%'
              % (label, len(sub), 100 * len(sub) / len(good), err(sub), bias(sub)))

    overall = {'n': len(good), 'mean': round(err(good), 2), 'median': round(med(good), 2),
               'bias': round(bias(good), 2)}
    highlat = [r for r in good if r['peak_lat'] >= 60]
    control = [r for r in good if r['peak_lat'] < 45]
    print('\n  ALL %d rows: mean %.2f%%  median %.2f%%  bias %+.2f%%'
          % (len(good), err(good), med(good), bias(good)))
    if highlat and control:
        print('  above 60 deg: %.2f%%   vs mid-latitude control: %.2f%%'
              % (err(highlat), err(control)))

    out = {
        'generated_by': 'scripts/validation/studies/run_polar_study.py',
        'voacap_method': 30, 'coeffs': 'CCIR',
        'months': MONTHS, 'ssns': SSNS,
        'sweep': {'lats': SWEEP_LATS, 'lon': SWEEP_LON, 'dist_km': SWEEP_KM},
        'paths': meta,
        'by_latitude': by_lat, 'by_circuit': by_circuit, 'by_band': by_band,
        'polar_day_night': special, 'by_source': by_source, 'old_guard': guard,
        'overall': overall,
        'high_latitude_mean': round(err(highlat), 2) if highlat else None,
        'control_mean': round(err(control), 2) if control else None,
        'rows': rows,
    }
    with open(os.path.join(OUT_DIR, 'polar-results.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
    print('\nwrote docs/validation/polar-results.json (%d rows)' % len(rows))


if __name__ == '__main__':
    run()
