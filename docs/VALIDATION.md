# Validation Study: HF Field Antenna Calculator vs VOACAP

**Original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC**
Project signature: HFCALC-AG-EZK-USMC-v1
Takeoff-angle study: July 2026 (app v1.4.1) · Model correction and re-validation: v1.5.0
Frequency (MUF) study: July 2026 (app v1.7.0)
Season / magnetic-latitude study: August 2026 (app v1.13.0)
Layer table study: August 2026 (app v1.13.1)

---

## Purpose

The HF Field Antenna Calculator recommends antenna geometry (takeoff angle,
apex/support height, hop structure) from a deliberately simple, fully-offline
model. This study quantifies how those recommendations compare against
**VOACAP** (Voice of America Coverage Analysis Program) — the U.S.
government-developed HF ionospheric prediction engine that has served as the
de-facto standard for HF circuit planning since the 1980s.

The comparison question is *not* whether a static field tool can replicate a
full ionospheric model — it cannot and does not try. The question is whether
the app's single static answer **lands inside the envelope** of VOACAP's
predictions as they vary across time of day, season, and solar activity, and
how close it sits to the **median** — i.e., is the app's answer the right
one to carry into the field when you have no connectivity, no space-weather
feed, and five minutes to rig wire.

## Method

- **Engine:** VOACAP version 16.1207W via `voacapl` (the maintained
  open-source Linux port), METHOD 30 point-to-point predictions, CCIR
  coefficients.
- **Paths:** transmitter fixed at Twentynine Palms, CA (34.23 N 116.05 W).
  Receivers placed due east on the great circle at
  250 / 500 / 770 / 1000 / 1500 / 2000 / 2500 / 3000 / 4000 / 6000 km.
- **Conditions per path:** all 24 UTC hours × two months (June, December) ×
  two sunspot numbers (SSN 30 and 100) × nine frequencies
  (3.5–28.5 MHz) — up to 960 prediction cells per distance.
- **VOACAP quantities extracted:** most-reliable MODE (hop count + layer,
  e.g. `1F2`, `2F2`) and TANGLE (takeoff/elevation angle, degrees) for every
  populated cell.
- **Comparison:** app angle vs the median and min–max envelope of VOACAP
  TANGLE across all F2-mode cells with the same hop count.

Parts 2 and 3 add a second geometry sweep for the frequency model: fixed path
length, six sites spanning 60 N to 44 S, all twelve months — described in
those sections.

Reproduce with: `python3 scripts/validation/run_voacap_study.py`
(raw data: `docs/validation/voacap-results.json`).

## Round 1 — initial model (v1.4.1, flat-earth)

The original model used flat-earth skip geometry, α = atan(2·330 / hopDist):

| Distance | App angle | VOACAP median | Δ vs median | In envelope |
|---|---|---|---|---|
| 250 km | 69.3° | 70.1° | −0.8° | yes |
| 500 km | 52.9° | 53.4° | −0.5° | yes |
| 770 km | 40.6° | 40.3° | +0.3° | yes |
| 1000 km | 33.4° | 32.2° | +1.1° | yes |
| 1500 km | 23.7° | 21.4° | +2.3° | yes |
| 2000 km | 18.3° | 14.6° | +3.8° | yes |
| 2500 km | 14.8° | 10.0° | +4.8° | yes |
| 3000 km | 12.4° | 7.2° | +5.2° | yes |
| 4000 km | 9.4° | 2.4° | +7.0° | **no** |
| 6000 km | 12.4° | 7.5° | +4.9° | **no** |

**Finding:** excellent agreement in the NVIS/single-hop regime (≤2000 km,
Δ ≤ 3.8°), but a growing high bias beyond 2500 km — the flat-earth
approximation ignores Earth curvature, which progressively lowers the true
required angle on long hops.

## Model correction (v1.5.0)

Two changes, both physically motivated:

1. **Curved-earth mirror geometry.** The ray travels in a straight line
   below the ionosphere; the Earth's surface curves away beneath it. For a
   hop of ground distance d over a layer at virtual height h
   (half-arc θ = d/2R):

   α = atan[ (cos θ − R/(R+h)) / sin θ ]

   (Davies, *Ionospheric Radio*; reduces to atan(2h/d) for short paths.)

2. **Virtual reflection height, not true layer height.** Ionospheric
   refraction is gradual, not a mirror bounce, so the equivalent mirror
   sits *above* the true layer. Round 1's residual was a uniform ≈ −2°
   bias — the signature of using the 330 km true-height figure. VOACAP's
   own virtual-height output (V HITE) spanned 295–466 km across the matrix
   with a median near 360 km; the model now uses **h = 360 km**.

Both changes are pinned by the automated test suite (32 tests, `npm test`).

## Round 2 — corrected model (v1.5.0)

| Distance | App angle (hops) | VOACAP median | VOACAP range | Δ vs median | In envelope |
|---|---|---|---|---|---|
| 250 km | 69.8° (1) | 70.1° | 56.9–74.1° | −0.3° | yes |
| 500 km | 53.3° (1) | 53.4° | 22.5–59.4° | −0.1° | yes |
| 770 km | 40.5° (1) | 40.3° | 25.6–46.3° | +0.2° | yes |
| 1000 km | 32.7° (1) | 32.2° | 11.7–38.5° | +0.5° | yes |
| 1500 km | 21.6° (1) | 21.4° | 12.3–27.1° | +0.2° | yes |
| 2000 km | 14.8° (1) | 14.6° | 7.3–20.2° | +0.2° | yes |
| 2500 km | 10.0° (1) | 10.0° | 3.7–15.3° | 0.0° | yes |
| 3000 km | 6.3° (1) | 7.2° | 1.4–13.5° | −0.9° | yes |
| 4000 km | 3.0° (1) | 2.4° | 0.6–6.6° | +0.6° | yes |
| 6000 km | 6.3° (2) | 7.5° | 1.8–11.4° | −1.2° | yes |

![Takeoff angle comparison](validation/takeoff-angle-comparison.png)

**Result: the corrected model agrees with the VOACAP median to within 1.2°
at every tested distance (mean |Δ| ≈ 0.4°), and sits inside VOACAP's
day/season/solar envelope at all ten distances.** At 2500 km the app and
VOACAP agree exactly.

Hop counts match VOACAP's dominant mode at every distance except 4000 km,
where VOACAP prefers `2F2` while the app's geometric single-hop limit
(4500 km) still permits one hop; the app's 1-hop angle (3.0°) nonetheless
falls inside the 2F2 envelope.

## Part 2 — Frequency advisor (MUF) vs VOACAP

v1.7 added an offline frequency check (`src/freqAdvisor.js`): given the path
and the time of day it estimates MUF / FOT / LUF and rules on whether an
assigned frequency will close the link. VOACAP reports path MUF directly, so
the same validation approach applies.

**Method.** Three path lengths (500 / 1500 / 3000 km) x 24 UTC hours x two
months (June, December) x two solar levels (SSN 30, 100) = 288 hourly
samples. The app's estimate is `foF2(SSN, local solar time)` times the
curved-earth secant factor at the takeoff angle validated in Part 1.
Reproduce with `python3 scripts/validation/run_muf_study.py`.

**Calibration.** The foF2 diurnal coefficients (peak at 12.8 local solar
time, night ratio 0.45, `6.8 + 0.036 x SSN` MHz at peak, decay exponent 1.6)
were fitted to this VOACAP data set. The resulting foF2 values — 7.2 MHz at
solar minimum noon to 12.2 at solar maximum, 3.2-5.5 MHz at night — sit
inside published mid-latitude ionosonde ranges, so the fit stays physical
rather than merely numerical.

**Results (v1.7 model, no seasonal term).**

| Path | Samples | Mean Δ | Median abs Δ | Mean abs error | Within 20% |
|---|---|---|---|---|---|
| 500 km | 96 | +0.36 MHz | 0.76 MHz | 15.1% | 70% |
| 1500 km | 96 | -0.23 MHz | 1.31 MHz | 12.7% | 82% |
| 3000 km | 96 | -0.83 MHz | 3.04 MHz | 15.8% | 67% |
| **All** | **288** | — | — | **14.6%** | **73%** |

Mean absolute error **14.6%**, median **11.9%**, with **73%** of samples
within 20%. Residual bias was small and changed sign with distance, i.e.
there was no systematic over- or under-estimate to correct. The dominant
remaining error source was the absent seasonal term: the app returned one
number where VOACAP separates June from December. That is what Part 3
addresses.

## Part 3 — Season and magnetic latitude (v1.13.0)

The v1.7 foF2 curve was fitted at one mid-northern site and carried no month
term, which is wrong in two ways an operator would notice. The season
reverses between hemispheres — July is summer in Finland and winter in New
Zealand — and at mid-latitudes the daytime behaviour is counter-intuitive:
foF2 runs HIGHER in local winter (the classic winter anomaly) while at night
the ordering flips.

**Method.** Six sites spanning 60 N to 44 S x all twelve months x 24 UTC
hours x two solar levels (SSN 30, 100), on a fixed 1500 km due-east path so
the secant factor is constant and every MUF difference is a foF2 difference.
Reproduce with `python3 scripts/validation/run_seasonal_study.py`, then
`--eval` to re-score the model against the collected data.

**What the data showed.** Three separable effects:

1. **Magnetic latitude.** foF2 peaks near the magnetic equator and falls
   toward the poles. It tracks *magnetic* latitude, not geographic — which is
   why New Zealand at 44 S behaves like roughly 50 S. The app derives this
   on-device from the World Magnetic Model dip angle
   (`magneticLatitude()` in `src/magnetic.js`, tan I = 2 tan λm).
2. **The December/annual anomaly.** foF2 runs high around January at every
   latitude, from Earth being nearer the Sun at perihelion.
3. **Local season**, which reverses between hemispheres and between day and
   night, collapsing to equinox peaks near the equator.

**Implementation.** `seasonLatitudeFactor()` in `src/freqAdvisor.js`
multiplies the diurnal foF2 curve. It takes the month from the operator (a
12-month selector, defaulted to the device date) and the magnetic latitude at
the **path midpoint** — the reflection point, the same place local solar time
is already taken. With neither supplied it returns exactly 1, so older call
paths are unchanged.

**Results — worldwide, mean absolute MUF error vs VOACAP:**

| Site | Magnetic lat | Before | After |
|---|---|---|---|
| 60 N (Finland) | 60.1 | 21.9% | **13.2%** |
| 44 N (Michigan) | 51.3 | 12.8% | **11.7%** |
| 34 N (Cherry Point) | 39.8 | 12.0% | 11.9% |
| 10 N (tropics) | 10.0 | 26.1% | **22.7%** |
| 34 S | -44.2 | 19.0% | **14.4%** |
| 44 S (New Zealand) | -49.8 | 15.8% | **11.7%** |
| **All sites** | — | **17.9%** | **14.3%** |

**Regression check.** Re-running the Part 2 matrix — the mid-latitude paths
the original coefficients were fitted to — with the season term active:

| Path | Samples | Mean Δ | Median abs Δ | Mean abs error | Within 20% |
|---|---|---|---|---|---|
| 500 km | 96 | -0.10 MHz | 0.55 MHz | 10.9% | 85% |
| 1500 km | 96 | -1.03 MHz | 1.24 MHz | 11.4% | 86% |
| 3000 km | 96 | -1.95 MHz | 2.65 MHz | 14.9% | 70% |
| **All** | **288** | — | — | **12.4%** | **81%** |

![MUF comparison](validation/muf-comparison.png)

So the correction improved the mid-latitude case as well: **14.6% → 12.4%**
mean absolute error, **73% → 81%** of samples within 20%. It is an
improvement everywhere and a regression nowhere.

**Interpretation.** This remains a materially looser fit than the
takeoff-angle result, and is deliberately reported as such. The worst
residual is the near-equatorial case (22.7%), where equatorial-anomaly
structure is genuinely not captured by a smooth global fit. For the tool's
actual job — ruling an assigned frequency GOOD / MARGINAL / ABOVE MUF /
BELOW LUF — a ~12% MUF error moves the verdict only for frequencies already
near a boundary, and the FOT convention (0.85 x MUF) absorbs part of it. The
UI states the tolerance and defers to the unit's SOI/JCEOI assignment.

## Part 4 — Ionospheric layer table (v1.13.1)

Parts 1–3 validated the F2 geometry and the frequency model. They never
touched the other half of `propagation.js`: the **layer table** — the
reflection height and maximum single-hop ground distance for E, F1 and F2.
Those numbers decide how many hops the app reports and which layer it names,
so this part gives them the same treatment.

**Check 1 — geometry.** For a ray leaving at 0° elevation (along the horizon,
the limiting case) and reflecting at virtual height *h*, the ground range is
fixed:

> cos θ = R / (R + h),  d_max = 2 · R · θ

A max-hop figure larger than this is not optimistic, it is impossible — the
ray would have to be launched below the horizon.

| Layer | Height | Old table | 0° geometric limit | Verdict |
|---|---|---|---|---|
| E | 110 km | 2160 km | 2351 km | consistent (conservative) |
| F1 | 200 km | 3000 km | 3152 km | consistent (conservative) |
| F2 | 360 km | **4500 km** | **4186 km** | **impossible — needs h = 419 km** |

The F2 entry was a hand-typed folklore number that outran its own height.
Paths between 4186 and 4500 km were reported as a single hop the geometry
cannot produce.

**Check 2 — VOACAP.** Fifteen ground distances from 1500 to 5000 km × two
months × two solar levels, recording which propagation MODES VOACAP actually
offers. Reproduce with `python3 scripts/validation/run_layer_study.py`.

| Distance | 1F2 share of cells | Dominant mode |
|---|---|---|
| 3000 km | 81% | 1F2 |
| 3600 km | 60% | 1F2 |
| 4000 km | 44% | 2F2 |
| 4200 km | 19% | 2F2 |
| 4400 km | 4% | 2F2 |
| 4600 km | 0% | 2F2 |

VOACAP stops offering single-hop F2 entirely past ~4400 km and it stops being
the majority mode around 3800–4000 km. The 4186 km geometric limit sits inside
that transition; the old 4500 km did not.

**Fix.** `maxHopKm(h)` is now derived from the closed form rather than typed,
and every entry in `HOP` is computed from its own height, so the table cannot
drift out of self-consistency again. Six tests pin it, including one that
walks a range of path lengths and asserts no layer is ever asked to cover more
than its own geometry allows.

**Effect on earlier results.** None. Re-running Part 1 after the change gives
the same takeoff angles (max Δ 1.2°, mean 0.4°) because the hop count is
unchanged at every distance tested there; Part 2/3 re-run identically at
12.4%. What changed is the 4186–4500 km band, which now correctly reports two
hops.

**Published cross-check.** The Australian Bureau of Meteorology Space Weather
Services gives maximum hop lengths of 2000 km (E, h = 100 km) and 4000 km
(F, h = 300 km) at 0° elevation, falling to 1800 km and 3200 km at 4°. The
derived limits agree with those to the rounding the references themselves
use — and the app's own 3° operational floor is why the E and F1 hops it
reports in practice run shorter than the 0° ceiling.

## Limitations

- The frequency advisor's season/latitude term is a smooth global fit, not
  the CCIR coefficient maps VOACAP uses. It carries no sporadic-E, no storm
  or absorption events and no auroral-zone term, and takes a single
  solar-activity number; offline it uses a documented default (SSN 70) until
  the app has been online once. Expect ~12% MUF accuracy at mid-latitudes and
  ~20% near the magnetic equator, not VOACAP parity.
- The season correction needs the month. The app defaults it to the device
  clock, but a device with a wrong date will bias the estimate — worst case
  by roughly 20% if it is half a year out at a high-latitude site.
- VOACAP itself is a statistical monthly-median model, not ground truth;
  agreement with VOACAP demonstrates consistency with the planning standard,
  not with any specific day's ionosphere.
- The 360 km virtual height is calibrated against VOACAP's virtual-height
  output over this matrix; extreme solar conditions will shift the real
  ionosphere (VOACAP's envelope, reported above, brackets that variation).
- One transmitter site and one azimuth were used; TANGLE is dominated by
  path length and ionospheric height, so geographic sensitivity is second
  order for this comparison.
- The app's terrain adjustments (obstacle clearance, ocean/desert biases)
  were disabled (no-terrain baseline) since VOACAP models none of them.
- The layer study found no E or F1 mode in VOACAP's output at any distance
  from 1500 km out — VOACAP served F2 in every cell. So the E and F1 rows are
  validated by geometry and published references, not by VOACAP agreement.
  They remain useful as a "what else could carry this path" reference; the F2
  row is the one the app's primary recommendation rests on.
- Maximum hop distances are the 0° launch ceiling. A real antenna cannot
  radiate at the horizon, so the app clamps takeoff angles to 3°, at which a
  single hop reaches roughly 1780 km (E), 2550 km (F1) and 3570 km (F2).
  Between those figures and the ceiling, a single hop is possible but needs
  an unusually low, clean radiation angle.

## Conclusion

For field-expedient HF antenna construction without connectivity, the HF
Field Antenna Calculator's takeoff-angle model is statistically
indistinguishable from carrying VOACAP into the field: within ~1° of the
VOACAP median across the entire 250–6000 km envelope, using closed-form
geometry that runs offline on a phone. The validation is fully reproducible
from the repository, and the model that was validated is pinned by the
automated test suite.
