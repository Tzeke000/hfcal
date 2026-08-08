#!/usr/bin/env python3
"""Fit the compact foF2 coefficient map the app ships, and export it to JS.

Rationale is in docs/VALIDATION.md Part 14. In short: a handful of smooth
physical terms plateaued near 17% against a truly global VOACAP grid, because
VOACAP's MUF comes from the CCIR coefficient maps — a spherical-harmonic
expansion with about a thousand coefficients per month, carrying real
geographic structure that eight parameters cannot represent. The fix is to fit
a compact expansion of the same kind.

Basis, in the coordinates the literature actually uses:

  MODIP      modified dip latitude, atan(I / sqrt(cos lat)). Measured here to
             beat magnetic latitude (7.89% vs 8.86%) and geographic latitude
             (9.22%), which is exactly why CCIR and IRI are built on it.
  local solar time   Fourier, order NT
  month              Fourier, order NM
  solar activity     polynomial in SSN/100, order NS
  longitude          Fourier, order NLON, on a reduced sub-basis

Fitted to log(foF2) by ridge least squares, so the map is positive by
construction and cannot return a negative critical frequency however far it is
extrapolated.

TRAINING HONESTY. A quarter of the sites are never fitted, only scored, and
the reported number is always that held-out set — generalisation to places the
fit has never seen, which is the only figure that means anything for an
operator standing somewhere new.

Output: src/fof2Map.js

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GRID = os.path.join(ROOT, 'docs', 'validation', 'fof2-grid.json')
OUT_JS = os.path.join(ROOT, 'src', 'fof2Map.js')

NT, NM, NL, NS, NLON = 6, 3, 6, 2, 2
MODIP_SCALE = 80.0
SSN_SCALE = 100.0
RIDGE = 1e-4


def arr(rs, k):
    return np.array([r[k] for r in rs], dtype=float)


def design(rs):
    t = 2 * np.pi * arr(rs, 'lst') / 24.0
    mo = 2 * np.pi * (arr(rs, 'month') - 0.5) / 12.0
    u = np.clip(arr(rs, 'modip') / MODIP_SCALE, -1, 1)
    s = arr(rs, 'ssn') / SSN_SCALE
    lo = 2 * np.pi * arr(rs, 'lon') / 360.0
    return build(t, mo, u, s, lo)


def build(t, mo, u, s, lo):
    T = [np.ones_like(t)]
    for k in range(1, NT + 1):
        T += [np.cos(k * t), np.sin(k * t)]
    M = [np.ones_like(mo)]
    for k in range(1, NM + 1):
        M += [np.cos(k * mo), np.sin(k * mo)]
    L = [np.ones_like(u)] + [u ** n for n in range(1, NL + 1)]
    S = [np.ones_like(s)] + [s ** n for n in range(1, NS + 1)]
    cols = []
    for a in T:
        for b in M:
            ab = a * b
            for c in L:
                abc = ab * c
                for e in S:
                    cols.append(abc * e)
    G = []
    for k in range(1, NLON + 1):
        G += [np.cos(k * lo), np.sin(k * lo)]
    for g in G:
        for c in L[:5]:
            gc = g * c
            for a in T[:5]:
                for e in S[:2]:
                    cols.append(gc * a * e)
    return np.column_stack(cols)


def score(co, rs, chunk=8000):
    tot = 0.0
    for i in range(0, len(rs), chunk):
        c = rs[i:i + chunk]
        pr = np.exp(design(c) @ co)
        a = arr(c, 'fof2')
        tot += float(np.sum(np.abs(pr - a) / a))
    return 100 * tot / len(rs)


def main():
    d = json.load(open(GRID))
    rows = [r for r in d['rows'] if r.get('modip') is not None]
    tr = [r for r in rows if not r['test']]
    te = [r for r in rows if r['test']]
    print('grid %d rows; %d train / %d held-out' % (len(rows), len(tr), len(te)))

    p = design(tr[:2]).shape[1]
    XtX = np.zeros((p, p))
    Xty = np.zeros(p)
    for i in range(0, len(tr), 8000):
        c = tr[i:i + 8000]
        X = design(c)
        XtX += X.T @ X
        Xty += X.T @ np.log(arr(c, 'fof2'))
    co = np.linalg.solve(XtX + RIDGE * np.eye(p), Xty)

    etr, ete = score(co, tr), score(co, te)
    print('basis (NT=%d NM=%d NL=%d NS=%d NLON=%d) -> %d coefficients'
          % (NT, NM, NL, NS, NLON, p))
    print('  train %.2f%%   HELD-OUT %.2f%%' % (etr, ete))

    print('\n  held-out error by modip band:')
    for lo_, hi in ((0, 15), (15, 30), (30, 45), (45, 60), (60, 90)):
        sub = [r for r in te if lo_ <= abs(r['modip']) < hi]
        if sub:
            print('    |modip| %2d-%2d  %5.2f%%  (n=%d)' % (lo_, hi, score(co, sub), len(sub)))
    print('  held-out error by solar activity:')
    for s in sorted({r['ssn'] for r in te}):
        sub = [r for r in te if r['ssn'] == s]
        print('    SSN %3d       %5.2f%%  (n=%d)' % (s, score(co, sub), len(sub)))

    # Range guard: the map is an extrapolating polynomial, so check what it
    # produces across the WHOLE input domain, not just where samples landed.
    mp, lst, mon, ssn, lon = np.meshgrid(
        np.linspace(-88, 88, 45), np.linspace(0, 24, 25), np.arange(1, 13),
        np.array([0, 25, 50, 100, 150, 250]), np.linspace(-180, 180, 13),
        indexing='ij')
    mp, lst, mon, ssn, lon = (x.ravel() for x in (mp, lst, mon, ssn, lon))
    lo_v, hi_v, n = float('inf'), 0.0, mp.size
    for i in range(0, n, 20000):
        sl = slice(i, i + 20000)
        v = np.exp(build(2 * np.pi * lst[sl] / 24.0,
                         2 * np.pi * (mon[sl] - 0.5) / 12.0,
                         np.clip(mp[sl] / MODIP_SCALE, -1, 1),
                         ssn[sl] / SSN_SCALE,
                         2 * np.pi * lon[sl] / 360.0) @ co)
        lo_v = min(lo_v, float(v.min())); hi_v = max(hi_v, float(v.max()))
    print('\n  map output over the whole input domain (%d points): %.2f - %.2f MHz'
          % (n, lo_v, hi_v))
    print('  (the app clamps to a physical window on top of this)')

    js = [
        '// ── foF2 COEFFICIENT MAP ──────────────────────────────────────────────────────',
        '// GENERATED FILE — do not edit by hand.',
        '//   regenerate: python3 scripts/validation/fit_fof2_map.py',
        '//',
        '// A compact reconstruction of the ionospheric map VOACAP itself uses. The',
        "// app's physical foF2 model plateaued near 17% against a global VOACAP grid,",
        '// because VOACAP draws on the CCIR coefficient maps — roughly a thousand',
        '// spherical-harmonic coefficients per month — and no handful of smooth',
        '// physical terms can carry that much geographic structure. This is the same',
        '// idea at a size that fits in a phone app.',
        '//',
        '// Coordinates are the ones the literature uses: MODIP (modified dip latitude,',
        '// atan(I/sqrt(cos lat))), local solar time, month, solar activity, longitude.',
        '// Fitted to log(foF2), so the result is positive however far it is pushed.',
        '//',
        '// Fitted on %d VOACAP samples over %d globally spread sites; a quarter of the'
        % (len(rows), len(d['sites'])),
        '// sites were never fitted and scored %.2f%% mean absolute error — that is the'
        % ete,
        '// number to trust, since it measures places the fit has never seen.',
        '// See docs/VALIDATION.md Part 14.',
        '//',
        '// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.',
        '// Project signature: HFCALC-AG-EZK-USMC-v1',
        '// ─────────────────────────────────────────────────────────────────────────────',
        '',
        'export const FOF2_MAP_ORDERS = { nt: %d, nm: %d, nl: %d, ns: %d, nlon: %d };' % (NT, NM, NL, NS, NLON),
        'export const FOF2_MAP_MODIP_SCALE = %g;' % MODIP_SCALE,
        'export const FOF2_MAP_SSN_SCALE = %g;' % SSN_SCALE,
        'export const FOF2_MAP_HELDOUT_PCT = %.2f;' % ete,
        '',
        'export const FOF2_MAP_COEFFS = new Float64Array([',
    ]
    for i in range(0, len(co), 8):
        # Full double precision: 7 significant figures leaves a 0.4% residual
        # once 2111 coefficients are summed, which is larger than the error the
        # map is trying to remove.
        js.append('  ' + ','.join(repr(float(x)) for x in co[i:i + 8]) + ',')
    js += [']);', '']
    open(OUT_JS, 'w').write('\n'.join(js))
    print('\nwrote src/fof2Map.js  (%d coefficients, %.1f KB)'
          % (len(co), os.path.getsize(OUT_JS) / 1024.0))


if __name__ == '__main__':
    sys.exit(main())
