#!/usr/bin/env python3
"""Python mirror of the app's propagation and foF2 model.

Every validation study compares VOACAP against what the app actually computes,
so each one needs a copy of the model. Keeping that copy in ONE place means the
studies cannot silently disagree with each other about what they are testing —
which they did before this module existed, when three scripts each carried
their own hand-copied diurnal curve.

Mirrors:
  src/physics/propagation.js  maxHopKm, calcTakeoffAngle (no terrain), secantFactor
  src/physics/freqAdvisor.js  solarDeclination, cosZenith, illuminationFactor,
                      seasonLatitudeFactor, estimateFoF2

Verify the mirror against the real thing with:
    python3 scripts/validation/appmodel.py --check

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

EARTH_R = 6371.0


def _require(path, what):
    """Refuse to run on a missing asset instead of quietly using a worse model.

    These loaders used to set a flag and carry on when the file was not where
    they expected. That is right for the APP — it falls back to the physical
    model and keeps working offline. It is wrong for this MIRROR, whose whole
    job is to reproduce what ships: a silent fallback makes every study report
    the fallback's accuracy while claiming to have measured the shipped path.

    The v1.32 reorganisation proved the point. Moving mfactorTable.js into
    src/data/ left this path stale, and run_muf_study.py went on to report
    5.4% mean error against a known 4.4% without one word of complaint. The
    only reason it was caught is that somebody remembered the old number.
    """
    if not os.path.exists(path):
        raise SystemExit(
            'appmodel: cannot find %s at\n  %s\n'
            'This mirror must read exactly what the app ships. Fix the path '
            'rather than letting the study run on a fallback and report a '
            'number that is not what was measured.' % (what, path))
F2_HEIGHT_KM = 360.0

# ── src/physics/freqAdvisor.js constants ─────────────────────────────────────────────
MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349]
FOF2_LAG_HOURS = 1.05
FOF2_ILLUM_EXP = 0.16
FOF2_NIGHT_FLOOR = 0.34
FOF2_AMP_BASE = 7.1
FOF2_AMP_PER_SSN = 0.023
SEASON_LAT_SCALE = 60.0
SEASON_K_LAT = 0.13
SEASON_K_ANNUAL = 0.06
SEASON_K_WINTER = -0.14
# Legacy clock curve, used only when month or latitude is missing.
FOF2_PEAK_HOUR = 12.8
FOF2_DECAY_EXP = 1.4
FOF2_NIGHT_RATIO = 0.45
FOF2_NOON_BASE = 6.8
FOF2_NOON_PER_SSN = 0.036


# ── geometry ─────────────────────────────────────────────────────────────────
def max_hop_km(h_km):
    return 2 * EARTH_R * math.acos(EARTH_R / (EARTH_R + h_km))


def takeoff_deg(dist_km, layer_km=F2_HEIGHT_KM, floor_deg=0.0):
    """floor_deg=3 is the ANTENNA floor; the MUF must use 0 (Part 16)."""
    hops = max(1, math.ceil(dist_km / max_hop_km(layer_km)))
    theta = (dist_km / hops) / (2 * EARTH_R)
    a = math.degrees(math.atan2(
        math.cos(theta) - EARTH_R / (EARTH_R + layer_km), math.sin(theta)))
    return max(floor_deg, min(85.0, max(0.0, a)))


def secant_factor(takeoff, layer_km=F2_HEIGHT_KM):
    sp = min(EARTH_R * math.cos(math.radians(takeoff)) / (EARTH_R + layer_km), 0.999999)
    return 1.0 / math.sqrt(1 - sp * sp)


def path_secant(dist_km, layer_km=F2_HEIGHT_KM):
    return secant_factor(takeoff_deg(dist_km, layer_km), layer_km)


def local_solar_time(utc_hour, lon_deg):
    return ((utc_hour + lon_deg / 15) % 24 + 24) % 24


def great_circle_km(la1, lo1, la2, lo2):
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = p2 - p1, math.radians(lo2 - lo1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def path_midpoint(la1, lo1, la2, lo2):
    dl = math.radians(lo2 - lo1)
    p1, p2 = math.radians(la1), math.radians(la2)
    bx, by = math.cos(p2) * math.cos(dl), math.cos(p2) * math.sin(dl)
    lat = math.atan2(math.sin(p1) + math.sin(p2),
                     math.sqrt((math.cos(p1) + bx) ** 2 + by ** 2))
    lon = math.radians(lo1) + math.atan2(by, math.cos(p1) + bx)
    return math.degrees(lat), ((math.degrees(lon) + 540) % 360) - 180


def destination(lat, lon, dist_km, bearing_deg):
    """Great-circle destination at an arbitrary bearing."""
    d = dist_km / EARTH_R
    la1, br = math.radians(lat), math.radians(bearing_deg)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(br))
    lo2 = math.radians(lon) + math.atan2(math.sin(br) * math.sin(d) * math.cos(la1),
                                         math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), ((math.degrees(lo2) + 540) % 360) - 180


def destination_east(lat, lon, dist_km):
    d = dist_km / EARTH_R
    la1 = math.radians(lat)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(math.pi / 2))
    lo2 = math.radians(lon) + math.atan2(
        math.sin(math.pi / 2) * math.sin(d) * math.cos(la1),
        math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), ((math.degrees(lo2) + 540) % 360) - 180


# ── solar geometry ───────────────────────────────────────────────────────────
def solar_declination(month):
    doy = MID_MONTH_DOY[max(1, min(12, int(round(month)))) - 1]
    return 23.44 * math.sin(2 * math.pi * (doy - 80.5) / 365.25)


def cos_zenith(lat_deg, local_hour, decl_deg):
    ha = math.radians((local_hour - 12) * 15)
    return (math.sin(math.radians(lat_deg)) * math.sin(math.radians(decl_deg))
            + math.cos(math.radians(lat_deg)) * math.cos(math.radians(decl_deg)) * math.cos(ha))


def illumination_factor(lat_deg, local_hour, month):
    decl = solar_declination(month)
    steps, window = 48, 18.0
    dt = window / steps
    num = den = 0.0
    for i in range(steps):
        s = (i + 0.5) * dt
        w = math.exp(-s / FOF2_LAG_HOURS)
        c = cos_zenith(lat_deg, local_hour - s, decl)
        if c > 0:
            num += c * w
        den += w
    return num / den if den else 0.0


def diurnal_factor(local_hour):
    return (0.5 * (1 + math.cos(2 * math.pi * (local_hour - FOF2_PEAK_HOUR) / 24))) ** FOF2_DECAY_EXP


def season_lat_factor(month, mag_lat, illum):
    x = max(0.0, min(1.0, illum if illum is not None else 0.0))
    have_month = month is not None and 1 <= month <= 12
    have_lat = mag_lat is not None
    f = 1.0
    mln = min(abs(mag_lat) / SEASON_LAT_SCALE, 1.0) if have_lat else 0.0
    if have_lat:
        f *= 1 + SEASON_K_LAT * (1 - 2 * mln)
    if have_month:
        f *= 1 + SEASON_K_ANNUAL * math.cos(2 * math.pi * (month - 1) / 12)
        if have_lat:
            summer = 1 if mag_lat < 0 else 7
            f *= 1 + SEASON_K_WINTER * mln * math.cos(2 * math.pi * (month - summer) / 12) * x
    return max(0.2, f)


def est_fof2(ssn, local_hour, month=None, mag_lat=None, lat=None):
    have_month = month is not None and 1 <= month <= 12
    have_lat = lat is not None and -90 <= lat <= 90
    if have_month and have_lat:
        x = max(0.0, min(1.0, illumination_factor(lat, local_hour, month)))
        amp = FOF2_AMP_BASE + FOF2_AMP_PER_SSN * ssn
        return amp * (FOF2_NIGHT_FLOOR + (1 - FOF2_NIGHT_FLOOR) * (x ** FOF2_ILLUM_EXP)) \
            * season_lat_factor(month, mag_lat, x)
    d = diurnal_factor(local_hour)
    noon = FOF2_NOON_BASE + FOF2_NOON_PER_SSN * ssn
    night = FOF2_NIGHT_RATIO * noon
    return (night + (noon - night) * d) * season_lat_factor(month, mag_lat, d)


# Mirrors minOrderCorrection() in src/physics/freqAdvisor.js. The minimum of k noisy
# estimates sits below the true minimum by sigma * E[min of k standard
# normals]; sigma is the model's own measured per-point error, not a fit.
# Mirrors foF2PointSigma() in src/physics/freqAdvisor.js: the de-bias is proportional
# to the per-point error of whichever source is live, and the lookup table is
# ten times better than the physical model it replaced.
FOF2_SIGMA_TABLE = 0.012
FOF2_SIGMA_MAP = 0.074
FOF2_POINT_SIGMA = FOF2_SIGMA_TABLE
_MIN_ORDER_BIAS = [0.0, 0.0, 0.5642, 0.8463, 1.0294, 1.1630]


def min_order_correction(k, sigma=None):
    if k <= 1:
        return 1.0
    s = FOF2_POINT_SIGMA if sigma is None else sigma
    return 1 + s * _MIN_ORDER_BIAS[min(k, len(_MIN_ORDER_BIAS) - 1)]


def interpolate_path(la1, lo1, la2, lo2, frac):
    p1, l1, p2, l2 = map(math.radians, (la1, lo1, la2, lo2))
    d = great_circle_km(la1, lo1, la2, lo2) / EARTH_R
    if d == 0:
        return la1, lo1
    a, b = math.sin((1 - frac) * d) / math.sin(d), math.sin(frac * d) / math.sin(d)
    x = a * math.cos(p1) * math.cos(l1) + b * math.cos(p2) * math.cos(l2)
    y = a * math.cos(p1) * math.sin(l1) + b * math.cos(p2) * math.sin(l2)
    z = a * math.sin(p1) + b * math.sin(p2)
    return (math.degrees(math.atan2(z, math.hypot(x, y))),
            ((math.degrees(math.atan2(y, x)) + 540) % 360) - 180)


def reflection_points(la1, lo1, la2, lo2, hops):
    n = max(1, int(round(hops or 1)))
    return [interpolate_path(la1, lo1, la2, lo2, (2 * k - 1) / (2 * n)) for k in range(1, n + 1)]


_MAP = None


def _map_eval(modip_deg, lst, month, ssn, lon):
    """Mirror of mapFoF2() in src/physics/freqAdvisor.js, read from the generated file."""
    global _MAP
    if _MAP is None:
        import re
        _p = os.path.join(ROOT, 'src', 'data', 'fof2Map.js')
        _require(_p, 'the foF2 coefficient map')
        txt = open(_p).read()
        o = re.search(r'nt: (\d+), nm: (\d+), nl: (\d+), ns: (\d+), nlon: (\d+)', txt)
        body = txt[txt.index('FOF2_MAP_COEFFS = new Float64Array([') + 36:]
        body = body[:body.index('])')]
        _MAP = {'o': [int(x) for x in o.groups()],
                'c': [float(x) for x in body.replace('\n', '').split(',') if x.strip()]}
    nt, nm, nl, ns, nlon = _MAP['o']
    co = _MAP['c']
    mp = max(-72.0, min(72.0, modip_deg))
    u = mp / 80.0
    sv = max(0.0, min(165.0, ssn)) / 100.0
    t = 2 * math.pi * ((lst % 24) + 24) % 24 / 24 if False else 2 * math.pi * (((lst % 24) + 24) % 24) / 24
    mo = 2 * math.pi * (month - 0.5) / 12
    lo = 2 * math.pi * ((((lon + 540) % 360) - 180)) / 360
    T = [1.0]
    for k in range(1, nt + 1):
        T += [math.cos(k * t), math.sin(k * t)]
    M = [1.0]
    for k in range(1, nm + 1):
        M += [math.cos(k * mo), math.sin(k * mo)]
    L = [1.0] + [u ** k for k in range(1, nl + 1)]
    S = [1.0] + [sv ** k for k in range(1, ns + 1)]
    total = 0.0
    i = 0
    for a in T:
        for b in M:
            ab = a * b
            for c in L:
                abc = ab * c
                for e in S:
                    total += co[i] * abc * e
                    i += 1
    G = []
    for k in range(1, nlon + 1):
        G += [math.cos(k * lo), math.sin(k * lo)]
    for g in G:
        for c in L[:5]:
            gc = g * c
            for a in T[:5]:
                for e in S[:2]:
                    total += co[i] * gc * a * e
                    i += 1
    v = math.exp(total)
    return max(1.0, min(20.0, v))


MAP_SANITY_FACTOR = 1.8

_TABLE = None


def _load_table():
    """Read public/fof2-table.bin exactly as src/data/fof2Table.js does."""
    global _TABLE
    if _TABLE is not None:
        return _TABLE
    path = os.path.join(ROOT, 'public', 'fof2-table.bin')
    _require(path, 'the foF2 lookup table')
    import struct
    raw = open(path, 'rb').read()
    if raw[:4] != b'HFT1':
        _TABLE = False
        return _TABLE
    o = 4
    nLat, nLon, nMon, nHour, nSsn = struct.unpack_from('<5H', raw, o); o += 10
    lat0, latStep, lon0, lonStep = struct.unpack_from('<4h', raw, o); o += 8
    ssns = list(struct.unpack_from('<%dH' % nSsn, raw, o)); o += 2 * nSsn
    data = raw[o:]
    _TABLE = {'n': (nLat, nLon, nMon, nHour, nSsn),
              'lat0': lat0 / 10.0, 'latStep': latStep / 10.0,
              'lon0': lon0 / 10.0, 'lonStep': lonStep / 10.0,
              'ssns': ssns, 'd': data}
    return _TABLE


def table_fof2(lat, lon, month, utc_hour, ssn):
    t = _load_table()
    if not t:
        return None
    nLat, nLon, nMon, nHour, nSsn = t['n']
    fa = (lat - t['lat0']) / t['latStep']
    fa = max(0.0, min(float(nLat - 1), fa))
    ia = int(fa); wa = fa - ia; ia2 = min(ia + 1, nLat - 1)
    fb = ((lon - t['lon0']) / t['lonStep']) % nLon
    ib = int(fb); wb = fb - ib; ib2 = (ib + 1) % nLon
    fc = (month - 1) % nMon
    ic = int(fc); wc = fc - ic; ic2 = (ic + 1) % nMon
    fd = utc_hour % nHour
    idx = int(fd); wd = fd - idx; id2 = (idx + 1) % nHour
    s = max(t['ssns'][0], min(t['ssns'][-1], ssn))
    ie = 0
    while ie < nSsn - 2 and s > t['ssns'][ie + 1]:
        ie += 1
    span = t['ssns'][ie + 1] - t['ssns'][ie]
    we = (s - t['ssns'][ie]) / span if span else 0.0

    def at(a, b, c, d, e):
        return t['d'][(((a * nLon + b) * nMon + c) * nHour + d) * nSsn + e] * 0.1

    v = 0.0
    for A, wA in ((ia, 1 - wa), (ia2, wa)):
        if wA == 0:
            continue
        for B, wB in ((ib, 1 - wb), (ib2, wb)):
            if wB == 0:
                continue
            for C, wC in ((ic, 1 - wc), (ic2, wc)):
                if wC == 0:
                    continue
                for D, wD in ((idx, 1 - wd), (id2, wd)):
                    if wD == 0:
                        continue
                    for E, wE in ((ie, 1 - we), (ie + 1, we)):
                        if wE == 0:
                            continue
                        v += wA * wB * wC * wD * wE * at(A, B, C, D, E)
    return v if v > 0 else None


TABLE_FOF2_MIN = 0.5
TABLE_FOF2_MAX = 20.0


def bounce_fof2(ssn, utc_hour, month, b):
    """b = (lat, lon, mag_lat, modip). Table, then map, then physics.

    The table is guarded only by a physical band, not against the physical
    model - see the comment on bounceFoF2 in src/physics/freqAdvisor.js and Part 19.
    """
    lst = local_solar_time(utc_hour, b[1])
    phys = est_fof2(ssn, lst, month, b[2], b[0])

    tv = table_fof2(b[0], b[1], month, utc_hour, ssn)
    if tv is not None and TABLE_FOF2_MIN <= tv <= TABLE_FOF2_MAX:
        return tv
    if len(b) >= 4 and b[3] is not None:
        m = _map_eval(b[3], lst, month, ssn, b[1])
        if (m is not None and m > 0 and m <= phys * MAP_SANITY_FACTOR
                and m * MAP_SANITY_FACTOR >= phys):
            return m
    return phys


def path_fof2(ssn, utc_hour, month, bounces, mid_lon, mid_lat, mid_mag_lat):
    """foF2 governing the path: the weakest bounce, de-biased."""
    if bounces:
        worst = min(bounce_fof2(ssn, utc_hour, month, b) for b in bounces)
        return worst * min_order_correction(len(bounces))
    return est_fof2(ssn, local_solar_time(utc_hour, mid_lon), month, mid_mag_lat, mid_lat)


_MTAB = None


def _load_mtable():
    """Read src/data/mfactorTable.js exactly as freqAdvisor.js uses it."""
    global _MTAB
    if _MTAB is not None:
        return _MTAB
    path = os.path.join(ROOT, 'src', 'data', 'mfactorTable.js')
    _require(path, 'the M-factor table')
    txt = open(path).read()

    def grab(name):
        m = re.search(name + r'\s*=\s*\[([^\]]*)\]', txt)
        return [float(x) for x in m.group(1).split(',') if x.strip()]

    body = txt[txt.index('MFACTOR_TABLE = new Uint16Array([') + 33:]
    body = body[:body.index('])')]
    _MTAB = {'d': grab('MFACTOR_DISTANCES'), 's': grab('MFACTOR_SSNS'),
             'nl': int(re.search(r'MFACTOR_NLST = (\d+)', txt).group(1)),
             'scale': 1e-4,
             't': [int(x) for x in body.replace('\n', '').split(',') if x.strip()]}
    return _MTAB


def m_factor_lookup(dist_km, local_hour, month, ssn):
    t = _load_mtable()
    if not t:
        return None
    D, S, NL = t['d'], t['s'], t['nl']
    d = max(D[0], min(D[-1], dist_km))
    i0 = 0
    while i0 < len(D) - 2 and d > D[i0 + 1]:
        i0 += 1
    wd = (d - D[i0]) / (D[i0 + 1] - D[i0])
    j = int(((local_hour % 24) + 24) % 24 // 3) % NL
    k = max(0, min(11, int(month) - 1))
    sv = max(S[0], min(S[-1], ssn))
    l0 = 0
    while l0 < len(S) - 2 and sv > S[l0 + 1]:
        l0 += 1
    ws = (sv - S[l0]) / (S[l0 + 1] - S[l0])

    def cell(di, li):
        return t['t'][((di * NL + j) * 12 + k) * len(S) + li] * t['scale']

    v = ((1 - wd) * ((1 - ws) * cell(i0, l0) + ws * cell(i0, l0 + 1))
         + wd * ((1 - ws) * cell(i0 + 1, l0) + ws * cell(i0 + 1, l0 + 1)))
    return max(1.0, min(3.7, v)) if v > 0 else None


def app_muf(dist_km, utc_hour, ssn, mid_lon, month=None, mag_lat=None, lat=None, bounces=None):
    lst = local_solar_time(utc_hour, mid_lon)
    m_phys = path_secant(dist_km)
    m = m_phys
    if month is not None:
        mt = m_factor_lookup(dist_km, lst, month, ssn)
        if mt is not None and mt <= m_phys * MAP_SANITY_FACTOR and mt * MAP_SANITY_FACTOR >= m_phys:
            m = mt
    if bounces:
        return path_fof2(ssn, utc_hour, month, bounces, mid_lon, lat, mag_lat) * m
    return est_fof2(ssn, lst, month, mag_lat, lat) * m


def modips(points):
    """Modified dip latitude for each (lat, lon), from the app's own code."""
    src = ("import('%s/src/physics/magnetic.js').then(m=>{const p=%s;"
           "console.log(JSON.stringify(p.map(q=>m.modip(q[0],q[1]))))})"
           % (ROOT, json.dumps([list(p) for p in points])))
    out = subprocess.run(['node', '-e', src], capture_output=True, text=True, cwd=ROOT)
    return json.loads(out.stdout.strip())


# ── VOACAP MODE PARSING ──────────────────────────────────────────────────────
# VOACAP pads single-character layer names, so an E-layer mode is written "1 E"
# with an internal space while F2 is written "1F2". A token regex that required
# the digit and letter to be adjacent silently rejected the WHOLE LINE whenever
# any E or F1 mode appeared — 53% of mode rows — which is how the layer study
# in docs/VALIDATION.md Part 4 concluded that VOACAP never offers an E mode.
# It does. Parse with this, not by splitting on whitespace.
_MODE_TOKEN = re.compile(r'(\d)\s?(E|F)s?(\d?)')


def parse_mode_row(line):
    """All propagation modes on a VOACAP MODE row, e.g. ['1F2', '1E', '2F2']."""
    tail = line.rstrip()
    if not tail.endswith('MODE'):
        return []
    body = line[:tail.rfind('MODE')]
    return [a + b + c for a, b, c in _MODE_TOKEN.findall(body)]


def dominant_mode(line):
    """The most common mode on a row, or None."""
    ms = parse_mode_row(line)
    if not ms:
        return None
    return max(set(ms), key=ms.count)


def mag_latitudes(points):
    """Magnetic latitude for each (lat, lon), from the app's own WMM code."""
    src = ("import('%s/src/physics/magnetic.js').then(m=>{const p=%s;"
           "console.log(JSON.stringify(p.map(q=>m.magneticLatitude(q[0],q[1]))))})"
           % (ROOT, json.dumps([list(p) for p in points])))
    out = subprocess.run(['node', '-e', src], capture_output=True, text=True, cwd=ROOT)
    return json.loads(out.stdout.strip())


# ── LUF ──────────────────────────────────────────────────────────────────────
# Mirrors estimateLUF in src/physics/freqAdvisor.js. Kept here so the absorption study
# can compare the app's A = K * I^0.75 * hops against VOACAP's own loss curve.
LUF_K = 373.1
LUF_A_NIGHT = 48.0
LUF_D_HEIGHT_KM = 75.0
LUF_F2_HEIGHT_KM = 360.0
LUF_GYRO_MHZ = 1.2
LUF_MARGIN_20W_DB = 10.0
LUF_REF_WATTS = 20.0
LUF_FLOOR_MHZ = 2.0


def d_layer_obliquity(hop_dist_km):
    """How much longer the ray's path through the D layer is than vertical."""
    if not hop_dist_km or hop_dist_km <= 0:
        return 1.0
    theta = hop_dist_km / (2 * EARTH_R)
    toa = math.atan2(math.cos(theta) - EARTH_R / (EARTH_R + LUF_F2_HEIGHT_KM),
                     math.sin(theta))
    if toa < 0:
        toa = 0.0
    c = EARTH_R * math.cos(toa) / (EARTH_R + LUF_D_HEIGHT_KM)
    s = 1.0 - c * c
    return 1.0 / math.sqrt(s) if s > 1e-9 else 1.0


def estimate_luf(illum, watts, hops, dist_km=None):
    i = max(0.0, min(1.0, illum))
    p = watts if (watts and watts > 0) else LUF_REF_WATTS
    n = hops if (hops and hops >= 1) else 1
    margin = LUF_MARGIN_20W_DB + 10.0 * math.log10(p / LUF_REF_WATTS)
    if margin < 1:
        margin = 1.0
    sec = d_layer_obliquity(dist_km / n) if (dist_km and dist_km > 0) else 1.0
    a = sec * (LUF_A_NIGHT + LUF_K * (i ** 0.75)) * n
    return max(LUF_FLOOR_MHZ, math.sqrt(a / margin) - LUF_GYRO_MHZ)


# ── mirror check ─────────────────────────────────────────────────────────────
def check():
    """Compare this mirror against src/physics/freqAdvisor.js over a spread of inputs."""
    cases = []
    for lat in (-70, -34, 0, 34.9, 60):
        for month in (1, 4, 7, 10):
            for hour in (0, 6, 12, 18):
                cases.append([70, hour, month, lat * 0.9, lat])
    src = ("import('%s/src/physics/freqAdvisor.js').then(f=>{const c=%s;"
           "console.log(JSON.stringify(c.map(a=>f.estimateFoF2(a[0],a[1],a[2],a[3],a[4]))))})"
           % (ROOT, json.dumps(cases)))
    js = json.loads(subprocess.run(['node', '-e', src], capture_output=True,
                                   text=True, cwd=ROOT).stdout.strip())
    worst = 0.0
    for c, v in zip(cases, js):
        mine = est_fof2(*c)
        worst = max(worst, abs(mine - v))
    lufc = []
    for illum in (0.0, 0.1, 0.35, 0.7, 1.0):
        for watts in (2, 5, 10, 20, 150):
            for hops in (1, 2, 3):
                for dist in (0, 300, 1500, 4000, 9000):
                    lufc.append([illum, watts, hops, dist])
    src2 = ("import('%s/src/physics/freqAdvisor.js').then(f=>{const c=%s;"
            "console.log(JSON.stringify(c.map(a=>f.estimateLUF(a[0],a[1],a[2],a[3]||undefined))))})"
            % (ROOT, json.dumps(lufc)))
    js2 = json.loads(subprocess.run(['node', '-e', src2], capture_output=True,
                                    text=True, cwd=ROOT).stdout.strip())
    worst_luf = max(abs(estimate_luf(c[0], c[1], c[2], c[3] or None) - v)
                    for c, v in zip(lufc, js2))

    print('checked %d foF2 cases against src/physics/freqAdvisor.js, max difference %.9f MHz'
          % (len(cases), worst))
    print('checked %d LUF cases against src/physics/freqAdvisor.js, max difference %.9f MHz'
          % (len(lufc), worst_luf))
    if worst > 1e-9 or worst_luf > 1e-9:
        print('MIRROR IS OUT OF DATE')
        return 1
    print('mirror matches')
    return 0


if __name__ == '__main__':
    sys.exit(check() if '--check' in sys.argv else 0)
