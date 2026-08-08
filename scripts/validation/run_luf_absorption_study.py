#!/usr/bin/env python3
"""Calibrate the LUF against VOACAP's own absorption, not its reliability.

Part 8 fitted the SHAPE of the app's LUF-vs-power curve and stated plainly
that it could not fix the absolute LEVEL. Part 13 agreed and closed the
question. Both were working from VOACAP's RELIABILITY output, and that output
is censored: when no frequency in the grid meets the required reliability the
condition simply vanishes, and at low power most daylight hours vanish. Only 4
of 318 conditions survived at every power. You cannot calibrate a level from a
sample that deletes itself exactly where the level matters.

VOACAP prints another row that nobody in this project has ever read: LOSS,
the total path loss in dB, at every frequency and every hour, whether or not
the link closes. It is not censored. And absorption is the only strongly
frequency-dependent term in it.

The app's absorption model (Part 8) is non-deviative D-layer absorption:

    L(f) = A / (f + fH)^2   dB, with A = K * I^0.75 * hops

VOACAP's total loss over one hop, at frequencies below the MUF, is

    LOSS(f) = 20*log10(f) + C + A/(f + fH)^2

where C collects everything frequency-independent - spreading with distance,
system losses, ground reflections. Fitting that to VOACAP's LOSS curve
recovers A directly. C is a free parameter precisely so that no assumption
about VOACAP's internal bookkeeping is needed; only the FREQUENCY SHAPE is
being used, and the shape is what carries A.

With A measured, the app's K follows, and the LUF stops being an estimate.

Frequencies at or above the MUF are excluded: there the loss is dominated by
the signal leaving the ionosphere, which is not absorption and does not follow
the 1/(f+fH)^2 law. MUFday from the same VOACAP run identifies them.

Output: docs/validation/luf-absorption-results.json

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

TX_LAT, TX_LON = 34.90, -76.88          # Cherry Point, as in Part 8
FH_MHZ = 1.2                            # electron gyrofrequency, app's value

# Eleven frequencies is VOACAP's limit per run. Spread them low, where
# absorption actually bites, rather than evenly across the band.
FREQS = [2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 8.0, 11.0, 15.0, 20.0]

# One-hop distances only for the calibration: multi-hop adds ground-reflection
# loss, which is frequency-dependent and would contaminate A. Multi-hop is
# checked separately at the end.
DISTANCES = [300, 800, 1500, 2500]
MONTHS = [1, 4, 7, 10]
SSNS = [10, 70, 150]


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(rx_lat, rx_lon, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS)
    return """COMMENT    HFCALC LUF absorption study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     LUFABS              STUDY
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


def run_voacap():
    subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)


def parse(path):
    """{hour: {'freqs': [...], 'loss': [...], 'mufday': [...], 'muf': x}}."""
    out, hour, cur = {}, None, None
    for line in open(path, errors='replace').read().splitlines():
        t = line.rstrip()
        if t.endswith('FREQ'):
            v = line.split()[:-1]
            try:
                hour = int(round(float(v[0])))
            except (ValueError, IndexError):
                hour = None
                continue
            cur = {'muf': float(v[1]), 'freqs': [float(x) for x in v[2:]],
                   'loss': None, 'mufday': None}
            out[hour] = cur
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


def fit_absorption(freqs, loss, usable):
    """Least squares for A and C in LOSS = 20log10(f) + C + A/(f+fH)^2.

    Linear in (A, C), so solve the 2x2 normal equations directly.
    Returns (A, C, rms_residual_db, n) or None.
    """
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
    resid = [y - (A * x + C) for x, y in zip(xs, ys)]
    rms = math.sqrt(sum(r * r for r in resid) / n)
    return A, C, rms, n


def app_absorption(hour, lon, lat, month, hops):
    """The app's own A = K * I^0.75 * hops, from src/freqAdvisor.js."""
    lst = appmodel.local_solar_time(hour, lon)
    illum = appmodel.illumination_factor(lat, lst, month)
    return appmodel.LUF_K * (illum ** 0.75) * hops


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    total = len(DISTANCES) * len(MONTHS) * len(SSNS)
    done = 0

    for dist in DISTANCES:
        rx_lat, rx_lon = appmodel.destination_east(TX_LAT, TX_LON, dist)
        mid = appmodel.path_midpoint(TX_LAT, TX_LON, rx_lat, rx_lon)
        hops = max(1, math.ceil(dist / appmodel.max_hop_km(360.0)))
        for month in MONTHS:
            for ssn in SSNS:
                open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(
                    deck(rx_lat, rx_lon, month, ssn))
                run_voacap()
                res = parse(os.path.join(RUN_DIR, 'voacapx.out'))
                done += 1
                for hour, d in sorted(res.items()):
                    if d['loss'] is None or d['mufday'] is None:
                        continue
                    # A frequency is "below the MUF" when VOACAP still expects
                    # it to propagate on most days. 0.9 is deliberately strict:
                    # near the MUF the loss curve turns up sharply.
                    usable = [(md is not None and md >= 0.9) for md in d['mufday']]
                    fit = fit_absorption(d['freqs'], d['loss'], usable)
                    if not fit:
                        continue
                    A, C, rms, n = fit
                    rows.append({
                        'dist_km': dist, 'hops': hops, 'month': month, 'ssn': ssn,
                        'utc': hour, 'muf': d['muf'],
                        'voacap_A': round(A, 2), 'fit_C': round(C, 2),
                        'fit_rms_db': round(rms, 3), 'n_freqs': n,
                        'app_A': round(app_absorption(hour, mid[1], mid[0], month, hops), 2),
                        'illum': round(appmodel.illumination_factor(
                            mid[0], appmodel.local_solar_time(hour, mid[1]), month), 4),
                    })
                print('  %4d km  month %2d  ssn %3d   (%d/%d)' % (dist, month, ssn, done, total))

    if not rows:
        print('NO ROWS - check the VOACAP deck')
        return

    print('\n' + '=' * 72)
    print('DOES THE APP\'S ABSORPTION LAW EVEN FIT VOACAP\'S LOSS CURVE?')
    rms = [r['fit_rms_db'] for r in rows]
    print('  fitted %d hourly loss curves, %d frequencies each on average'
          % (len(rows), round(statistics.mean(r['n_freqs'] for r in rows))))
    print('  residual of L = 20log10(f) + C + A/(f+fH)^2 :')
    print('    mean %.2f dB   median %.2f dB   p90 %.2f dB'
          % (statistics.mean(rms), statistics.median(rms),
             sorted(rms)[int(0.9 * len(rms))]))
    print('  (VOACAP prints LOSS to the nearest dB, so ~0.3 dB is the floor)')

    clean = [r for r in rows if r['fit_rms_db'] < 2.0 and r['voacap_A'] > 0]
    print('  %d of %d curves fit within 2 dB' % (len(clean), len(rows)))

    print('\n' + '=' * 72)
    print('THE ABSOLUTE LEVEL: app A vs VOACAP A')
    ratios = [r['app_A'] / r['voacap_A'] for r in clean if r['voacap_A'] > 0.1]
    if ratios:
        print('  app_A / voacap_A   mean %.3f   median %.3f'
              % (statistics.mean(ratios), statistics.median(ratios)))
        print('  -> the app is %.0f%% %s than VOACAP on absorption'
              % (abs(1 - statistics.median(ratios)) * 100,
                 'HIGHER' if statistics.median(ratios) > 1 else 'LOWER'))
        k_scale = statistics.median([r['voacap_A'] / r['app_A'] for r in clean
                                     if r['app_A'] > 0.1])
        print('  LUF_K would become %.1f (currently %.1f) to match the median'
              % (appmodel.LUF_K * k_scale, appmodel.LUF_K))
        print('  LUF scales as sqrt(A), so that moves the LUF by x%.3f'
              % math.sqrt(k_scale))

    print('\n' + '=' * 72)
    print('DOES THE ILLUMINATION EXPONENT HOLD? (app assumes I^0.75)')
    lit = [r for r in clean if r['illum'] > 0.05]
    if len(lit) > 20:
        xs = [math.log(r['illum']) for r in lit]
        ys = [math.log(r['voacap_A'] / r['hops']) for r in lit if r['voacap_A'] > 0]
        m = min(len(xs), len(ys))
        xs, ys = xs[:m], ys[:m]
        mx, my = statistics.mean(xs), statistics.mean(ys)
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        den = sum((x - mx) ** 2 for x in xs)
        if den > 0:
            print('  measured exponent on illumination: %.3f  (app uses 0.75, n=%d)'
                  % (num / den, m))

    out = {
        'generated_by': 'scripts/validation/run_luf_absorption_study.py',
        'method': 'fit LOSS(f) = 20log10(f) + C + A/(f+fH)^2 below the MUF',
        'fh_mhz': FH_MHZ, 'freqs': FREQS, 'distances_km': DISTANCES,
        'months': MONTHS, 'ssns': SSNS,
        'app_luf_k': appmodel.LUF_K,
        'n_curves': len(rows), 'n_clean': len(clean),
        'fit_rms_db': {'mean': round(statistics.mean(rms), 3),
                       'median': round(statistics.median(rms), 3)},
        'ratio_app_over_voacap': {
            'mean': round(statistics.mean(ratios), 4) if ratios else None,
            'median': round(statistics.median(ratios), 4) if ratios else None,
        },
        'rows': rows,
    }
    with open(os.path.join(OUT_DIR, 'luf-absorption-results.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
    print('\nwrote docs/validation/luf-absorption-results.json (%d rows)' % len(rows))


if __name__ == '__main__':
    run()
