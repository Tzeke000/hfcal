#!/usr/bin/env python3
"""Measure the M-FACTOR directly, instead of deriving it from a fixed height.

With foF2 now accurate to 1.2% (Part 15), the remaining 5-6.5% of end-to-end
MUF error is geometry. The whole geometric chain reduces to one number:

    MUF = foF2 x M,     M = the oblique-incidence multiplier

which the app currently DERIVES from a chain of assumptions — hop count from a
fixed maximum hop, takeoff angle from curved-earth geometry at a fixed 360 km
virtual height, then the secant law at that same height. VOACAP's own V HITE
output runs 275-460 km, so a single height cannot be right everywhere, and any
error in it is multiplied straight into every MUF the app reports.

But M is now MEASURABLE. VOACAP gives the path MUF; the table gives foF2 at
the reflection points to 1.2%; so

    M_measured = MUF_voacap / min(foF2 at the bounces)

can be read off directly across distance, and compared with what the app
computes. Three things get checked at once:

  1. Does the app pick the same NUMBER OF HOPS VOACAP does? A hop-count
     disagreement is not a small error — it changes the takeoff angle by tens
     of degrees and the M-factor with it.
  2. How does the measured M compare with the secant law at 360 km?
  3. Does M depend on anything besides distance — time of day, solar activity,
     latitude? If it does not, a single curve in distance fixes the geometry
     outright.

Output: docs/validation/mfactor-results.json

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import re
import statistics
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import appmodel  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ITSHFBC = os.path.expanduser('~/itshfbc')
RUN_DIR = os.path.join(ITSHFBC, 'run')
OUT_DIR = os.path.join(ROOT, 'docs', 'validation')

FREQS = [3.0, 5.0, 7.0, 10.0, 14.0, 18.0, 22.0, 26.0, 30.0]

# Fine through the single-hop range where the takeoff angle changes fastest,
# and out past the two- and three-hop transitions.
DISTANCES = ([250, 400, 550, 700, 850, 1000, 1200, 1400, 1600, 1800, 2000]
             + [2250, 2500, 2750, 3000, 3300, 3600, 3900, 4200, 4500]
             + [5000, 5500, 6000, 6500, 7000, 7500, 8000, 9000, 10000])

# A few well-separated origins, to test whether M is site-independent.
SITES = [(34.90, -76.88), (60.00, 25.00), (10.00, -60.00), (-34.00, 18.00)]
CONDITIONS = [(1, 30), (7, 100)]

def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(la1, lo1, la2, lo2, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS) + ' 0.00 0.00'
    return """COMMENT    HFCALC M-factor study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     MFACTOR             STUDY
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


def parse(path):
    """{hour: (muf, dominant mode, median virtual height)}"""
    out, hour, muf, mode = {}, None, None, None
    for line in open(path, errors='replace').read().splitlines():
        t = line.rstrip()
        if t.endswith('FREQ'):
            v = line.split()[:-1]
            try:
                hour, muf = int(round(float(v[0]))), float(v[1])
            except (ValueError, IndexError):
                hour = muf = None
            mode = None
        elif hour is not None and t.endswith('MODE'):
            mode = appmodel.dominant_mode(line)
        elif hour is not None and t.endswith('V HITE'):
            vals = []
            for tk in line.split()[:-2]:
                try:
                    vals.append(float(tk))
                except ValueError:
                    pass
            vh = statistics.median(vals[1:]) if len(vals) > 1 else None
            if muf and muf > 0 and mode:
                out[hour] = (muf, mode, vh)
            hour = muf = mode = None
    return out


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for (la, lo) in SITES:
        for dist in DISTANCES:
            rx = appmodel.destination_east(la, lo, float(dist))
            app_hops = max(1, math.ceil(dist / appmodel.max_hop_km(appmodel.F2_HEIGHT_KM)))
            pts = appmodel.reflection_points(la, lo, rx[0], rx[1], app_hops)
            for (month, ssn) in CONDITIONS:
                open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(
                    deck(la, lo, rx[0], rx[1], month, ssn))
                subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
                for hour, (muf, mode, vh) in sorted(parse(os.path.join(RUN_DIR, 'voacapx.out')).items()):
                    # foF2 at the app's own reflection points, from the table.
                    f2 = min(appmodel.table_fof2(p[0], p[1], month, hour, ssn) or 0
                             for p in pts)
                    if f2 <= 0:
                        continue
                    rows.append({'lat': la, 'lon': lo, 'dist_km': dist,
                                 'month': month, 'ssn': ssn, 'utc': hour,
                                 'muf': muf, 'fof2': round(f2, 3),
                                 'm_meas': round(muf / f2, 4),
                                 'm_app': round(appmodel.path_secant(float(dist)), 4),
                                 'voacap_mode': mode, 'app_hops': app_hops,
                                 'voacap_hops': int(mode[0]) if mode else None,
                                 'voacap_layer': mode[1:] if mode else None,
                                 'v_hite': vh})
        print('site %6.1f,%7.1f done (%d rows)' % (la, lo, len(rows)), flush=True)

    print('\n%d samples' % len(rows))

    # ── 0. which LAYER does VOACAP actually use? ────────────────────────────
    print('\nLAYER VOACAP CHOSE (the app assumes F2 always)')
    layers = {}
    for r in rows:
        layers[r['voacap_layer']] = layers.get(r['voacap_layer'], 0) + 1
    for k, v in sorted(layers.items(), key=lambda x: -x[1]):
        print('  %-4s %5d  (%.0f%%)' % (k, v, 100 * v / len(rows)))

    # ── 1. hop-count agreement ──────────────────────────────────────────────
    print('\nHOP COUNT: does the app agree with VOACAP?')
    agree = [r for r in rows if r['voacap_hops'] == r['app_hops']]
    print('  agree on %d of %d (%.0f%%)' % (len(agree), len(rows), 100 * len(agree) / len(rows)))
    print('  %-9s %-10s %-10s %s' % ('dist', 'app hops', 'VOACAP mode', 'agree'))
    for d in DISTANCES:
        sub = [r for r in rows if r['dist_km'] == d]
        if not sub:
            continue
        modes = {}
        for r in sub:
            modes[r['voacap_mode']] = modes.get(r['voacap_mode'], 0) + 1
        top = max(modes, key=modes.get)
        ok = sum(1 for r in sub if r['voacap_hops'] == r['app_hops'])
        print('  %6d km %-10d %-10s %3.0f%%' % (d, sub[0]['app_hops'], top, 100 * ok / len(sub)))

    # ── 2. measured M vs the secant law at 360 km ───────────────────────────
    print('\nM-FACTOR: measured vs the app (secant law at 360 km)')
    print('  %-9s %9s %9s %8s %9s' % ('dist', 'measured', 'app', 'err', 'V HITE'))
    for d in DISTANCES:
        sub = [r for r in rows if r['dist_km'] == d]
        if not sub:
            continue
        mm = statistics.median(r['m_meas'] for r in sub)
        ma = sub[0]['m_app']
        vh = [r['v_hite'] for r in sub if r['v_hite']]
        print('  %6d km %9.3f %9.3f %7.1f%% %8s'
              % (d, mm, ma, 100 * (ma - mm) / mm,
                 ('%.0f' % statistics.median(vh)) if vh else '-'))

    # ── 3. does M depend on anything but distance? ──────────────────────────
    print('\nIs M distance-only? (spread of measured M within each distance)')
    for key, label in (('ssn', 'solar activity'), ('lat', 'site latitude')):
        worst = 0.0
        for d in DISTANCES:
            sub = [r for r in rows if r['dist_km'] == d]
            groups = {}
            for r in sub:
                groups.setdefault(r[key], []).append(r['m_meas'])
            if len(groups) < 2:
                continue
            meds = [statistics.median(v) for v in groups.values()]
            worst = max(worst, (max(meds) - min(meds)) / statistics.median(meds))
        print('  worst spread across %-16s %.1f%%' % (label, 100 * worst))
    # day vs night
    worst = 0.0
    for d in DISTANCES:
        sub = [r for r in rows if r['dist_km'] == d]
        day = [r['m_meas'] for r in sub if 9 <= appmodel.local_solar_time(r['utc'], r['lon']) <= 15]
        night = [r['m_meas'] for r in sub if appmodel.local_solar_time(r['utc'], r['lon']) >= 21
                 or appmodel.local_solar_time(r['utc'], r['lon']) <= 3]
        if day and night:
            worst = max(worst, abs(statistics.median(day) - statistics.median(night))
                        / statistics.median(day))
    print('  worst spread across %-16s %.1f%%' % ('day vs night', 100 * worst))

    json.dump({'distances': DISTANCES, 'sites': SITES, 'rows': rows},
              open(os.path.join(OUT_DIR, 'mfactor-results.json'), 'w'))
    print('\nwrote docs/validation/mfactor-results.json')


if __name__ == '__main__':
    sys.exit(run())
