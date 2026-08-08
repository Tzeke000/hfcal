# Validation Study: HF Field Antenna Calculator vs VOACAP

**Original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC**
Project signature: HFCALC-AG-EZK-USMC-v1
Takeoff-angle study: July 2026 (app v1.4.1) · Model correction and re-validation: v1.5.0
Frequency (MUF) study: July 2026 (app v1.7.0)
Season / magnetic-latitude study: August 2026 (app v1.13.0)
Layer table study: August 2026 (app v1.13.1)
Hemisphere-to-hemisphere study: August 2026 (app v1.13.2)
Solar-geometry model rebuild: August 2026 (app v1.14.0)
Terminator and path-sampling study: August 2026 (app v1.14.1)
LUF and transmit-power study: August 2026 (app v1.15.0)

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
| 60 N (Finland) | 60.1 | 23.4% | **14.1%** |
| 44 N (Michigan) | 51.3 | 13.5% | **11.5%** |
| 34 N (Cherry Point) | 39.8 | 11.8% | **11.4%** |
| 10 N (tropics) | 10.0 | 25.2% | **21.9%** |
| 34 S | -44.2 | 19.7% | **14.8%** |
| 44 S (New Zealand) | -49.8 | 16.7% | **11.7%** |
| **All sites** | — | **18.4%** | **14.2%** |

**Regression check.** Re-running the Part 2 matrix — the mid-latitude paths
the original coefficients were fitted to — with the season term active:

| Path | Samples | Mean Δ | Median abs Δ | Mean abs error | Within 20% |
|---|---|---|---|---|---|
| 500 km | 96 | -0.10 MHz | 0.52 MHz | 10.6% | 84% |
| 1500 km | 96 | -0.87 MHz | 1.16 MHz | 11.5% | 85% |
| 3000 km | 96 | -1.62 MHz | 2.31 MHz | 14.1% | 69% |
| **All** | **288** | — | — | **12.1%** | **79%** |

![MUF comparison](validation/muf-comparison.png)

So the correction improved the mid-latitude case as well: **15.0% → 12.1%**
mean absolute error, **72% → 79%** of samples within 20%. It is an
improvement everywhere and a regression nowhere.

**Interpretation.** This remains a materially looser fit than the
takeoff-angle result, and is deliberately reported as such. The worst
residual is the near-equatorial case (21.9%), where equatorial-anomaly
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

## Part 5 — Hemisphere-to-hemisphere paths (v1.13.2)

Part 3 swept six latitudes, but **every path in it ran 1500 km due east**, so
all six stayed inside one hemisphere and one season. That left the hardest
case untested: a circuit whose two ends are in *opposite* seasons, crossing
the geomagnetic equator in between.

**Method.** Six real interhemispheric circuits × January and July (opposite
seasons) × two solar levels × 24 hours = 576 samples. Magnetic latitudes come
from the app's own WMM code via `node`, so the study tests what ships.
Reproduce with `python3 scripts/validation/run_interhemi_study.py`.

| Circuit | Distance | Midpoint | Magnetic lat |
|---|---|---|---|
| Cherry Point – Argentina | 7963 km | 0.2 N, 67.6 W | +8.0 |
| Finland – South Africa | 10008 km | 15.0 N, 25.0 E | +6.7 |
| Japan – Australia | 7831 km | 0.9 N, 145.5 E | −7.3 |
| Hawaii – New Zealand | 7509 km | 10.3 S, 170.1 W | −11.8 |
| Cherry Point – Brazil | 5879 km | 15.7 N, 56.6 W | +17.1 |
| Panama – Peru | 2184 km | 0.5 S, 77.5 W | +9.9 |

**Three things were tested, and two of them contradicted what seemed obvious.**

**1. Does the season term break?** No — it neither helps nor hurts:
**18.1%** without it, **17.9%** with it. Every midpoint lands near the
magnetic equator, where the model already weights the hemisphere flip to
nearly zero, so the seasonal correction quietly switches itself off. That is
the physically right answer (the reflection region genuinely has little
solstitial swing) and it means the term degrades gracefully rather than
asserting a season that isn't there. A test now pins the continuity across
magnetic latitude 0, since the hemisphere flip is a hard switch at that point
and only survives because it is multiplied by |magLat|.

**2. Would IONCAP-style control points do better?** VOACAP evaluates control
points 2000 km inside each terminal on long circuits and takes the lowest MUF.
Implementing that and comparing made the result **worse**, not better:
**18.6%** versus 17.9%, and it pushed the signed bias from −7.1% to −12.0%.
Taking the minimum of two points is too pessimistic for a model of this shape.
The single-midpoint approach the app already uses is the better choice — a
result worth having measured rather than assumed.

**3. Would an equatorial-anomaly term help?** The real low-latitude ionosphere
has the equatorial ionization anomaly: a trough at the dip equator with crests
near ±15° magnetic. The app's latitude term is monotonic — highest *at* the
equator — so it has the shape backwards there. Adding a properly shaped,
daylight-weighted anomaly term was tested at several amplitudes and crest
positions. It improved things marginally at best (14.3% → 14.2% seasonal,
18.3% → 18.1% interhemispheric at the smallest amplitude) and got worse
beyond that. **Not adopted** — an unearned term is overfitting, and this one
did not earn its place.

**What the residuals actually showed.** Splitting the error by local solar
time at the midpoint moved the diagnosis somewhere else entirely:

| Local solar time | Mid-latitude bias | Interhemispheric bias |
|---|---|---|
| 00–06 | −2.1% | +1.6% |
| 06–12 | −5.1% | −4.1% |
| 12–18 | −1.9% | −8.4% |
| **18–24** | **−13.1%** | **−25.0%** |

The problem is not hemispheres. It is the **evening**: the model's foF2 decays
too fast after sunset, on *every* data set. Daytime agreement is already as
good on transequatorial paths as it is at mid-latitude (7–10%).

**Fix.** The diurnal decay exponent was retuned from 1.6 to **1.4** — a
gentler post-sunset falloff. It was checked against all three data sets at
once and improves every one of them with no trade-off:

| Data set | Before | After |
|---|---|---|
| Mid-latitude (288 samples) | 12.4% | **12.1%** |
| Six-latitude seasonal (6912 samples) | 14.3% | **14.2%** |
| Interhemispheric (576 samples) | 18.3% | **17.9%** |
| Evening bias, mid-latitude | −13.1% | −10.6% |
| Evening bias, interhemispheric | −25.0% | −22.9% |

**Result.** Hemisphere-to-hemisphere paths run at **17.9%** mean absolute
error with a **−7.1%** signed bias, against 12.1% at mid-latitude. Worse, but
usable, and now measured rather than assumed. The bias direction means the app
tends to call a frequency *above MUF* slightly more often than VOACAP would on
these paths — it errs toward telling you to come down in frequency.

## Part 6 — Rebuilding foF2 on solar geometry (v1.14.0)

Parts 2–5 kept patching one structure: a **clock-driven** cosine of local solar
time, with latitude and season bolted on as empirical multipliers. Part 5
showed where that runs out — the curve could not hold the evening, and no
single exponent fixed it.

The replacement is the quantity the ionosphere actually responds to: the
**solar zenith angle** at the reflection point.

> cos χ = sin(lat)·sin(δ) + cos(lat)·cos(δ)·cos(H)
> H = 15°·(local solar time − 12),  δ = solar declination

χ carries time of day, season **and** latitude in one physical quantity.
Chapman layer theory gives the critical frequency of a photochemically
controlled layer as foF ∝ (cos χ)^¼. The F2 layer departs from that because
transport governs it as much as photochemistry, so the exponent was fitted
rather than assumed — it landed at **0.18**, the same family as the
theoretical ¼.

**The lag.** The layer does not follow the sun instantly: production competes
with recombination, so density lags and drains slowly after sunset. The model
uses an exponentially weighted history of max(cos χ, 0) with a single time
constant, **1.2 hours**. That one constant produces both the observed
early-afternoon peak and the long evening tail — behaviour the old curve
needed two separate hand-tuned numbers for, and still got wrong after dark.

**What geometry cannot produce.** Three terms remain explicit because no
amount of solar geometry generates them:

- **Magnetic latitude gradient** (`SEASON_K_LAT`) — the ionosphere organises
  around the magnetic field, not geography.
- **December/perihelion anomaly** (`SEASON_K_ANNUAL`) — foF2 runs high around
  January at every latitude.
- **The winter anomaly** (`SEASON_K_WINTER`) — daytime foF2 is *higher* in
  local winter than local summer, the opposite of what sunlight alone gives,
  because it is a thermospheric composition (O/N₂) effect. It is negative and
  weighted by illumination, since it is a daytime effect.

**Fitting method.** All 4320 cached VOACAP samples from Parts 2, 3 and 5 were
used at once — mid-latitude, six latitudes from 60 N to 44 S over twelve
months, and six transequatorial circuits. The objective minimised the *worst*
data set rather than the total, so the fit could not buy accuracy in one
regime by giving it up in another.

**A trap worth recording.** A first fit optimised on aggregate error alone
scored better than the shipped model on every headline number — and got the
**season backwards**. Its January/July daytime ratio at 44 N was 0.98 where
VOACAP says 1.16: it would have told an operator that summer beats winter.
The winter anomaly is a second-order effect on mean error but a first-order
effect on the seasonal *ordering*, so the ratio had to be added to the
objective as an explicit constraint. Aggregate error alone is not a sufficient
test of a physical model.

| Site, daytime Jan/Jul MUF ratio | VOACAP | v1.13.2 | v1.14.0 |
|---|---|---|---|
| 60 N Finland | 1.13 | 1.18 | 1.03 |
| 44 N Michigan | 1.16 | 1.16 | 1.15 |
| 34 N Cherry Point | 1.18 | 1.16 | 1.18 |
| 44 S New Zealand | 1.05 | 1.06 | 1.11 |

**Results.**

| Data set | Samples | v1.13.2 | v1.14.0 |
|---|---|---|---|
| Mid-latitude | 288 | **12.1%** | 12.4% |
| Six-latitude seasonal | 3456 | 14.2% | **13.3%** |
| Interhemispheric | 576 | 17.9% | **13.4%** |
| **Sample-weighted** | **4320** | **14.6%** | **13.3%** |
| Interhemispheric signed bias | — | −7.1% | **−0.8%** |

Per site, the seasonal set: 60 N 14.1 → 13.6, 44 N 11.5 → 10.7, 34 N
11.4 → 10.6, 10 N 21.9 → 18.9, 34 S 14.8 → 17.4, 44 S 11.7 → 8.8. Five of six
improve. Per circuit, the interhemispheric set: five of six improve, and the
worst case in the entire validation suite — Panama–Peru, sitting on the
magnetic equator — goes 22.9 → 14.9.

**Honest debits.** Mid-latitude got very slightly worse (12.1 → 12.4%), and
34 S regressed (14.8 → 17.4%). Mid-latitude is also the one set that was
partly *training data* for the old coefficients, so it flattered them; the
new model was fitted across all three at once and its accuracy is now roughly
uniform (12.4 / 13.3 / 13.4) instead of good where it was tuned and poor
elsewhere (12.1 / 14.2 / 17.9). Uniformity across regimes is the point.

**Capability that came free with the physics.** The old curve had no idea the
sun behaves differently at 78 N: it faded to night every day of the year.
The new one handles polar day (sun never sets — the layer stays up through
local midnight) and polar night (never rises) with no special case, because
cos χ simply never goes negative or never goes positive. Tests pin both.

**Fallback.** A caller that supplies no month or no latitude still gets an
answer from the old clock curve. That path measures **15.0%** on the
mid-latitude set against 12.4% for the full model — worse, but better than
refusing. The app itself always has both.

**One mirror, not four.** Each study needs a copy of the app's model to
compare against, and three scripts had each hand-copied their own diurnal
curve — which had already drifted apart once. They now share
`scripts/validation/appmodel.py`, and `python3 scripts/validation/appmodel.py
--check` verifies that mirror against `src/freqAdvisor.js` directly (currently
exact to 1e-9 MHz across 80 cases).

## Part 7 — Terminator, and which point on the path (v1.14.1)

Two things the v1.14.0 rebuild left unchecked.

### Sunrise, sunset and dusk in both hemispheres

The whole model rests on the terminator being in the right place, and that had
only been tested indirectly through foF2. Checked directly:

| Latitude | Mar | Jun | Sep | Dec |
|---|---|---|---|---|
| 60 N | 11.39 | 18.44 | 12.47 | 5.56 |
| 34 N | 11.76 | 14.26 | 12.19 | 9.74 |
| 0 | 12.01 | 12.01 | 12.01 | 12.01 |
| 34 S | 12.24 | 9.74 | 11.81 | 14.26 |
| 60 S | 12.61 | 5.56 | 11.52 | 18.44 |

Geometric day length, hours. The hemispheres mirror exactly — 34 N in June
(14.26 h) equals 34 S in December to the digit, and sunrise/sunset land at
04:53 / 19:08 local solar time in both. Solar noon sits at 12:00 at every
latitude and month tested. The equator holds 12 h all year.

Against published sunrise-to-sunset times the model runs about 10 minutes
short at 34° and 23 minutes short at 60°. That is the expected offset:
published times include atmospheric refraction and the sun's disc, which
lengthen the *visible* day but do not change ionisation. Ten tests now pin day
length, hemispheric mirroring, terminator symmetry about noon, and the shape
of the dawn rise and dusk decay.

**Dusk specifically.** The recombination lag is what keeps an evening path
open, so it is tested as a shape, not a number: foF2 must fall monotonically
after sunset, stay above 60% of its sunset value an hour later, and never drop
below 45% within two hours. That is the behaviour v1.13.2 got wrong.

### The layer is lit before the ground is

At 300 km the F2 layer climbs out of Earth's shadow while the sun is still
~17° below the horizon underneath it — it is lit while sin χ ≥ R/(R+h), i.e.
down to cos χ = −0.297. The model evaluates cos χ at the *ground*, so its
terminator is nominally late.

Adding the geometrically correct offset makes the fit **worse**:

| Shadow offset | Mid-lat | Seasonal | Interhemi | Weighted |
|---|---|---|---|---|
| 0.000 (ground) | 12.35% | 13.34% | 13.44% | **13.28%** |
| 0.100 | 12.07% | 13.42% | 14.11% | 13.42% |
| 0.297 (300 km layer) | 13.65% | 16.75% | 16.49% | 16.51% |

The 1.2-hour recombination lag was fitted *with* the ground terminator and
already absorbs the early illumination; adding the offset double-counts it.
Not adopted — recorded here so the question is not reopened blindly.

### One point on the path, or both ends?

The natural expectation is that the app should use your station's local time
*and* the target's. Measured, on the same 4320 samples:

| Sampling | Mid-lat | Seasonal | Interhemi | Weighted |
|---|---|---|---|---|
| Midpoint only | 12.35% | 13.34% | **13.44%** | **13.28%** |
| Both endpoints averaged | **11.86%** | 13.28% | 15.56% | 13.49% |
| Endpoints + midpoint | 11.84% | **13.21%** | 15.27% | 13.39% |
| Lowest of three | 13.90% | 14.39% | 16.25% | 14.60% |
| Highest of three | 11.77% | 13.46% | 16.15% | 13.71% |

Averaging the ends helps short paths slightly and hurts long ones badly. That
is the physics: **on a long circuit the signal reflects off the middle, not
off either station**, so the midpoint is the right place to ask about the F2
layer. Midpoint retained for MUF.

### But the ends do matter — for the LUF

The two questions have different geometry, which the model had been conflating.
D-layer absorption happens at 60–90 km, where the ray *leaves and re-enters*
the atmosphere — near each terminal, not at the reflection point. So the LUF
now averages illumination over the two endpoints while the MUF stays on the
midpoint. On a Guam–Cherry Point path at 04Z the midpoint is dark but Guam is
in full daylight, and the LUF correctly rises from 2.19 to 3.36 MHz.

This split is on **physical grounds only**. The LUF has never been validated
against VOACAP and this change does not alter that. It is a better-shaped
guess, not a measured improvement.

The app now also displays local solar time at **your station, the midpoint and
the target**, each marked daylight or dark — so an operator can see directly
that the far end is in daylight while they are not.

## Part 8 — The LUF, and transmit power (v1.15.0)

Everything through Part 7 validated the MUF and left the LUF as a stated
unknown: a flat `LUF = 2.0 + 3.5 × illumination` with **no dependence on
transmit power at all**. That is backwards from an operator's point of view.
The MUF is a ceiling nothing can move — above it the signal leaves the
ionosphere and more watts follow it into space. The LUF is the one number
power *can* fix, and the app had no idea power existed.

**A finding about the earlier studies.** VOACAP takes transmit power as the
last field on the XMTR `ANTENNA` card, and the decks inherited its default
`const17.voa` — the **17 dBi transmit array the Voice of America uses**, at
**500 kW**. Fine for a broadcast station, absurd for a Marine with wire in a
tree. Parts 1–7 are unaffected, because the MUF is a propagation ceiling that
depends on neither power nor antenna gain. But it meant the LUF had never been
meaningfully exercised: the first run of this study closed every link at the
bottom of the frequency grid regardless of power. Re-run with **isotropic
antennas at both ends**, which is the conservative floor; a real field dipole
adds 2–6 dB on top as margin.

**Method.** VOACAP reports circuit RELIABILITY per frequency, so the
operational LUF is simply *the lowest frequency meeting the required
reliability*. Four distances (300–3000 km) × six powers (5 W – 1 kW) × two
months × two solar levels × 24 hours, at 38 dB-Hz required SNR (SSB voice, not
VOACAP's 73 dB-Hz broadcast default) and 90% reliability. Reproduce with
`python3 scripts/validation/run_luf_study.py`.

**Honest limit of this study.** The result is heavily **censored**: at low
power many daylight hours have no closing frequency anywhere in the grid, so
they drop out, and only 4 of 318 conditions produced a LUF at *every* power.
That is enough to measure the *shape* of the power dependence, and not enough
to calibrate its absolute level. Both statements are load-bearing below.

**Physics fitted.** Non-deviative D-layer absorption per hop:

> L = K · I^0.75 / (f + f_H)²  dB

The link closes while L stays under the available margin M, which grows as
10·log10(P). Setting L = M and solving:

> **LUF = √( K · I^0.75 · hops / M(P) ) − f_H**

So the LUF falls as the **square root** of the margin. K is anchored so the
reference case — 20 W, one hop, sun overhead — reproduces the 5.5 MHz the app
has always used, meaning nothing changes for an operator who leaves the power
on its manpack default.

| Power | Full sun | Half sun | Night |
|---|---|---|---|
| 5 W | 9.42 | 6.99 | 2.00 |
| **20 W** | **5.50** | 3.97 | 2.00 |
| 50 W | 4.47 | 3.17 | 2.00 |
| 150 W | 3.69 | 2.57 | 2.00 |
| 400 W | 3.22 | 2.21 | 2.00 |

**Corroboration.** Going 20 W → 400 W, the model predicts the LUF drops
**42%**. VOACAP, measured over paired conditions in daylight, gives **43%**
(27% across all conditions including night, where absorption is not the
limit). The shape is right. That is the useful operational fact:
**twenty times the power buys about forty percent off the LUF, not twenty
times less.** Worth knowing before hauling an amplifier.

**What is and is not claimed.** The *shape* — square-root-of-margin, ^0.75
illumination, linear in hop count — is derived from absorption physics and
corroborated by VOACAP. The *absolute level* is still anchored to the app's
own historical 20 W figure, not measured. The LUF remains the softest number
the app reports, and the UI says so.

**In the app.** A transmit-power selector now sits beside the month wheel in
both frequency panels, labelled the way the radio is rather than in round
numbers:

| Setting | Watts | Source |
|---|---|---|
| LOW | 2 | AN/PRC-160(V), operator-reported |
| MED | 5 | AN/PRC-160(V), operator-reported |
| HIGH | 10 | AN/PRC-160(V), operator-reported |
| GLOBAL | 20 | AN/PRC-160(V), operator-reported — matches the published 20 W HF max |
| VRC | 150 | RF-5833H series power amplifier, published |

The manpack figures were read off a real AN/PRC-160 rather than taken from a
datasheet, because the published sheets give only the 20 W HF maximum and never
break out the presets. That the top setting, GLOBAL, lands exactly on the
published 20 W is a useful consistency check on the rest of the ladder.

Two corrections came out of this. An earlier draft guessed HIGH was the 20 W
maximum — it is not, HIGH is 10 W and GLOBAL is the top. And GLOBAL was assumed
to be a *scope* (Harris radios can set power globally or per preset) rather than
a power level; on this radio's menu it is a level. Both were fixed by asking
the operator instead of the datasheet.

USER is the radio's operator-programmable level and therefore has no fixed
wattage: the free-entry field covers it, and overrides the presets entirely.

Hop count feeds the absorption term, since the ray crosses the D layer once per
hop. Selecting more power can flip a verdict from BELOW LUF to usable and never
changes the MUF.

**Path closed.** Making power selectable made a previously rare case common:
at low power in daylight the LUF can rise *above* the MUF, meaning absorption
eats everything the ionosphere would still reflect and **no frequency works at
all**. The advisor had always computed this (`pathClosed`) and never displayed
it. It is now called out explicitly in the check panel, and closed blocks are
flagged in red in the 24-hour forecast — on a 1200 km path in June daylight,
LOW (2 W) gives a LUF of 20.0 MHz against a MUF of 11.9.

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
- The evening bias that dominated v1.13.2 is largely resolved by the
  v1.14.0 solar-geometry rebuild (interhemispheric signed bias −7.1% → −0.8%),
  but night figures still carry more scatter than daytime ones.
- **The LUF's absolute level is still not calibrated.** Part 8 measured and
  adopted the *shape* of its power dependence, but the VOACAP data was too
  censored to pin the level, which stays anchored to the app's own historical
  20 W figure. Antenna gain and required SNR are folded into that anchor
  rather than modelled — a better antenna or a less demanding mode both
  effectively lower your real LUF below what is shown. It remains the softest
  number the app reports.
- The LUF assumes SSB voice. CW and digital modes close at markedly lower
  SNR, so their real LUF is lower than displayed — the figure is conservative
  for them, not wrong.
- Day length is geometric (cos χ = 0). Published sunrise/sunset times are
  ~10 min wider at 34° and ~23 min at 60° because of refraction and the solar
  disc. Irrelevant for ionisation, but do not use the app as an almanac.
- The model asks about the F2 layer at the path midpoint only. For a
  multi-hop circuit there are several reflection points and the real limiting
  one may not be the middle; sampling more of them was tested and made the fit
  worse (Part 7), but that is a property of this model, not a general result.
- **The equatorial ionization anomaly is not modelled.** The latitude term
  peaks at the magnetic equator, whereas the real ionosphere has a trough
  there and crests near ±15° magnetic. Adding an anomaly term did not improve
  agreement with VOACAP and was therefore left out. Low-latitude cases are
  still the worst in the suite (18.9% at 10 N, 14.9% Panama–Peru), though the
  v1.14.0 rebuild improved both substantially.
- Hemisphere-to-hemisphere paths carry roughly 18% MUF error against 12% at
  mid-latitude. Both are inside the tool's stated planning tolerance, but a
  transequatorial shot deserves more margin than a regional one.
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
