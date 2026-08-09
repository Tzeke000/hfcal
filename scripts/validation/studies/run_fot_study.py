#!/usr/bin/env python3
"""Validate the FOT convention (FOT = 0.85 x MUF) against VOACAP.

The FOT — Frequency of Optimum Traffic — is the number the app puts in the
middle column and tells the operator to aim at. It has always been computed
from the textbook rule of thumb, 85% of the MUF, and never checked.

It is checkable. VOACAP reports MUFday for every frequency: the fraction of
days in the month that frequency stays below the path MUF, i.e. the fraction
of days it works. Two facts fall straight out of that:

  * At the MUF itself, MUFday = 0.50 by definition — the MUF is the MEDIAN
    maximum usable frequency, working half the days of the month. That is a
    free correctness check on the whole method.
  * The FOT is conventionally the frequency good 90% of days. So the true FOT
    ratio is simply the frequency where MUFday crosses 0.90, divided by the
    MUF.

This script measures that ratio directly across distance, season, solar
activity and hour, instead of assuming 0.85.

Why it matters operationally: if the real 90%-reliable frequency is well below
0.85 x MUF, the app has been telling Marines to aim too high — and a frequency
picked too near the MUF is exactly the one that fails on the days the
ionosphere is a little below its monthly median.

Output: docs/validation/fot-results.json

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

# Spread across the whole HF band so the MUFday curve is sampled either side
# of the crossing at every hour, from a 5 MHz night MUF to a 28 MHz noon one.
FREQS = [3.0, 5.0, 7.0, 9.0, 12.0, 15.0, 18.0, 21.0, 24.0, 27.0, 30.0]

DISTANCES_KM = [500, 1500, 3000, 6000]
CONDITIONS = [(1, 30), (1, 100), (7, 30), (7, 100)]
TX_LAT, TX_LON = 34.90, -76.88

TARGET_RELIABILITY = 0.90     # the classic definition of the FOT


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(rx_lat, rx_lon, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS)
    return """COMMENT    HFCALC FOT study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     FOT                 STUDY
CIRCUIT   %6s%10s%10s%10s  S     0
SYSTEM       1. 145. 0.10  90. 38.0 3.00 0.10
FPROB      1.00 1.00 1.00 0.00
ANTENNA       1    1    2   30     0.000[default/isotrope     ]  0.0    0.0200
ANTENNA       2    2    2   30     0.000[default/isotrope     ]  0.0    0.0000
FREQUENCY %s
METHOD       30    0
EXECUTE
QUIT
""" % (month, ssn, fmt(TX_LAT, 'N', 'S'), fmt(TX_LON, 'E', 'W'),
       fmt(rx_lat, 'N', 'S'), fmt(rx_lon, 'E', 'W'), fs)


def parse(path):
    """{utc_hour: (muf, [mufday per frequency])}"""
    out, hour, muf = {}, None, None
    for line in open(path, errors='replace').read().splitlines():
        t = line.rstrip()
        if t.endswith('FREQ'):
            vals = line.split()[:-1]
            try:
                hour, muf = int(round(float(vals[0]))), float(vals[1])
            except (ValueError, IndexError):
                hour = muf = None
        elif t.endswith('MUFday') and hour is not None:
            toks = line.split()[:-1]
            vals = []
            for tk in toks:
                try:
                    vals.append(float(tk))
                except ValueError:
                    vals.append(None)
            # First column is the MUF itself; the rest line up with FREQS.
            out[hour] = (muf, vals[1:1 + len(FREQS)])
            hour = muf = None
    return out


def crossing(mufday):
    """Frequency where MUFday falls through the target, linearly interpolated."""
    prev_f = prev_v = None
    for f, v in zip(FREQS, mufday):
        if v is None:
            continue
        if v < TARGET_RELIABILITY:
            if prev_v is None or prev_v <= TARGET_RELIABILITY:
                return None          # already below at the bottom of the grid
            span = prev_v - v
            if span <= 0:
                return prev_f
            return prev_f + (prev_v - TARGET_RELIABILITY) / span * (f - prev_f)
        prev_f, prev_v = f, v
    return None                      # never drops below inside the grid


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows, sanity = [], []
    for dist in DISTANCES_KM:
        rx = appmodel.destination_east(TX_LAT, TX_LON, dist)
        mid = appmodel.path_midpoint(TX_LAT, TX_LON, rx[0], rx[1])
        for (month, ssn) in CONDITIONS:
            open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(deck(rx[0], rx[1], month, ssn))
            subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
            for hour, (muf, mufday) in sorted(parse(os.path.join(RUN_DIR, 'voacapx.out')).items()):
                if not muf or muf <= 0:
                    continue
                fot = crossing(mufday)
                if fot is None:
                    continue
                lst = appmodel.local_solar_time(hour, mid[1])
                rows.append({'dist_km': dist, 'month': month, 'ssn': ssn, 'utc': hour,
                             'lst': round(lst, 2), 'muf': muf, 'fot_90': round(fot, 3),
                             'ratio': round(fot / muf, 4),
                             'mufday': mufday,
                             'illum': round(appmodel.illumination_factor(mid[0], lst, month), 4)})
        print('%5d km done (%d samples)' % (dist, len(rows)))

    if not rows:
        print('no usable samples')
        return 1

    ratios = [r['ratio'] for r in rows]
    print('\n%d samples' % len(rows))
    print('\nMEASURED FOT RATIO  (frequency good %d%% of days, over the MUF)'
          % round(TARGET_RELIABILITY * 100))
    print('  mean   %.3f' % statistics.mean(ratios))
    print('  median %.3f' % statistics.median(ratios))
    print('  10-90  %.3f - %.3f' % (sorted(ratios)[len(ratios) // 10],
                                    sorted(ratios)[9 * len(ratios) // 10]))
    print('  app currently assumes 0.850')

    print('\nby distance')
    for d in DISTANCES_KM:
        sub = [r['ratio'] for r in rows if r['dist_km'] == d]
        if sub:
            print('  %5d km  median %.3f  (n=%d)' % (d, statistics.median(sub), len(sub)))
    print('\nday vs night')
    for lo, hi, lbl in [(0.0, 0.05, 'night   '), (0.05, 0.4, 'twilight'), (0.4, 1.1, 'daylight')]:
        sub = [r['ratio'] for r in rows if lo <= r['illum'] < hi]
        if sub:
            print('  %s median %.3f  (n=%d)' % (lbl, statistics.median(sub), len(sub)))

    # ── reliability curve ───────────────────────────────────────────────────
    # Day-to-day foF2 varies roughly log-normally about the monthly median, so
    # the fraction of days a frequency works should be
    #     REL(f) = Phi( ln(MUF/f) / sigma )
    # which is 0.50 at f = MUF by construction. One parameter, and it is not
    # free either: it is fixed by the measured FOT ratio above, since
    #     sigma = ln(1/ratio) / Phi^-1(0.90)
    def phi(z):
        return 0.5 * (1 + math.erf(z / math.sqrt(2)))

    med_ratio = statistics.median(ratios)
    sigma_from_fot = math.log(1 / med_ratio) / 1.2816
    print('\nRELIABILITY CURVE   REL(f) = Phi( ln(MUF/f) / sigma )')
    print('  sigma implied by the measured FOT ratio: %.4f' % sigma_from_fot)

    def curve_err(sig):
        e = []
        for r in rows:
            for f, v in zip(FREQS, r['mufday']):
                if v is None or f <= 0:
                    continue
                e.append(abs(phi(math.log(r['muf'] / f) / sig) - v))
        return statistics.mean(e)

    best_sig = min([x / 1000 for x in range(120, 420, 5)], key=curve_err)
    print('  mean absolute error at that sigma:   %.4f' % curve_err(sigma_from_fot))
    print('  best-fit sigma %.4f gives            %.4f' % (best_sig, curve_err(best_sig)))
    print('  (using the FOT-implied sigma keeps one number doing both jobs)')

    json.dump({'target_reliability': TARGET_RELIABILITY, 'freqs': FREQS,
               'sigma_from_fot': round(sigma_from_fot, 4),
               'sigma_best_fit': round(best_sig, 4),
               'curve_err_from_fot': round(curve_err(sigma_from_fot), 4),
               'curve_err_best': round(curve_err(best_sig), 4),
               'measured': {'mean': round(statistics.mean(ratios), 4),
                            'median': round(statistics.median(ratios), 4),
                            'n': len(rows)},
               'rows': rows}, open(os.path.join(OUT_DIR, 'fot-results.json'), 'w'))
    print('\nwrote docs/validation/fot-results.json')


if __name__ == '__main__':
    sys.exit(run())
