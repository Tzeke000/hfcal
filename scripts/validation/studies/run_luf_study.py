#!/usr/bin/env python3
"""Validate — and make power-aware — the LUF, against VOACAP.

Everything up to v1.14.1 validated the MUF and left the LUF as a stated
unknown: a flat `LUF = 2.0 + 3.5 * illumination`, with NO dependence on
transmit power at all. That is the weakest number the app reports, and it is
the one an operator can actually do something about, because unlike the MUF
the LUF moves when you turn the power up.

VOACAP gives the answer directly. For every frequency it reports circuit
RELIABILITY, and transmit power is a real input (the last field on the XMTR
ANTENNA card). So the operational LUF is simply:

    the lowest frequency whose predicted reliability meets the requirement

Sweeping transmit power then shows exactly how the LUF moves with it.

Physics being fitted. Non-deviative D-layer absorption per hop goes roughly as

    L  =  K * I^0.75 / (f + fH)^2         dB

with I the solar illumination and fH the electron gyrofrequency (~1.2 MHz).
The link closes while L stays under the available power margin M, which grows
as 10*log10(P). Setting L = M and solving for f gives the shape fitted here:

    LUF = sqrt( K * I^0.75 * hops / M(P) ) - fH

so the LUF falls as the square root of the margin — 10x the power does NOT
buy 10x less LUF, it buys about a 25-30% reduction. That is worth an operator
knowing before they haul a bigger amp.

Required SNR is set to 38 dB-Hz, the usual figure for SSB voice, rather than
VOACAP's 73 dB-Hz broadcast default.

Antennas are ISOTROPIC at both ends (0 dBi). The other studies inherited
VOACAP's default `const17.voa`, which is the 17 dBi transmit array the Voice
of America uses — fine for a broadcast station, absurd for a Marine with wire
in a tree, and it swamped the first run of this study: every link closed at
the bottom of the frequency grid regardless of power. Isotropic is the
conservative floor; a real field dipole adds roughly 2-6 dB on top, which the
operator gets as margin. (This does not affect Parts 1-7: the MUF is a
propagation ceiling and does not depend on power or antenna gain at all.)

Output: docs/validation/luf-results.json

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

# Fine grid across the band where the LUF actually lives. VOACAP takes at
# most 11 frequencies per run.
FREQS = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 6.0, 7.5, 9.0, 12.0]

# Real radios a Marine might actually be handed, in kW.
POWERS_KW = [0.005, 0.020, 0.050, 0.150, 0.400, 1.000]

# Distances spanning NVIS, single hop and multi-hop.
DISTANCES_KM = [300, 800, 1500, 3000]
CONDITIONS = [(1, 30), (1, 100), (7, 30), (7, 100)]   # (month, SSN)

TX_LAT, TX_LON = 34.90, -76.88          # Cherry Point
REQ_SNR_DB = 38.0                        # SSB voice
REQ_REL = 0.90                           # VOACAP's own default grade of service


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(rx_lat, rx_lon, month, ssn, power_kw):
    fs = ''.join('%5.2f' % f for f in FREQS)
    return """COMMENT    HFCALC LUF study
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     LUF                 STUDY
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
       fmt(rx_lat, 'N', 'S'), fmt(rx_lon, 'E', 'W'), REQ_SNR_DB, power_kw, fs)


def parse_rel(path):
    """{utc_hour: [reliability per frequency]} from the REL rows."""
    out, hour = {}, None
    for line in open(path, errors='replace').read().splitlines():
        t = line.rstrip()
        if t.endswith('FREQ'):
            vals = line.split()[:-1]
            try:
                hour = int(round(float(vals[0])))
            except (ValueError, IndexError):
                hour = None
        elif t.endswith('REL') and hour is not None:
            toks = line.split()[:-1]
            rel = []
            for tk in toks:
                try:
                    rel.append(float(tk))
                except ValueError:
                    rel.append(None)
            out[hour] = rel
            hour = None
    return out


def voacap_luf(rel_row):
    """Lowest frequency meeting the required reliability, or None."""
    for f, r in zip(FREQS, rel_row):
        if r is not None and r >= REQ_REL:
            return f
    return None


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for dist in DISTANCES_KM:
        rx = appmodel.destination_east(TX_LAT, TX_LON, dist)
        mid = appmodel.path_midpoint(TX_LAT, TX_LON, rx[0], rx[1])
        hops = max(1, math.ceil(dist / appmodel.max_hop_km(appmodel.F2_HEIGHT_KM)))
        for power in POWERS_KW:
            for (month, ssn) in CONDITIONS:
                open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(
                    deck(rx[0], rx[1], month, ssn, power))
                subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
                rel = parse_rel(os.path.join(RUN_DIR, 'voacapx.out'))
                for hour, row in sorted(rel.items()):
                    luf = voacap_luf(row)
                    if luf is None:
                        continue     # nothing in the grid closes this hour
                    lst = appmodel.local_solar_time(hour, mid[1])
                    illum = appmodel.illumination_factor(mid[0], lst, month)
                    rows.append({'dist_km': dist, 'hops': hops, 'power_kw': power,
                                 'month': month, 'ssn': ssn, 'utc': hour,
                                 'lst': round(lst, 2), 'illum': round(illum, 4),
                                 'voacap_luf': luf})
        print('%5d km done (%d usable samples so far)' % (dist, len(rows)))

    print('\n%d samples where a LUF exists in the %s MHz grid'
          % (len(rows), '%.1f-%.1f' % (FREQS[0], FREQS[-1])))

    # ── how the LUF actually moves with power ───────────────────────────────
    print('\nmedian VOACAP LUF by transmit power (daylight samples, illum > 0.4)')
    day = [r for r in rows if r['illum'] > 0.4]
    for p in POWERS_KW:
        sub = [r['voacap_luf'] for r in day if r['power_kw'] == p]
        if sub:
            print('  %6.0f W   %.2f MHz   (n=%d)' % (p * 1000, statistics.median(sub), len(sub)))

    # ── fit  LUF = sqrt(K * I^0.75 * hops / M(P)) - fH ──────────────────────
    FH = 1.2

    def predict(r, K, m0, mslope):
        margin = max(1.0, m0 + mslope * math.log10(r['power_kw'] / 0.020))
        v = K * (r['illum'] ** 0.75) * r['hops'] / margin
        return max(0.0, math.sqrt(max(0.0, v)) - FH)

    def err(K, m0, mslope):
        return statistics.mean(abs(predict(r, K, m0, mslope) - r['voacap_luf']) for r in rows)

    best = None
    for K in [x * 5 for x in range(2, 60)]:
        for m0 in [2, 4, 6, 8, 10, 13, 16, 20, 25]:
            for ms in [2, 4, 6, 8, 10, 12, 15]:
                e = err(K, m0, ms)
                if best is None or e < best[0]:
                    best = (e, K, m0, ms)
    e, K, m0, ms = best
    print('\nfitted  LUF = sqrt(%g * I^0.75 * hops / (%g + %g*log10(P/20W))) - %g' % (K, m0, ms, FH))
    print('  mean absolute error %.2f MHz' % e)

    # current model, for comparison
    cur = statistics.mean(abs((2.0 + 3.5 * r['illum']) - r['voacap_luf']) for r in rows)
    print('  current flat model  %.2f MHz  (no power term at all)' % cur)

    json.dump({'freqs': FREQS, 'powers_kw': POWERS_KW, 'req_snr_db': REQ_SNR_DB,
               'req_rel': REQ_REL, 'fit': {'K': K, 'm0': m0, 'm_slope': ms, 'fH': FH,
                                           'mean_abs_err_mhz': round(e, 3),
                                           'current_model_err_mhz': round(cur, 3)},
               'rows': rows},
              open(os.path.join(OUT_DIR, 'luf-results.json'), 'w'))
    print('\nwrote docs/validation/luf-results.json')


if __name__ == '__main__':
    sys.exit(run())
