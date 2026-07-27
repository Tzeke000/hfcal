# Validation Study: HF Field Antenna Calculator vs VOACAP

**Original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC**
Project signature: HFCALC-AG-EZK-USMC-v1
Study date: July 2026 · App version: 1.4.1

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
- **App model under test** (identical code path to the UI —
  `src/propagation.js`): hops = ⌈d / 4500⌉, takeoff angle
  α = atan(2·330 / hop distance), clamped 3–85°. Static F2 height, no solar
  or diurnal input, by design.
- **Comparison:** app angle vs the median and min–max envelope of VOACAP
  TANGLE across all F2-mode cells with the same hop count.

Reproduce with: `python3 scripts/validation/run_voacap_study.py`
(raw data: `docs/validation/voacap-results.json`).

## Results

| Distance | App angle (hops) | VOACAP median | VOACAP range | Δ vs median | In envelope |
|---|---|---|---|---|---|
| 250 km | 69.3° (1) | 70.1° | 56.9–74.1° | −0.8° | yes |
| 500 km | 52.9° (1) | 53.4° | 22.5–59.4° | −0.5° | yes |
| 770 km | 40.6° (1) | 40.3° | 25.6–46.3° | +0.3° | yes |
| 1000 km | 33.4° (1) | 32.2° | 11.7–38.5° | +1.1° | yes |
| 1500 km | 23.7° (1) | 21.4° | 12.3–27.1° | +2.3° | yes |
| 2000 km | 18.3° (1) | 14.6° | 7.3–20.2° | +3.8° | yes |
| 2500 km | 14.8° (1) | 10.0° | 3.7–15.3° | +4.8° | yes |
| 3000 km | 12.4° (1) | 7.2° | 1.4–13.5° | +5.2° | yes |
| 4000 km | 9.4° (1) | 2.4° | 0.6–6.6° | +7.0° | **no** |
| 6000 km | 12.4° (2) | 7.5° | 1.8–11.4° | +4.9° | **no** |

![Takeoff angle comparison](validation/takeoff-angle-comparison.png)

## Findings

**1. In the app's designed regime — NVIS and single-hop tactical HF
(0–2000 km) — agreement is excellent.** Deltas against the VOACAP median are
0.3–3.8°, well inside VOACAP's own day/season/solar spread. At the
distances where the app computes antenna heights for its dipole-family
recommendations (NVIS through ~2000 km single-hop), the static model is
effectively indistinguishable from carrying VOACAP into the field.

**2. Hop-count agreement.** The app's hop model matches VOACAP's dominant
mode at every distance except 4000 km, where VOACAP already prefers `2F2`
while the app's single-hop limit (4500 km, the geometric maximum) still
permits one hop. Both agree again at 6000 km (2 hops).

**3. Beyond ~2500 km the app reads consistently high (+5–7°).** The cause
is physical and known: the flat-earth approximation ignores Earth
curvature, which progressively lowers the true required takeoff angle on
long single hops. Two mitigating factors limit the practical impact:

- At these distances the app's recommendation engine has already switched
  away from computed-height dipoles to sloper / EFHW / long-wire guidance
  ("lowest achievable takeoff angle"), so the divergent number is not
  driving a wire cut or mast height in the current UI.
- The error is in the conservative direction for construction: a
  higher-angle assumption yields a *shorter* required mast, never an
  unbuildable one.

**4. Recommended model improvement (planned).** Replacing the flat-earth
baseline with the exact curved-earth expression
α = atan[(cos(d/2R) − R/(R+h)) / sin(d/2R)] would cut the long-range bias
substantially (e.g. 3000 km: 5.3° vs VOACAP's 7.2°, versus 12.4° today)
at zero cost to the 0–2000 km regime. Tracked as future work; the existing
unit-test suite (`npm test`) will pin the corrected values.

## Limitations

- VOACAP itself is a statistical monthly-median model, not ground truth;
  agreement with VOACAP demonstrates consistency with the planning standard,
  not with any specific day's ionosphere.
- One transmitter site and one azimuth were used; TANGLE is dominated by
  path length and ionospheric height, so geographic sensitivity is second
  order for this comparison.
- The app's terrain adjustments (obstacle clearance, ocean/desert biases)
  were disabled (no-terrain baseline) since VOACAP models none of them.
- Antenna patterns in the VOACAP decks (isotropic-class TX, whip RX) affect
  mode *selection* at the margin, not the geometry of a given mode.

## Conclusion

For the mission the tool is built for — field-expedient NVIS and single-hop
HF antenna construction without connectivity — the HF Field Antenna
Calculator's recommendations are consistent with VOACAP to within a few
degrees, inside VOACAP's own environmental spread, using nothing but
geometry that runs offline on a phone. Known long-range divergence is
characterized, conservative in direction, outside the tool's
computed-height use cases, and has a planned correction.
