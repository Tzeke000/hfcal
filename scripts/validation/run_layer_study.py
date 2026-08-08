#!/usr/bin/env python3
"""Validate the ionospheric LAYER table (HOP in src/propagation.js) vs VOACAP.

The takeoff-angle study (run_voacap_study.py) validated the F2 geometry only.
It never checked the other half of the table: the per-layer reflection heights
and the maximum single-hop ground distance for E, F1 and F2. Those numbers
decide how many hops the app reports and which layer it names, so they deserve
the same treatment.

Two independent checks per layer:

  1. GEOMETRY. For a ray leaving at 0 deg elevation and reflecting at virtual
     height h, the ground range is fixed by spherical geometry:

         d_max = 2 * R * acos( R / (R + h) )

     A max-hop figure larger than this is not conservative, it is impossible —
     it would require the ray to leave below the horizon.

  2. VOACAP. Sweep ground distance and record which MODES VOACAP actually
     offers. The distance at which single-hop modes (1E, 1F2) stop appearing
     and two-hop modes take over is the empirical hop limit, measured rather
     than quoted.

Published reference values, for the record:
  Australian Bureau of Meteorology Space Weather Services, "Introduction to
  HF Radio Propagation", sec. 5.2: with E and F heights of 100 and 300 km,
  maximum hop lengths are 2000 km (E) and 4000 km (F) at 0 deg elevation,
  falling to 1800 km and 3200 km at 4 deg elevation.

Output: docs/validation/layer-results.json

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_voacap_study import (  # noqa: E402
    ITSHFBC, RUN_DIR, OUT_DIR, TX_LAT, TX_LON, EARTH_R,
    destination_east, make_deck, MODE_RE,
)

# Distances chosen to bracket every candidate hop limit: the E limit near
# 2000-2350, the F1 limit near 3000-3150, and the F2 limit near 4000-4500.
DISTANCES_KM = [1500, 1800, 2000, 2200, 2400, 2800, 3000, 3200,
                3600, 3800, 4000, 4200, 4400, 4600, 5000]
CONDITIONS = [(6, 30), (6, 100), (12, 30), (12, 100)]   # (month, SSN)

# What the app currently claims (src/propagation.js HOP)
APP_TABLE = {
    'E':  {'hKm': 110, 'maxHopKm': 2160},
    'F1': {'hKm': 200, 'maxHopKm': 3000},
    'F2': {'hKm': 360, 'maxHopKm': 4500},
}


def geometric_max_hop_km(h_km):
    """Ground range of a single hop launched at 0 deg elevation."""
    return 2 * EARTH_R * math.acos(EARTH_R / (EARTH_R + h_km))


def virtual_height_for_hop_km(d_km):
    """Inverse of the above — the height a given max hop implies."""
    return EARTH_R / math.cos(d_km / (2 * EARTH_R)) - EARTH_R


def hop_range_at_elevation(h_km, elev_deg):
    """Ground range for a ray launched at a given elevation angle.

    From the same mirror geometry the app uses:
        sin(phi) = R cos(a) / (R + h),  theta = pi/2 - a - phi,  d = 2 R theta
    """
    a = math.radians(elev_deg)
    sin_phi = EARTH_R * math.cos(a) / (EARTH_R + h_km)
    if sin_phi >= 1:
        return 0.0
    phi = math.asin(sin_phi)
    theta = math.pi / 2 - a - phi
    return max(0.0, 2 * EARTH_R * theta)


def parse_modes(path):
    """Every mode label VOACAP reported, across all hours and frequencies."""
    modes = []
    for line in open(path, errors='replace').read().splitlines():
        m = MODE_RE.match(line)
        if not m:
            continue
        for tok in m.group(1).split():
            if re.fullmatch(r'\d[EF]\d?', tok):
                modes.append(tok)
    return modes


def layer_of(mode):
    """'2F2' -> 'F2', '1E' -> 'E', '1F1' -> 'F1'."""
    return mode[1:]


def hops_of(mode):
    return int(mode[0])


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for dist in DISTANCES_KM:
        rx_lat, rx_lon = destination_east(TX_LAT, TX_LON, dist)
        counter = Counter()
        for (month, ssn) in CONDITIONS:
            deck = make_deck(rx_lat, rx_lon, month, ssn, f'LAYER {dist}KM')
            open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(deck)
            subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
            counter.update(parse_modes(os.path.join(RUN_DIR, 'voacapx.out')))
        total = sum(counter.values()) or 1
        rows.append({
            'dist_km': dist,
            'total_cells': total,
            'modes': dict(counter),
            # Share of cells VOACAP served with a SINGLE hop, per layer
            'single_hop_share': {
                lyr: round(sum(n for m, n in counter.items()
                               if layer_of(m) == lyr and hops_of(m) == 1) / total, 3)
                for lyr in ('E', 'F1', 'F2')
            },
        })
        top = counter.most_common(4)
        print('%5d km  n=%-5d  %s' % (dist, total,
              '  '.join('%s:%d' % (m, n) for m, n in top)))

    # ── Geometry check ───────────────────────────────────────────────────────
    print('\ngeometry: does each layer\'s max hop fit under its own 0-deg limit?')
    geom = {}
    for lyr, cfg in APP_TABLE.items():
        gmax = geometric_max_hop_km(cfg['hKm'])
        implied = virtual_height_for_hop_km(cfg['maxHopKm'])
        ok = cfg['maxHopKm'] <= gmax
        geom[lyr] = {
            'h_km': cfg['hKm'], 'app_max_hop_km': cfg['maxHopKm'],
            'geometric_max_hop_km': round(gmax),
            'implied_height_km': round(implied, 1),
            'consistent': ok,
            'hop_at_3deg_km': round(hop_range_at_elevation(cfg['hKm'], 3.0)),
        }
        print('  %-3s h=%3d km  app max hop %4d  geometric limit %4d  %s'
              % (lyr, cfg['hKm'], cfg['maxHopKm'], round(gmax),
                 'OK' if ok else 'IMPOSSIBLE (needs h=%.0f km)' % implied))
        print('      at the app\'s own 3 deg floor a single hop reaches %d km'
              % round(hop_range_at_elevation(cfg['hKm'], 3.0)))

    # ── Empirical hop limit ──────────────────────────────────────────────────
    print('\nVOACAP: last distance at which a single hop is still offered')
    empirical = {}
    for lyr in ('E', 'F1', 'F2'):
        served = [r['dist_km'] for r in rows if r['single_hop_share'][lyr] >= 0.05]
        empirical[lyr] = max(served) if served else None
        print('  %-3s %s' % (lyr, ('%d km' % empirical[lyr]) if empirical[lyr] else 'never dominant'))

    json.dump({'app_table': APP_TABLE, 'geometry': geom,
               'empirical_last_single_hop_km': empirical,
               'distances_km': DISTANCES_KM, 'rows': rows},
              open(os.path.join(OUT_DIR, 'layer-results.json'), 'w'), indent=2)
    print('\nwrote docs/validation/layer-results.json')


if __name__ == '__main__':
    sys.exit(run())
