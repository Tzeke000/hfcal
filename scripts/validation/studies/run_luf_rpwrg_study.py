#!/usr/bin/env python3
"""Calibrate the LUF properly, using VOACAP's RPWRG instead of a crossing.

Part 8 measured the LUF by asking which frequencies met a reliability
threshold, and that measurement was badly CENSORED: at low power most daylight
hours had no closing frequency anywhere in the grid, so they dropped out
entirely, and only 4 of 318 conditions produced a LUF at every power. It was
enough to establish the SHAPE of the power dependence and not enough to
calibrate its level. The app has shipped an uncalibrated LUF ever since, and
said so.

VOACAP has a better output for this. RPWRG — required power gain — says how
many dB of extra power the circuit needs at each frequency to meet the
required SNR. Negative means surplus. It is defined at EVERY frequency whether
the link closes or not, so nothing is censored.

Two things follow:

  1. The LUF at the deck's transmit power is simply where RPWRG crosses zero:
     the frequency at which you have exactly enough power.

  2. RPWRG at ONE power gives the LUF at EVERY power for free. Needing X dB
     more at power P is the same as needing X - 10*log10(P'/P) dB at power P'.
     So one sweep calibrates the whole ladder without a single dropped sample.

Output: docs/validation/luf-rpwrg-results.json

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

# Dense across the bottom of the band, where the LUF lives.
FREQS = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.5, 6.5, 8.0, 10.0, 13.0]

REF_WATTS = 20.0                        # deck power; RPWRG is relative to this
PROBE_WATTS = [2, 5, 10, 20, 150]       # the app's PRC-160 ladder
DISTANCES_KM = [300, 800, 1500, 3000, 6000]
CONDITIONS = [(1, 30), (1, 100), (7, 30), (7, 100)]
TX_LAT, TX_LON = 34.90, -76.88
REQ_SNR_DB = 38.0


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(rx_lat, rx_lon, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS)
    return """COMMENT    HFCALC LUF via RPWRG
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     LUFRPWRG            STUDY
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
       fmt(rx_lat, 'N', 'S'), fmt(rx_lon, 'E', 'W'), REQ_SNR_DB, REF_WATTS / 1000.0, fs)


def parse_rpwrg(path):
    out, hour = {}, None
    for line in open(path, errors='replace').read().splitlines():
        t = line.rstrip()
        if t.endswith('FREQ'):
            try:
                hour = int(round(float(line.split()[0])))
            except (ValueError, IndexError):
                hour = None
        elif t.endswith('RPWRG') and hour is not None:
            vals = []
            for tk in line.split()[:-1]:
                try:
                    vals.append(float(tk))
                except ValueError:
                    vals.append(None)
            out[hour] = vals[1:1 + len(FREQS)]
            hour = None
    return out


def luf_at(rpwrg, extra_db):
    """Lowest frequency where RPWRG <= extra_db, interpolated.

    RPWRG falls as frequency rises (less absorption). The LUF at a power that
    is `extra_db` above the deck's is where the curve crosses that level.
    """
    prev_f = prev_v = None
    for f, v in zip(FREQS, rpwrg):
        if v is None:
            continue
        if v <= extra_db:
            if prev_v is None:
                return f            # already sufficient at the bottom of the grid
            span = prev_v - v
            if abs(span) < 1e-9:
                return f
            return prev_f + (prev_v - extra_db) / span * (f - prev_f)
        prev_f, prev_v = f, v
    return None                     # never enough power inside the grid


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for dist in DISTANCES_KM:
        rx = appmodel.destination_east(TX_LAT, TX_LON, dist)
        mid = appmodel.path_midpoint(TX_LAT, TX_LON, rx[0], rx[1])
        hops = max(1, math.ceil(dist / appmodel.max_hop_km(appmodel.F2_HEIGHT_KM)))
        for (month, ssn) in CONDITIONS:
            open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(deck(rx[0], rx[1], month, ssn))
            subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
            rp = parse_rpwrg(os.path.join(RUN_DIR, 'voacapx.out'))
            for hour, row in sorted(rp.items()):
                lst = appmodel.local_solar_time(hour, mid[1])
                # LUF at each end of the path is what the app models, so use the
                # same endpoint-averaged illumination it does.
                i_tx = appmodel.illumination_factor(TX_LAT, appmodel.local_solar_time(hour, TX_LON), month)
                i_rx = appmodel.illumination_factor(rx[0], appmodel.local_solar_time(hour, rx[1]), month)
                illum = 0.5 * (i_tx + i_rx)
                for w in PROBE_WATTS:
                    extra = 10 * math.log10(w / REF_WATTS)
                    luf = luf_at(row, extra)
                    if luf is None:
                        continue
                    rows.append({'dist_km': dist, 'hops': hops, 'watts': w,
                                 'month': month, 'ssn': ssn, 'utc': hour,
                                 'illum': round(illum, 4), 'voacap_luf': round(luf, 3)})
        print('%5d km done (%d samples)' % (dist, len(rows)))

    total_possible = len(DISTANCES_KM) * len(CONDITIONS) * 24 * len(PROBE_WATTS)
    print('\n%d of %d samples usable (%.0f%%) — Part 8 retained far less'
          % (len(rows), total_possible, 100 * len(rows) / total_possible))

    print('\nmedian VOACAP LUF by power, DAYLIGHT samples (illum > 0.4)')
    day = [r for r in rows if r['illum'] > 0.4]
    for w in PROBE_WATTS:
        sub = [r['voacap_luf'] for r in day if r['watts'] == w]
        if sub:
            print('  %4d W  %.2f MHz  (n=%d)' % (w, statistics.median(sub), len(sub)))

    # ── fit the app's shape: LUF = sqrt(K*I^0.75*hops/M(P)) - fH ────────────
    FH = 1.2
    FLOOR = 2.0

    def predict(r, K, m0):
        margin = max(1.0, m0 + 10 * math.log10(r['watts'] / 20.0))
        v = K * (r['illum'] ** 0.75) * r['hops'] / margin
        return max(FLOOR, math.sqrt(max(0.0, v)) - FH)

    def err(K, m0):
        return statistics.mean(abs(predict(r, K, m0) - r['voacap_luf']) for r in rows)

    best = min(((err(K, m0), K, m0)
                for K in range(50, 1200, 10) for m0 in [x / 2 for x in range(6, 60)]))
    e, K, m0 = best
    cur = err(449, 10)
    print('\nfitting  LUF = sqrt(K * I^0.75 * hops / (m0 + 10log10(P/20W))) - %.1f' % FH)
    print('  shipped   K=449  m0=10.0   mean abs error %.2f MHz' % cur)
    print('  best fit  K=%-4d m0=%-5.1f  mean abs error %.2f MHz' % (K, m0, e))

    json.dump({'ref_watts': REF_WATTS, 'freqs': FREQS, 'req_snr_db': REQ_SNR_DB,
               'fit': {'K': K, 'm0': m0, 'fH': FH, 'err_mhz': round(e, 3),
                       'shipped_err_mhz': round(cur, 3)},
               'rows': rows}, open(os.path.join(OUT_DIR, 'luf-rpwrg-results.json'), 'w'))
    print('\nwrote docs/validation/luf-rpwrg-results.json')


if __name__ == '__main__':
    sys.exit(run())
