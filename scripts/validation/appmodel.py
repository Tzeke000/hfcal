#!/usr/bin/env python3
"""Python mirror of the app's propagation and foF2 model.

Every validation study compares VOACAP against what the app actually computes,
so each one needs a copy of the model. Keeping that copy in ONE place means the
studies cannot silently disagree with each other about what they are testing —
which they did before this module existed, when three scripts each carried
their own hand-copied diurnal curve.

Mirrors:
  src/propagation.js  maxHopKm, calcTakeoffAngle (no terrain), secantFactor
  src/freqAdvisor.js  solarDeclination, cosZenith, illuminationFactor,
                      seasonLatitudeFactor, estimateFoF2

Verify the mirror against the real thing with:
    python3 scripts/validation/appmodel.py --check

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

EARTH_R = 6371.0
F2_HEIGHT_KM = 360.0

# ── src/freqAdvisor.js constants ─────────────────────────────────────────────
MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349]
FOF2_LAG_HOURS = 1.2
FOF2_ILLUM_EXP = 0.18
FOF2_NIGHT_FLOOR = 0.37
FOF2_AMP_BASE = 6.7
FOF2_AMP_PER_SSN = 0.0245
SEASON_LAT_SCALE = 60.0
SEASON_K_LAT = 0.095
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


def takeoff_deg(dist_km, layer_km=F2_HEIGHT_KM):
    hops = max(1, math.ceil(dist_km / max_hop_km(layer_km)))
    theta = (dist_km / hops) / (2 * EARTH_R)
    a = math.degrees(math.atan2(
        math.cos(theta) - EARTH_R / (EARTH_R + layer_km), math.sin(theta)))
    return max(3.0, min(85.0, max(0.0, a)))


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


def app_muf(dist_km, utc_hour, ssn, mid_lon, month=None, mag_lat=None, lat=None):
    lst = local_solar_time(utc_hour, mid_lon)
    return est_fof2(ssn, lst, month, mag_lat, lat) * path_secant(dist_km)


def mag_latitudes(points):
    """Magnetic latitude for each (lat, lon), from the app's own WMM code."""
    src = ("import('%s/src/magnetic.js').then(m=>{const p=%s;"
           "console.log(JSON.stringify(p.map(q=>m.magneticLatitude(q[0],q[1]))))})"
           % (ROOT, json.dumps([list(p) for p in points])))
    out = subprocess.run(['node', '-e', src], capture_output=True, text=True, cwd=ROOT)
    return json.loads(out.stdout.strip())


# ── mirror check ─────────────────────────────────────────────────────────────
def check():
    """Compare this mirror against src/freqAdvisor.js over a spread of inputs."""
    cases = []
    for lat in (-70, -34, 0, 34.9, 60):
        for month in (1, 4, 7, 10):
            for hour in (0, 6, 12, 18):
                cases.append([70, hour, month, lat * 0.9, lat])
    src = ("import('%s/src/freqAdvisor.js').then(f=>{const c=%s;"
           "console.log(JSON.stringify(c.map(a=>f.estimateFoF2(a[0],a[1],a[2],a[3],a[4]))))})"
           % (ROOT, json.dumps(cases)))
    js = json.loads(subprocess.run(['node', '-e', src], capture_output=True,
                                   text=True, cwd=ROOT).stdout.strip())
    worst = 0.0
    for c, v in zip(cases, js):
        mine = est_fof2(*c)
        worst = max(worst, abs(mine - v))
    print('checked %d cases against src/freqAdvisor.js, max difference %.9f MHz'
          % (len(cases), worst))
    if worst > 1e-9:
        print('MIRROR IS OUT OF DATE')
        return 1
    print('mirror matches')
    return 0


if __name__ == '__main__':
    sys.exit(check() if '--check' in sys.argv else 0)
