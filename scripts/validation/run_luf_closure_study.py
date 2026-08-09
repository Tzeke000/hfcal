#!/usr/bin/env python3
"""Does the PATH CLOSED banner fire when it should - and only then?

Part 20 raised the LUF on long paths, in some cases by a lot: a 2500 km noon
path went from 5.5 MHz to 12.4. That was the right correction to the physics,
but it has a user-facing consequence that Part 20 did not check.

The app declares PATH CLOSED AT THIS POWER when its LUF exceeds its MUF. That
banner tells a Marine that no frequency will work. A FALSE one is the worst
output this app can produce - worse than a wrong frequency, because it says
"do not bother" about a path that would have carried traffic. Raising the LUF
without measuring the false-closure rate would have been reckless.

This script measures it. VOACAP's reliability output is censored - that is why
Part 20 had to use the loss curves instead - but censoring is exactly what is
being tested here, so the censoring IS the signal:

    ground truth CLOSED  <=>  no frequency in the grid reaches the required
                              reliability at this power
    app says CLOSED      <=>  app LUF > app MUF

Two numbers matter, and they are not symmetric:

    FALSE CLOSED   app says closed, VOACAP says a frequency works.
                   The dangerous one. Should be near zero.
    FALSE OPEN     app says open, VOACAP says nothing works.
                   Costs the operator a wasted call, not a missed one.

SECOND QUESTION, same VOACAP runs: Part 20 calibrated absorption on ONE-HOP
paths only, to keep ground-reflection loss out of the fit, and then applied
`hops` as a plain linear multiplier to everything. That assumption has never
been tested. The multi-hop paths here fit A the same way Part 20 did and check
it against sec(phi_D) * (A0 + K*I^0.75) * hops.

Output: docs/validation/luf-closure-results.json

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

TX_LAT, TX_LON = 34.90, -76.88
FH_MHZ = 1.2
F2_HEIGHT_KM = 360.0
REQ_REL = 0.90
REQ_SNR_DB = 38.0                       # SSB voice, not VOACAP's 73 dB-Hz default

FREQS = [2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 11.0, 15.0, 20.0, 25.0, 30.0]

# Spans one hop through four. The long ones are the point: that is where the
# LUF moved and where `hops` is doing work that has never been checked.
DISTANCES = [300, 800, 1500, 2500, 4000, 6000, 8000, 11000]
MONTHS = [1, 4, 7, 10]
SSNS = [10, 70, 150]
POWERS_W = [2, 20, 150]                 # PRC-160 LOW, GLOBAL, and the VRC amp


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(rx_lat, rx_lon, month, ssn, watts):
    fs = ''.join('%5.2f' % f for f in FREQS)
    return """COMMENT    HFCALC LUF closure study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     CLOSURE             STUDY
CIRCUIT   %6s%10s%10s%10s  S     0
SYSTEM       1. 145. 0.10  90.%5.1f 3.00 0.10
FPROB      1.00 1.00 1.00 0.00
ANTENNA       1    1    2   30     0.000[default/isotrope     ]  0.0%10.4f
ANTENNA       2    2    2   30     0.000[default/isotrope     ]  0.0    0.0000
FREQUENCY %s
METHOD       30    0
EXECUTE
QUIT
""" % (month, ssn, fmt(TX_LAT, 'N', 'S'), fmt(TX_LON, 'E', 'W'),
       fmt(rx_lat, 'N', 'S'), fmt(rx_lon, 'E', 'W'), REQ_SNR_DB, watts / 1000.0, fs)


def parse(path):
    """{hour: {freqs, rel, loss, mufday, muf}}."""
    out, cur = {}, None
    for line in open(path, errors='replace').read().splitlines():
        t = line.rstrip()
        if t.endswith('FREQ'):
            v = line.split()[:-1]
            try:
                hour = int(round(float(v[0])))
            except (ValueError, IndexError):
                cur = None
                continue
            cur = {'muf': float(v[1]), 'freqs': [float(x) for x in v[2:]],
                   'rel': None, 'loss': None, 'mufday': None}
            out[hour] = cur
        elif cur is not None and t.endswith('REL'):
            cur['rel'] = [_num(x) for x in line.split()[:-1]]
        elif cur is not None and t.endswith('LOSS'):
            cur['loss'] = [_num(x) for x in line.split()[:-1]]
        elif cur is not None and t.endswith('MUFday'):
            cur['mufday'] = [_num(x) for x in line.split()[:-1]]
    return out


def _num(x):
    try:
        return float(x)
    except ValueError:
        return None


def fit_A(freqs, loss, usable):
    xs, ys = [], []
    for f, L, ok in zip(freqs, loss, usable):
        if not ok or L is None or f <= 0:
            continue
        xs.append(1.0 / (f + FH_MHZ) ** 2)
        ys.append(L - 20.0 * math.log10(f))
    n = len(xs)
    if n < 4:
        return None
    sx = sum(xs); sxx = sum(x * x for x in xs); sy = sum(ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    det = n * sxx - sx * sx
    if abs(det) < 1e-12:
        return None
    A = (n * sxy - sx * sy) / det
    C = (sy - A * sx) / n
    rms = math.sqrt(sum((y - (A * x + C)) ** 2 for x, y in zip(xs, ys)) / n)
    return A, rms


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows, multihop = [], []
    total = len(DISTANCES) * len(MONTHS) * len(SSNS) * len(POWERS_W)
    done = 0

    for dist in DISTANCES:
        rx_lat, rx_lon = appmodel.destination_east(TX_LAT, TX_LON, dist)
        mid = appmodel.path_midpoint(TX_LAT, TX_LON, rx_lat, rx_lon)
        hops = max(1, math.ceil(dist / appmodel.max_hop_km(F2_HEIGHT_KM)))
        bpts = appmodel.reflection_points(TX_LAT, TX_LON, rx_lat, rx_lon, hops)
        b_ml = appmodel.mag_latitudes(bpts)
        b_md = appmodel.modips(bpts)
        bounces = [(p[0], p[1], m, md) for p, m, md in zip(bpts, b_ml, b_md)]
        mid_ml = appmodel.mag_latitudes([mid])[0]

        for month in MONTHS:
            for ssn in SSNS:
                for watts in POWERS_W:
                    open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(
                        deck(rx_lat, rx_lon, month, ssn, watts))
                    subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
                    res = parse(os.path.join(RUN_DIR, 'voacapx.out'))
                    done += 1

                    for hour, d in sorted(res.items()):
                        if d['rel'] is None:
                            continue
                        # Ground truth: does ANY frequency close the link?
                        best = max([r for r in d['rel'] if r is not None] or [0.0])
                        voacap_closed = best < REQ_REL

                        # The app's own two numbers, exactly as it computes them.
                        muf = appmodel.app_muf(dist, hour, ssn, mid[1], month,
                                               mid_ml, mid[0], bounces)
                        # Illumination is taken at the D-layer crossings, which
                        # is what the app does — averaged over the endpoints.
                        illum = statistics.mean([
                            appmodel.illumination_factor(
                                lat, appmodel.local_solar_time(hour, lon), month)
                            for lat, lon in ((TX_LAT, TX_LON), (rx_lat, rx_lon))])
                        luf = appmodel.estimate_luf(illum, watts, hops, dist)
                        app_closed = luf > muf

                        rows.append({
                            'dist_km': dist, 'hops': hops, 'month': month, 'ssn': ssn,
                            'watts': watts, 'utc': hour,
                            'app_muf': round(muf, 2), 'app_luf': round(luf, 2),
                            'app_closed': app_closed,
                            'voacap_best_rel': round(best, 3),
                            'voacap_closed': voacap_closed,
                        })

                        # Multi-hop absorption check, same runs.
                        if hops > 1 and d['loss'] and d['mufday']:
                            usable = [(md is not None and md >= 0.9) for md in d['mufday']]
                            got = fit_A(d['freqs'], d['loss'], usable)
                            if got and got[1] < 2.0 and got[0] > 0:
                                sec = appmodel.d_layer_obliquity(dist / hops)
                                pred = sec * (appmodel.LUF_A_NIGHT
                                              + appmodel.LUF_K * illum ** 0.75) * hops
                                multihop.append({
                                    'dist_km': dist, 'hops': hops, 'illum': round(illum, 3),
                                    'voacap_A': round(got[0], 1), 'model_A': round(pred, 1),
                                })
                    print('  %5d km  m%2d ssn%3d %4dW   (%d/%d)'
                          % (dist, month, ssn, watts, done, total))

    if not rows:
        print('NO ROWS')
        return

    def rate(sub, f):
        return 100.0 * sum(1 for r in sub if f(r)) / len(sub) if sub else float('nan')

    print('\n' + '=' * 74)
    print('PATH CLOSED: does the banner agree with VOACAP?')
    print('  %-14s %6s %10s %12s %12s' % ('subset', 'n', 'agree', 'FALSE CLOSED', 'false open'))

    def report(label, sub, store):
        if not sub:
            return
        agree = rate(sub, lambda r: r['app_closed'] == r['voacap_closed'])
        fc = rate(sub, lambda r: r['app_closed'] and not r['voacap_closed'])
        fo = rate(sub, lambda r: not r['app_closed'] and r['voacap_closed'])
        store[label] = {'n': len(sub), 'agree': round(agree, 1),
                        'false_closed': round(fc, 1), 'false_open': round(fo, 1)}
        print('  %-14s %6d %9.1f%% %11.1f%% %11.1f%%' % (label, len(sub), agree, fc, fo))

    by_all, by_power, by_dist = {}, {}, {}
    report('ALL', rows, by_all)
    for w in POWERS_W:
        report('%d W' % w, [r for r in rows if r['watts'] == w], by_power)
    for dkm in DISTANCES:
        report('%d km' % dkm, [r for r in rows if r['dist_km'] == dkm], by_dist)

    print('\n  FALSE CLOSED is the one that matters: the app telling a Marine')
    print('  no frequency works when VOACAP says one does.')

    print('\n' + '=' * 74)
    print('IS `hops` REALLY A LINEAR MULTIPLIER? (never tested before now)')
    if multihop:
        print('  %-8s %6s %8s %11s %11s %8s' % ('dist', 'hops', 'n', 'A VOACAP', 'A model', 'ratio'))
        by_hops = {}
        for h in sorted({m['hops'] for m in multihop}):
            for dkm in sorted({m['dist_km'] for m in multihop if m['hops'] == h}):
                sub = [m for m in multihop if m['hops'] == h and m['dist_km'] == dkm]
                lit = [m for m in sub if m['illum'] > 0.3] or sub
                r = statistics.median([m['model_A'] / m['voacap_A'] for m in lit])
                by_hops['%dkm_%dhop' % (dkm, h)] = {
                    'n': len(lit), 'voacap_A': round(statistics.median(m['voacap_A'] for m in lit), 1),
                    'model_A': round(statistics.median(m['model_A'] for m in lit), 1),
                    'model_over_voacap': round(r, 2)}
                print('  %-8d %6d %8d %11.1f %11.1f %8.2f'
                      % (dkm, h, len(lit), statistics.median(m['voacap_A'] for m in lit),
                         statistics.median(m['model_A'] for m in lit), r))
        allr = statistics.median([m['model_A'] / m['voacap_A'] for m in multihop
                                  if m['illum'] > 0.3] or [1])
        print('  overall model/VOACAP on multi-hop: %.2f' % allr)
        print('  (1.00 = the linear `hops` assumption holds; >1 = app over-charges)')
    else:
        by_hops = {}
        print('  no clean multi-hop fits')

    out = {
        'generated_by': 'scripts/validation/run_luf_closure_study.py',
        'req_rel': REQ_REL, 'req_snr_db': REQ_SNR_DB, 'freqs': FREQS,
        'distances_km': DISTANCES, 'months': MONTHS, 'ssns': SSNS, 'powers_w': POWERS_W,
        'closure_all': by_all, 'closure_by_power': by_power, 'closure_by_distance': by_dist,
        'multihop_absorption': by_hops,
        'rows': rows,
    }
    with open(os.path.join(OUT_DIR, 'luf-closure-results.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
    print('\nwrote docs/validation/luf-closure-results.json (%d rows)' % len(rows))


if __name__ == '__main__':
    run()
