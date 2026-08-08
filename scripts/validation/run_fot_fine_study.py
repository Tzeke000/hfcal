#!/usr/bin/env python3
"""Re-measure the FOT ratio on a FINE frequency grid.

Part 11 changed the app's most operator-facing number — the frequency to aim
at — on the strength of a coarse measurement. The grid there ran 3, 5, 7, 9,
12, 15, 18, 21, 24, 27, 30 MHz: steps of 2-3 MHz, with the 90%-reliability
crossing found by linear interpolation between two widely spaced points. On a
12 MHz MUF a single grid interval is a quarter of the whole answer. That is
not good enough for a number that decides what an operator transmits on.

This run fixes the resolution three ways:

  1. TWO PASSES. A coarse pass finds the MUF for every hour; a second pass
     then places all eleven frequencies between 0.55 and 1.00 of THAT hour's
     MUF, so the grid is dense exactly where the crossing lives.
  2. ONE HOUR PER DECK. The frequency set can only be tuned per hour if each
     hour is its own run, so it is.
  3. RATIO GRID. Frequencies are placed at fixed fractions of the MUF, so
     every sample measures the ratio directly with the same resolution
     regardless of whether the MUF is 5 MHz or 28.

It also measures the other direction: what reliability does the textbook
0.85 x MUF actually deliver? Part 11 answered that from 24 samples on one
path. Here it comes from the whole matrix.

Output: docs/validation/fot-fine-results.json

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

COARSE = [3.0, 5.0, 7.0, 9.0, 12.0, 15.0, 18.0, 21.0, 24.0, 27.0, 30.0]
# Fractions of the MUF for the fine pass — 4.5% steps through the region where
# reliability falls from ~1.0 to 0.5.
FRACTIONS = [0.55, 0.60, 0.645, 0.69, 0.735, 0.78, 0.82, 0.86, 0.90, 0.95, 1.00]

DISTANCES_KM = [500, 1500, 3000, 6000]
CONDITIONS = [(1, 30), (1, 100), (7, 30), (7, 100)]
HOURS = list(range(0, 24, 2))          # every second hour keeps the run bounded
TX_LAT, TX_LON = 34.90, -76.88
TARGET = 0.90
TEXTBOOK = 0.85


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(rx_lat, rx_lon, month, ssn, freqs, h0, h1):
    fs = ''.join('%5.2f' % min(f, 99.99) for f in freqs)
    return """COMMENT    HFCALC fine FOT study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME       %4d %4d    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     FOTFINE             STUDY
CIRCUIT   %6s%10s%10s%10s  S     0
SYSTEM       1. 145. 0.10  90. 38.0 3.00 0.10
FPROB      1.00 1.00 1.00 0.00
ANTENNA       1    1    2   30     0.000[default/isotrope     ]  0.0    0.0200
ANTENNA       2    2    2   30     0.000[default/isotrope     ]  0.0    0.0000
FREQUENCY %s
METHOD       30    0
EXECUTE
QUIT
""" % (h0, h1, month, ssn, fmt(TX_LAT, 'N', 'S'), fmt(TX_LON, 'E', 'W'),
       fmt(rx_lat, 'N', 'S'), fmt(rx_lon, 'E', 'W'), fs)


def parse(path):
    out, hour, muf = {}, None, None
    for line in open(path, errors='replace').read().splitlines():
        t = line.rstrip()
        if t.endswith('FREQ'):
            v = line.split()[:-1]
            try:
                hour, muf = int(round(float(v[0]))), float(v[1])
            except (ValueError, IndexError):
                hour = muf = None
        elif t.endswith('MUFday') and hour is not None:
            vals = []
            for tk in line.split()[:-1]:
                try:
                    vals.append(float(tk))
                except ValueError:
                    vals.append(None)
            out[hour] = (muf, vals[1:])
            hour = muf = None
    return out


def run_deck(*a):
    open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(deck(*a))
    subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
    return parse(os.path.join(RUN_DIR, 'voacapx.out'))


def interp_at(xs, ys, target, descending=True):
    """x where y crosses target, linear between the bracketing samples."""
    prev_x = prev_y = None
    for x, y in zip(xs, ys):
        if y is None:
            continue
        if prev_y is not None and ((prev_y >= target >= y) or (prev_y <= target <= y)):
            span = prev_y - y
            if abs(span) < 1e-12:
                return x
            return prev_x + (prev_y - target) / span * (x - prev_x)
        prev_x, prev_y = x, y
    return None


def value_at(xs, ys, x0):
    """y at x0, linearly interpolated."""
    prev_x = prev_y = None
    for x, y in zip(xs, ys):
        if y is None:
            continue
        if x >= x0:
            if prev_x is None:
                return y
            return prev_y + (y - prev_y) * (x0 - prev_x) / (x - prev_x)
        prev_x, prev_y = x, y
    return prev_y


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for dist in DISTANCES_KM:
        rx = appmodel.destination_east(TX_LAT, TX_LON, dist)
        mid = appmodel.path_midpoint(TX_LAT, TX_LON, rx[0], rx[1])
        for (month, ssn) in CONDITIONS:
            coarse = run_deck(rx[0], rx[1], month, ssn, COARSE, 1, 24)
            for hour in HOURS:
                if hour not in coarse:
                    continue
                muf = coarse[hour][0]
                if not muf or muf < 2 or muf > 45:
                    continue
                freqs = [round(muf * fr, 2) for fr in FRACTIONS]
                fine = run_deck(rx[0], rx[1], month, ssn, freqs, hour, hour)
                if hour not in fine:
                    continue
                muf2, mufday = fine[hour]
                md = mufday[:len(FRACTIONS)]
                # Ratio at which reliability falls through 0.90.
                ratio = interp_at(FRACTIONS, md, TARGET)
                # Reliability the textbook 0.85 actually delivers.
                rel85 = value_at(FRACTIONS, md, TEXTBOOK)
                lst = appmodel.local_solar_time(hour, mid[1])
                rows.append({'dist_km': dist, 'month': month, 'ssn': ssn, 'utc': hour,
                             'muf': muf2 or muf, 'ratio': ratio, 'rel_at_085': rel85,
                             'illum': round(appmodel.illumination_factor(mid[0], lst, month), 4),
                             'mufday': md})
        print('%5d km done (%d samples)' % (dist, len(rows)))

    good = [r for r in rows if r['ratio'] is not None]
    print('\n%d samples, %d with a clean 0.90 crossing inside the fine grid'
          % (len(rows), len(good)))
    if not good:
        return 1

    rs = [r['ratio'] for r in good]
    srt = sorted(rs)
    print('\nFOT RATIO on the fine grid (resolution 4.5%% of MUF, was 20-25%%)')
    print('  mean   %.3f' % statistics.mean(rs))
    print('  median %.3f' % statistics.median(rs))
    for p in (10, 25, 75, 90):
        print('  p%-3d   %.3f' % (p, srt[int(p / 100 * len(srt))]))
    print('  coarse study said 0.740 ; app currently ships 0.74')

    r85 = [r['rel_at_085'] for r in rows if r['rel_at_085'] is not None]
    if r85:
        print('\nRELIABILITY DELIVERED BY THE TEXTBOOK 0.85 x MUF')
        print('  n=%d  mean %.3f  median %.3f   (the FOT is meant to be 0.90)'
              % (len(r85), statistics.mean(r85), statistics.median(r85)))

    print('\nby distance')
    for d in DISTANCES_KM:
        sub = [r['ratio'] for r in good if r['dist_km'] == d]
        if sub:
            print('  %5d km  median %.3f  (n=%d)' % (d, statistics.median(sub), len(sub)))
    print('\nby illumination')
    for lo, hi, lbl in [(0.0, 0.05, 'night   '), (0.05, 0.4, 'twilight'), (0.4, 1.1, 'daylight')]:
        sub = [r['ratio'] for r in good if lo <= r['illum'] < hi]
        if sub:
            print('  %s median %.3f  (n=%d)' % (lbl, statistics.median(sub), len(sub)))

    json.dump({'fractions': FRACTIONS, 'target': TARGET,
               'measured': {'mean': round(statistics.mean(rs), 4),
                            'median': round(statistics.median(rs), 4), 'n': len(good)},
               'rel_at_085': (round(statistics.mean(r85), 4) if r85 else None),
               'rows': rows}, open(os.path.join(OUT_DIR, 'fot-fine-results.json'), 'w'))
    print('\nwrote docs/validation/fot-fine-results.json')


if __name__ == '__main__':
    sys.exit(run())
