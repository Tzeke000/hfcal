#!/usr/bin/env python3
"""Build our own M-FACTOR table — the geometry half of the MUF.

Part 15 got foF2 to 1.2% and left the geometry at 5-6.5%. That geometry is a
chain of assumptions: hop count from a fixed maximum hop, takeoff angle from
curved-earth geometry at a fixed 360 km virtual height, the secant law at that
same height, and a 3 degree clamp. Measuring it (run_mfactor_study.py) showed
three distinct faults:

  * the 3 degree takeoff clamp CAPS M at 3.06 while VOACAP measures up to 3.25,
    so every long path is under-predicted by 3-6%;
  * the hard hop-count switch at 4186 km is wrong by 22% right at the
    transition, because VOACAP moves between one and two hops gradually;
  * the effective virtual height is not 360 km and not constant — it runs
    397 km at short range down to 326 km at long, and 331 km at SSN 30 against
    368 km at SSN 100.

Rather than patch three things, this tabulates the quantity they exist to
produce. M is measured against TOTAL path distance, which removes hop counting
from the MUF path altogether: the table simply knows what M is for a 4200 km
path, so there is no transition to get wrong.

    M = MUF_voacap / foF2      foF2 from the Part 15 table, at the weakest
                               reflection point, exactly as the app computes it

Axes: total distance x local solar time x month x solar activity. Sites are
spread so latitude dependence shows up as scatter rather than bias, and a
quarter of them are HELD OUT to score generalisation.

Output: docs/validation/mfactor-table.npz

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import statistics
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import appmodel  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ITSHFBC = os.path.expanduser('~/itshfbc')
RUN_DIR = os.path.join(ITSHFBC, 'run')
OUT_DIR = os.path.join(ROOT, 'docs', 'validation')

FREQS = [3.0, 5.0, 7.0, 10.0, 14.0, 18.0, 22.0, 26.0, 30.0]

DISTANCES = [250, 500, 800, 1100, 1400, 1700, 2000, 2300, 2600, 3000,
             3400, 3800, 4200, 4700, 5300, 6000, 7000, 8500, 10000, 12000]

# EVERY PATH IN THE FIRST BUILD SHOT DUE EAST, and that biased the table.
# M itself is nearly azimuth-independent — it is geometry — but the foF2
# REFERENCE it is fitted against is the weakest bounce, and on a north-south
# path the bounces span far more latitude (and more day/night) than on an
# east-west one at the same distance. A table trained only on east-west paths
# therefore carried the wrong implicit reference for transequatorial shots,
# which is exactly where the first build regressed (interhemispheric 5.6% to
# 6.3%, bias +3.7%).
BEARINGS = [90, 0, 45]
MONTHS = list(range(1, 13))
SSNS = [10, 70, 150]

# Eight origins spread over latitude and longitude; every third is held out.
SITES = [(34.90, -76.88), (60.00, 25.00), (10.00, -60.00),
         (-34.00, 18.00), (45.00, 135.00), (-15.00, -50.00)]
TEST_SITES = {1, 4}


def fmt(v, pos, neg):
    return '%.2f%s' % (abs(v), pos if v >= 0 else neg)


def deck(la1, lo1, la2, lo2, month, ssn):
    fs = ''.join('%5.2f' % f for f in FREQS) + ' 0.00 0.00'
    return """COMMENT    HFCALC M-factor table
LINEMAX      55       number of lines-per-page
COEFFS    CCIR
TIME          1   24    1    1
MONTH      2026%5.2f
SUNSPOT    %d.
LABEL     MFACTAB             STUDY
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
    """{hour: (muf, dominant mode)} using the corrected mode parser."""
    out, hour, muf = {}, None, None
    for line in open(path, errors='replace').read().splitlines():
        t = line.rstrip()
        if t.endswith('FREQ'):
            v = line.split()[:-1]
            try:
                hour, muf = int(round(float(v[0]))), float(v[1])
            except (ValueError, IndexError):
                hour = muf = None
        elif hour is not None and t.endswith('MODE'):
            mode = appmodel.dominant_mode(line)
            if muf and muf > 0 and mode:
                out[hour] = (muf, mode)
            hour = muf = None
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    total = len(SITES) * len(BEARINGS) * len(DISTANCES) * len(MONTHS) * len(SSNS)
    print('%d sites x %d bearings x %d distances x %d months x %d ssn = %d runs'
          % (len(SITES), len(BEARINGS), len(DISTANCES), len(MONTHS), len(SSNS), total))
    done = 0
    for si, (la, lo) in enumerate(SITES):
      for brg in BEARINGS:
        for dist in DISTANCES:
            rx = appmodel.destination(la, lo, float(dist), float(brg))
            hops = max(1, math.ceil(dist / appmodel.max_hop_km(appmodel.F2_HEIGHT_KM)))
            pts = appmodel.reflection_points(la, lo, rx[0], rx[1], hops)
            mid = appmodel.path_midpoint(la, lo, rx[0], rx[1])
            for month in MONTHS:
                for ssn in SSNS:
                    open(os.path.join(RUN_DIR, 'voacapx.dat'), 'w').write(
                        deck(la, lo, rx[0], rx[1], month, ssn))
                    subprocess.run(['voacapl', ITSHFBC], capture_output=True, timeout=180)
                    done += 1
                    for hour, (muf, mode) in sorted(parse(os.path.join(RUN_DIR, 'voacapx.out')).items()):
                        if mode[1:] != 'F2':
                            continue      # E and F1 modes are a different layer
                        # Two candidate references for foF2. The M table is
                        # fitted against whichever the app will use, so they
                        # must be compared before choosing.
                        vals = [appmodel.table_fof2(p[0], p[1], month, hour, ssn) or 0
                                for p in pts]
                        f2_min = min(vals)
                        f2_mid = appmodel.table_fof2(mid[0], mid[1], month, hour, ssn) or 0
                        if f2_min <= 0 or f2_mid <= 0:
                            continue
                        rows.append({'site': si, 'bearing': brg, 'dist_km': dist, 'month': month,
                                     'ssn': ssn, 'utc': hour,
                                     'lst': round(appmodel.local_solar_time(hour, mid[1]), 3),
                                     'm': round(muf / f2_min, 4),
                                     'm_mid': round(muf / f2_mid, 4),
                                     'test': si in TEST_SITES})
        print('  site %d/%d done, %d runs, %d rows' % (si + 1, len(SITES), done, len(rows)), flush=True)

    tr = [r for r in rows if not r['test']]
    te = [r for r in rows if r['test']]
    print('\n%d samples: %d train, %d held-out sites' % (len(rows), len(tr), len(te)))

    print('\nWHICH foF2 REFERENCE gives a tighter M?')
    for key, lab in (('m', 'weakest bounce'), ('m_mid', 'path midpoint')):
        vals = [r[key] for r in rows]
        sp = []
        for dist in DISTANCES:
            s_ = sorted(r[key] for r in rows if r['dist_km'] == dist)
            if len(s_) > 20:
                sp.append((s_[9 * len(s_) // 10] - s_[len(s_) // 10]) / statistics.median(s_))
        print('  %-16s range %.2f-%.2f   within-distance spread %.1f%%'
              % (lab, min(vals), max(vals), 100 * statistics.mean(sp)))

    # ── tabulate M(distance, local solar time, month, ssn) ──────────────────
    NL = 8                                  # 3-hour local-time bins
    tab = np.zeros((len(DISTANCES), NL, 12, len(SSNS)), dtype=np.float32)
    cnt = np.zeros_like(tab)
    for r in tr:
        i = DISTANCES.index(r['dist_km'])
        j = int(r['lst'] // 3) % NL
        k = r['month'] - 1
        l = SSNS.index(r['ssn'])
        tab[i, j, k, l] += r['m']
        cnt[i, j, k, l] += 1
    empty = int((cnt == 0).sum())
    tab = np.where(cnt > 0, tab / np.maximum(cnt, 1), np.nan)
    # fill any gap from the nearest filled local-time bin at the same cell
    for i in range(tab.shape[0]):
        for k in range(12):
            for l in range(len(SSNS)):
                col = tab[i, :, k, l]
                if np.all(np.isnan(col)):
                    col[:] = np.nanmedian(tab[i])
                else:
                    idx = np.where(~np.isnan(col))[0]
                    for j in range(NL):
                        if np.isnan(col[j]):
                            col[j] = col[idx[np.argmin(np.abs(idx - j))]]
    print('filled %d empty cells of %d' % (empty, tab.size))
    print('M range %.3f - %.3f' % (np.nanmin(tab), np.nanmax(tab)))

    def lookup(r):
        i = DISTANCES.index(r['dist_km'])
        return float(tab[i, int(r['lst'] // 3) % NL, r['month'] - 1, SSNS.index(r['ssn'])])

    def err(rs, fn):
        return 100 * statistics.mean(abs(fn(r) - r['m']) / r['m'] for r in rs)

    shipped = lambda r: appmodel.path_secant(float(r['dist_km']))
    print('\nM error, shipped secant model : train %5.2f%%  HELD-OUT %5.2f%%'
          % (err(tr, shipped), err(te, shipped)))
    print('M error, table                : train %5.2f%%  HELD-OUT %5.2f%%'
          % (err(tr, lookup), err(te, lookup)))

    json.dump(rows, open(os.path.join(OUT_DIR, 'mfactor-rows.json'), 'w'))
    np.savez_compressed(os.path.join(OUT_DIR, 'mfactor-table.npz'),
                        table=tab, distances=np.array(DISTANCES),
                        ssns=np.array(SSNS), n_lst=NL)
    json.dump({'sites': SITES, 'test_sites': sorted(TEST_SITES),
               'distances': DISTANCES, 'n_lst': NL, 'ssns': SSNS,
               'heldout_pct': round(err(te, lookup), 2),
               'shipped_pct': round(err(te, shipped), 2)},
              open(os.path.join(OUT_DIR, 'mfactor-table-meta.json'), 'w'))
    print('wrote docs/validation/mfactor-table.npz')


if __name__ == '__main__' and '--export' not in sys.argv:
    sys.exit(main())


def export_js():
    """Emit src/mfactorTable.js from the saved rows.

    Small enough (25 x 8 x 12 x 3 = 7200 cells) to inline as JavaScript, so it
    needs no async load and is available from the first render.

    Two things matter in how the table is built:
      * MEDIAN, not mean, per cell — the raw ratios have a long tail.
      * A PHYSICAL CAP. M = 1/cos(phi) cannot exceed about 3.7 for the F2
        layer, so a measured 10 is not exotic propagation, it is a sample where
        the foF2 the ratio was divided by is not the one VOACAP used. Those are
        rejected rather than averaged in.
    """
    import statistics as st
    rows = json.load(open(os.path.join(OUT_DIR, 'mfactor-rows.json')))

    # CONSISTENCY. The rows hold M = MUF / min(foF2 at the bounces), the RAW
    # minimum. The app does not use the raw minimum: it applies the min-order
    # de-bias first (pathFoF2), so it computes MUF = min * correction * M. If
    # the table were fitted against the raw minimum the correction would be
    # applied twice, over-predicting every multi-hop path — which is what the
    # transequatorial +4% bias in Part 16 was. Divide it out here so both sides
    # use the same reference.
    for r in rows:
        hops = max(1, math.ceil(r['dist_km'] / appmodel.max_hop_km(appmodel.F2_HEIGHT_KM)))
        r['m'] = r['m'] / appmodel.min_order_correction(hops)
    NL = 8
    CAP = 3.6
    tr = [r for r in rows if not r['test'] and r['m'] <= CAP]
    te = [r for r in rows if r['test'] and r['m'] <= CAP]
    b = {}
    for r in tr:
        b.setdefault((DISTANCES.index(r['dist_km']), int(r['lst'] // 3) % NL,
                      r['month'] - 1, SSNS.index(r['ssn'])), []).append(r['m'])
    glob = st.median([r['m'] for r in tr])
    flat = []
    for i in range(len(DISTANCES)):
        for j in range(NL):
            for k in range(12):
                for l in range(len(SSNS)):
                    v = b.get((i, j, k, l))
                    flat.append(st.median(v) if v else glob)

    def pred(r):
        i = DISTANCES.index(r['dist_km'])
        idx = ((i * NL + int(r['lst'] // 3) % NL) * 12 + r['month'] - 1) * len(SSNS) \
            + SSNS.index(r['ssn'])
        return flat[idx]

    ete = 100 * st.mean(abs(pred(r) - r['m']) / r['m'] for r in te)
    esh = 100 * st.mean(abs(appmodel.path_secant(float(r['dist_km'])) - r['m']) / r['m'] for r in te)
    print('\nEXPORT: held-out M error  table %.2f%%   shipped secant %.2f%%' % (ete, esh))

    q = [max(0, min(65535, int(round(v * 10000)))) for v in flat]
    js = [
        '// ── M-FACTOR TABLE ────────────────────────────────────────────────────────────',
        '// GENERATED FILE — do not edit by hand.',
        '//   regenerate: python3 scripts/validation/build_mfactor_table.py --export',
        '//',
        '// The geometry half of the MUF, measured rather than derived.',
        '//',
        '// MUF = foF2 x M. The app used to DERIVE M from a chain of assumptions —',
        '// hop count from a fixed maximum hop, takeoff angle from curved-earth geometry',
        '// at a fixed 360 km virtual height, the secant law at that height, and a 3',
        '// degree clamp. Measuring M against VOACAP showed all three were wrong in',
        '// different ways: the clamp capped M at 3.06 where VOACAP reaches 3.25, the',
        '// hop switch at 4186 km was off by 22% right at the transition, and the',
        '// effective height is neither 360 km nor constant (397 km short-range down to',
        '// 326 km long, 331 km at SSN 10 against 368 km at SSN 100).',
        '//',
        '// Indexing by TOTAL path distance removes hop counting from the MUF entirely:',
        '// the table simply knows what M is for a 4200 km path, so there is no',
        '// transition to get wrong.',
        '//',
        '// Axes: distance x local solar time (3 h bins) x month x solar activity.',
        '// Fitted on %d VOACAP samples over %d sites; %d sites were HELD OUT and score'
        % (len(rows), len(SITES), len(TEST_SITES)),
        '// %.2f%% against %.2f%% for the secant model it replaces.' % (ete, esh),
        '// See docs/VALIDATION.md Part 16.',
        '//',
        '// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.',
        '// Project signature: HFCALC-AG-EZK-USMC-v1',
        '// ─────────────────────────────────────────────────────────────────────────────',
        '',
        'export const MFACTOR_DISTANCES = [%s];' % ','.join(str(d) for d in DISTANCES),
        'export const MFACTOR_SSNS = [%s];' % ','.join(str(s) for s in SSNS),
        'export const MFACTOR_NLST = %d;' % NL,
        'export const MFACTOR_SCALE = 1e-4;',
        'export const MFACTOR_HELDOUT_PCT = %.2f;' % ete,
        '',
        'export const MFACTOR_TABLE = new Uint16Array([',
    ]
    for i in range(0, len(q), 20):
        js.append('  ' + ','.join(str(x) for x in q[i:i + 20]) + ',')
    js += [']);', '']
    path = os.path.join(ROOT, 'src', 'mfactorTable.js')
    open(path, 'w').write('\n'.join(js))
    print('wrote src/mfactorTable.js (%d cells, %.1f KB)'
          % (len(q), os.path.getsize(path) / 1024.0))


if '--export' in sys.argv:
    export_js()
