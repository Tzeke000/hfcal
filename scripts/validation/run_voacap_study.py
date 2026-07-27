#!/usr/bin/env python3
"""VOACAP validation study for the HF Field Antenna Calculator.

Compares the app's takeoff-angle and hop-count model (src/propagation.js)
against VOACAP (Voice of America Coverage Analysis Program) — the
government-standard HF ionospheric prediction engine — across a matrix of
path distances, seasons, and solar conditions.

Method
------
TX is fixed at Twentynine Palms, CA (34.23N 116.05W). RX points are placed
due east along the great circle at each test distance. For every distance
we run VOACAP point-to-point predictions (METHOD 30) for all 24 UTC hours,
in June and December, at SSN 30 (solar minimum-ish) and SSN 100 (elevated),
over a 9-frequency HF set. From each run we collect the predicted MODE
(hop count + layer, e.g. "1F2") and TANGLE (takeoff angle, degrees) for
every hour/frequency cell.

The app's prediction for the same distance comes from the identical model
the UI uses: hops = ceil(d / 4500), angle = atan(2 x 330 / hopDist) - the
flat-earth first-hop geometry at a fixed F2 height of 330 km.

Because the app is a field planning tool (static geometry, no solar/space
weather input), the comparison question is: does the app's single static
angle land inside the envelope of VOACAP's hour/season/SSN-varying
predictions, and does it agree with the median?

Outputs (written to docs/validation/):
  voacap-results.json           raw + summarized comparison data
  takeoff-angle-comparison.png  app curve vs VOACAP median/envelope
  summary-table.md              markdown table for VALIDATION.md

Requires: voacapl installed (github.com/jawatson/voacapl), ~/itshfbc data
tree (run `makeitshfbc`), matplotlib.

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

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ITSHFBC = os.path.expanduser('~/itshfbc')
RUN_DIR = os.path.join(ITSHFBC, 'run')
OUT_DIR = os.path.join(ROOT, 'docs', 'validation')

TX_LAT, TX_LON = 34.23, -116.05         # Twentynine Palms, CA
DISTANCES_KM = [250, 500, 770, 1000, 1500, 2000, 2500, 3000, 4000, 6000]
FREQS = [3.50, 5.30, 7.20, 10.10, 14.20, 18.10, 21.30, 24.90, 28.50]
CONDITIONS = [(6, 30), (6, 100), (12, 30), (12, 100)]   # (month, SSN)

# App model constants — must mirror src/propagation.js (HOP.F2)
F2_HEIGHT_KM = 330
F2_MAX_HOP_KM = 4500
EARTH_R = 6371.0


def app_prediction(dist_km):
    """Replicates calcHops/calcTakeoffAngle for the F2 layer, no terrain."""
    hops = max(1, math.ceil(dist_km / F2_MAX_HOP_KM))
    hop_dist = dist_km / hops
    angle = math.degrees(math.atan2(2 * F2_HEIGHT_KM, hop_dist))
    angle = max(3.0, min(85.0, angle))
    return {'hops': hops, 'angle': round(angle, 1)}


def destination_east(lat, lon, dist_km):
    """Great-circle destination due east (bearing 90 deg)."""
    d = dist_km / EARTH_R
    la1 = math.radians(lat)
    lo1 = math.radians(lon)
    la2 = math.asin(math.cos(la1) * math.sin(d) * 0 + math.sin(la1) * math.cos(d)
                    + math.cos(la1) * math.sin(d) * math.cos(math.radians(90)))
    la2 = math.asin(math.sin(la1) * math.cos(d)
                    + math.cos(la1) * math.sin(d) * math.cos(math.radians(90)))
    lo2 = lo1 + math.atan2(math.sin(math.radians(90)) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def fmt_coord(value, pos, neg):
    hemi = pos if value >= 0 else neg
    return f'{abs(value):.2f}{hemi}'


def make_deck(rx_lat, rx_lon, month, ssn, label):
    lat1 = fmt_coord(TX_LAT, 'N', 'S')
    lon1 = fmt_coord(TX_LON, 'E', 'W')
    lat2 = fmt_coord(rx_lat, 'N', 'S')
    lon2 = fmt_coord(rx_lon, 'E', 'W')
    freq_str = ''.join(f'{f:5.2f}' for f in FREQS) + ' 0.00 0.00'
    return f"""COMMENT    HFCALC validation run
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026{month:5.2f}
SUNSPOT    {ssn:.0f}.
LABEL     29PALMS CA          {label:<20}
CIRCUIT   {lat1:>6}{lon1:>10}{lat2:>10}{lon2:>10}  S     0
SYSTEM       1. 145. 0.10  90. 73.0 3.00 0.10
FPROB      1.00 1.00 1.00 0.00
ANTENNA       1    1    2   30     0.000[default/const17.voa  ]  0.0  500.0000
ANTENNA       2    2    2   30     0.000[default/swwhip.voa   ]  0.0    0.0000
FREQUENCY {freq_str}
METHOD       30    0
EXECUTE
QUIT
"""


MODE_RE = re.compile(r'^\s*((?:\d[EF]\d?[ ]?|\d[EF]s?|[- ]+)+)MODE')


def parse_voacap_out(path):
    """Extract (freq, mode, tangle) cells from every hour block."""
    cells = []
    lines = open(path, errors='replace').read().splitlines()
    for i, line in enumerate(lines):
        if line.rstrip().endswith('FREQ'):
            freqs = [float(x) for x in line.split()[:-1]]
            # freqs[0] is the UTC hour, freqs[1] is the MUF column
            hour, muf = freqs[0], freqs[1]
            mode_line = lines[i + 1]
            tangle_line = lines[i + 2]
            if not mode_line.rstrip().endswith('MODE') or not tangle_line.rstrip().endswith('TANGLE'):
                continue
            modes = mode_line.replace('MODE', '').split()
            tangles = [x for x in tangle_line.replace('TANGLE', '').split()]
            # Column alignment: freqs[0] is the UTC hour; every remaining
            # column (starting with the MUF column) has a MODE/TANGLE cell.
            fvals = freqs[1:]
            # modes/tangles include entries for every populated freq column
            for j, f in enumerate(fvals):
                if j >= len(modes) or j >= len(tangles):
                    break
                m, t = modes[j], tangles[j]
                if m == '-' or t == '-':
                    continue
                try:
                    cells.append({'hour': hour, 'freq': f, 'mode': m, 'tangle': float(t)})
                except ValueError:
                    continue
    return cells


def hops_of_mode(mode):
    m = re.match(r'^(\d+)', mode)
    return int(m.group(1)) if m else None


def run_study():
    os.makedirs(OUT_DIR, exist_ok=True)
    results = []
    for dist in DISTANCES_KM:
        rx_lat, rx_lon = destination_east(TX_LAT, TX_LON, dist)
        app = app_prediction(dist)
        all_cells = []
        for (month, ssn) in CONDITIONS:
            deck = make_deck(rx_lat, rx_lon, month, ssn, f'RX {dist}KM E')
            with open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w') as fh:
                fh.write(deck)
            subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=120)
            cells = parse_voacap_out(os.path.join(RUN_DIR, 'voacapx.out'))
            for c in cells:
                c['month'], c['ssn'] = month, ssn
            all_cells.extend(cells)

        f2 = [c for c in all_cells if 'F2' in c['mode']]
        same_hops = [c for c in f2 if hops_of_mode(c['mode']) == app['hops']]
        pool = same_hops if same_hops else f2
        tangles = [c['tangle'] for c in pool]
        mode_counts = {}
        for c in f2:
            mode_counts[c['mode']] = mode_counts.get(c['mode'], 0) + 1
        dominant = max(mode_counts, key=mode_counts.get) if mode_counts else None
        summary = {
            'dist_km': dist,
            'app_angle': app['angle'],
            'app_hops': app['hops'],
            'voacap_cells': len(all_cells),
            'voacap_f2_cells': len(f2),
            'voacap_dominant_mode': dominant,
            'voacap_median': round(statistics.median(tangles), 1) if tangles else None,
            'voacap_min': round(min(tangles), 1) if tangles else None,
            'voacap_max': round(max(tangles), 1) if tangles else None,
            'delta_vs_median': round(app['angle'] - statistics.median(tangles), 1) if tangles else None,
            'in_envelope': (min(tangles) <= app['angle'] <= max(tangles)) if tangles else None,
        }
        results.append(summary)
        print(f"{dist:>5} km  app {app['angle']:>5}° ({app['hops']} hop)  "
              f"VOACAP median {summary['voacap_median']}° "
              f"[{summary['voacap_min']}–{summary['voacap_max']}] "
              f"mode {dominant}  Δ {summary['delta_vs_median']}")

    with open(os.path.join(OUT_DIR, 'voacap-results.json'), 'w') as fh:
        json.dump({
            'tx': {'lat': TX_LAT, 'lon': TX_LON, 'name': 'Twentynine Palms, CA'},
            'conditions': [{'month': m, 'ssn': s} for m, s in CONDITIONS],
            'freqs_mhz': FREQS,
            'voacap_version': '16.1207W (voacapl)',
            'app_model': 'atan(2*330/hopDist), hops=ceil(d/4500), clamp 3-85',
            'results': results,
        }, fh, indent=2)

    write_chart(results)
    write_table(results)
    return results


def write_chart(results):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    d = [r['dist_km'] for r in results]
    app = [r['app_angle'] for r in results]
    med = [r['voacap_median'] for r in results]
    lo = [r['voacap_median'] - r['voacap_min'] for r in results]
    hi = [r['voacap_max'] - r['voacap_median'] for r in results]

    fig, ax = plt.subplots(figsize=(8, 5), dpi=140)
    ax.errorbar(d, med, yerr=[lo, hi], fmt='s', color='#3a6b8a', capsize=4,
                markersize=6, label='VOACAP median (bars: full envelope,\n24 h × Jun/Dec × SSN 30/100)')
    ax.plot(d, app, 'o-', color='#4a7a3a', linewidth=2, markersize=6,
            label='HF Field Antenna Calc (static model)')
    ax.set_xlabel('Path distance (km)')
    ax.set_ylabel('Takeoff angle (degrees)')
    ax.set_title('Takeoff angle vs distance — app model vs VOACAP predictions')
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, 'takeoff-angle-comparison.png'))
    print('chart written')


def write_table(results):
    rows = ['| Distance | App angle (hops) | VOACAP median | VOACAP range | Δ vs median | In envelope |',
            '|---|---|---|---|---|---|']
    for r in results:
        rows.append(f"| {r['dist_km']} km | {r['app_angle']}° ({r['app_hops']}) "
                    f"| {r['voacap_median']}° | {r['voacap_min']}–{r['voacap_max']}° "
                    f"| {r['delta_vs_median']:+.1f}° | {'yes' if r['in_envelope'] else 'NO'} |")
    with open(os.path.join(OUT_DIR, 'summary-table.md'), 'w') as fh:
        fh.write('\n'.join(rows) + '\n')
    print('table written')


if __name__ == '__main__':
    sys.exit(0 if run_study() else 1)
