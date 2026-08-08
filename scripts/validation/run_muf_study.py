#!/usr/bin/env python3
"""VOACAP validation of the frequency advisor's MUF model (src/freqAdvisor.js).

VOACAP reports the path MUF for every UTC hour. This script compares that
against the app's offline estimate:

    foF2(SSN, local solar time)  x  secant factor(takeoff angle, layer height)

for a set of path distances, hour by hour, in June and December at two solar
activity levels. Since v1.13 the app also applies a season/magnetic-latitude
correction (see run_seasonal_study.py), so this script mirrors that term too
and reports the June/December behaviour with and without it.

Outputs (docs/validation/):
  muf-results.json          raw hourly comparison
  muf-comparison.png        app vs VOACAP MUF over 24 h
  muf-summary-table.md      markdown table for VALIDATION.md

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
from run_voacap_study import (  # noqa: E402
    ITSHFBC, RUN_DIR, OUT_DIR, TX_LAT, TX_LON, EARTH_R, F2_HEIGHT_KM,
    F2_MAX_HOP_KM, destination_east, make_deck,
)

DISTANCES_KM = [500, 1500, 3000]
# Geomagnetic latitude of the Twentynine Palms path midpoint, from the WMM dip
# angle (magneticLatitude() in src/magnetic.js). The paths run due east and are
# short enough that a single value covers all three distances.
MAG_LAT = 40.1
CONDITIONS = [(6, 30), (6, 100), (12, 30), (12, 100)]


def local_solar_time(utc_hour, lon_deg):
    return appmodel.local_solar_time(utc_hour, lon_deg)


def app_muf(dist_km, utc_hour, ssn, mid_lon, month=None, mag_lat_deg=None, lat=None):
    return appmodel.app_muf(dist_km, utc_hour, ssn, mid_lon, month, mag_lat_deg, lat)


def parse_voacap_muf(path):
    """{utc_hour: muf} — the MUF column is the second value on each FREQ row."""
    out = {}
    for line in open(path, errors='replace').read().splitlines():
        if line.rstrip().endswith('FREQ'):
            vals = [float(x) for x in line.split()[:-1]]
            if len(vals) >= 2:
                out[int(round(vals[0]))] = vals[1]
    return out


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for dist in DISTANCES_KM:
        rx_lat, rx_lon = destination_east(TX_LAT, TX_LON, dist)
        mid_lon = (TX_LON + rx_lon) / 2
        for (month, ssn) in CONDITIONS:
            deck = make_deck(rx_lat, rx_lon, month, ssn, f'MUF {dist}KM')
            open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(deck)
            subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=120)
            vmuf = parse_voacap_muf(os.path.join(RUN_DIR, 'voacapx.out'))
            mid_lat = appmodel.path_midpoint(TX_LAT, TX_LON, rx_lat, rx_lon)[0]
            for hour, muf in sorted(vmuf.items()):
                a = app_muf(dist, hour, ssn, mid_lon, month, MAG_LAT, mid_lat)
                plain = app_muf(dist, hour, ssn, mid_lon)
                rows.append({'dist_km': dist, 'month': month, 'ssn': ssn,
                             'utc_hour': hour, 'voacap_muf': muf,
                             'app_muf': round(a, 2), 'delta': round(a - muf, 2),
                             'app_muf_noseason': round(plain, 2),
                             'delta_noseason': round(plain - muf, 2)})

    # Summaries
    summary = []
    for dist in DISTANCES_KM:
        sub = [r for r in rows if r['dist_km'] == dist]
        deltas = [r['delta'] for r in sub]
        rel = [abs(r['delta']) / r['voacap_muf'] * 100 for r in sub if r['voacap_muf'] > 0]
        summary.append({
            'dist_km': dist,
            'n': len(sub),
            'mean_delta': round(statistics.mean(deltas), 2),
            'median_abs_delta': round(statistics.median([abs(d) for d in deltas]), 2),
            'mean_abs_pct': round(statistics.mean(rel), 1),
            'within_20pct': round(100 * sum(1 for r in rel if r <= 20) / len(rel)),
        })
        print(f"{dist:>5} km  n={len(sub):<4} mean Δ {summary[-1]['mean_delta']:+.2f} MHz  "
              f"median |Δ| {summary[-1]['median_abs_delta']:.2f}  "
              f"mean |Δ| {summary[-1]['mean_abs_pct']:.1f}%  "
              f"within 20%: {summary[-1]['within_20pct']}%")

    # Reference: the same paths with no date and no location, i.e. the legacy
    # clock curve the model falls back to when a caller supplies neither.
    prior = [abs(r['delta_noseason']) / r['voacap_muf'] * 100 for r in rows if r['voacap_muf'] > 0]
    print(f"legacy clock fallback: mean |delta| {statistics.mean(prior):.1f}%  "
          f"within 20%: {round(100 * sum(1 for x in prior if x <= 20) / len(prior))}%")

    allrel = [abs(r['delta']) / r['voacap_muf'] * 100 for r in rows if r['voacap_muf'] > 0]
    overall = {
        'n': len(rows),
        'mean_abs_pct': round(statistics.mean(allrel), 1),
        'median_abs_pct': round(statistics.median(allrel), 1),
        'within_20pct': round(100 * sum(1 for r in allrel if r <= 20) / len(allrel)),
        'within_30pct': round(100 * sum(1 for r in allrel if r <= 30) / len(allrel)),
        'mean_abs_pct_noseason': round(statistics.mean(prior), 1),
        'within_20pct_noseason': round(100 * sum(1 for x in prior if x <= 20) / len(prior)),
    }
    print('OVERALL:', overall)

    json.dump({'summary': summary, 'overall': overall, 'rows': rows},
              open(os.path.join(OUT_DIR, 'muf-results.json'), 'w'), indent=2)
    chart(rows)
    table(summary, overall)


def chart(rows):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.2), dpi=140, sharey=True)
    for ax, dist in zip(axes, DISTANCES_KM):
        for (month, ssn), style in zip(CONDITIONS, ['-', '-', '--', '--']):
            sub = sorted([r for r in rows if r['dist_km'] == dist
                          and r['month'] == month and r['ssn'] == ssn],
                         key=lambda r: r['utc_hour'])
            if not sub:
                continue
            hrs = [r['utc_hour'] for r in sub]
            lbl = f"{'Jun' if month == 6 else 'Dec'} SSN{ssn}"
            ax.plot(hrs, [r['voacap_muf'] for r in sub], style, color='#3a6b8a',
                    alpha=0.75, linewidth=1.4, label=f'VOACAP {lbl}')
            ax.plot(hrs, [r['app_muf'] for r in sub], style, color='#4a7a3a',
                    alpha=0.9, linewidth=1.8, label=f'App {lbl}')
        ax.set_title(f'{dist} km path')
        ax.set_xlabel('UTC hour')
        ax.grid(True, alpha=0.3)
    axes[0].set_ylabel('MUF (MHz)')
    axes[0].legend(fontsize=6, ncol=2)
    fig.suptitle('Path MUF — offline advisor vs VOACAP')
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, 'muf-comparison.png'))
    print('chart written')


def table(summary, overall):
    lines = ['| Path | Samples | Mean Δ | Median abs Δ | Mean abs error | Within 20% |',
             '|---|---|---|---|---|---|']
    for s in summary:
        lines.append(f"| {s['dist_km']} km | {s['n']} | {s['mean_delta']:+.2f} MHz "
                     f"| {s['median_abs_delta']:.2f} MHz | {s['mean_abs_pct']:.1f}% "
                     f"| {s['within_20pct']}% |")
    lines.append(f"| **All** | **{overall['n']}** | — | — "
                 f"| **{overall['mean_abs_pct']:.1f}%** | **{overall['within_20pct']}%** |")
    open(os.path.join(OUT_DIR, 'muf-summary-table.md'), 'w').write('\n'.join(lines) + '\n')
    print('table written')


if __name__ == '__main__':
    run()
