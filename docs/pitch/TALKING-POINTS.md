# Talking Points — Why This Matters

**HF Field Antenna Calculator · Cpl Angeles-Gonzalez, Ezekiel S., USMC**

---

## The one-liner

> Every HF planning tool the military owns lives on a laptop at the S-6 shop.
> This puts the same math — validated against VOACAP to within about a
> degree — in the hand of the Marine standing at the wire, with no network,
> no login, and construction steps included.

## The 30-second version

Distributed operations doctrine assumes we lose SATCOM. The fallback is HF,
and HF lives or dies on antenna geometry: the wrong height or cut on a wire
antenna is the difference between comms and silence. That knowledge used to
live in senior 06xx operators, and it has eroded for twenty years while we
leaned on satellites. This app compresses it into a phone tool that works in
airplane mode: two grids and a frequency in, a complete buildable antenna
out — cut lengths for whatever wire you actually have, computed mast height
for the path, step-by-step build instructions written for issued gear. Its
physics has been validated against VOACAP, the government's own HF
prediction standard, and agrees within about one degree across the whole
250–6000 km envelope.

## What the military has today — and the gap

Be precise about this; overclaiming kills credibility. The military's
existing HF tools are *good* — they're just not where the antenna is.

| Existing capability | What it is | The gap this app fills |
|---|---|---|
| **VOACAP** and derivatives | The government-standard ionospheric prediction engine since the 1980s. Accurate, free, trusted. | Desktop software for a trained analyst with time. Nobody runs VOACAP kneeling next to a wire spool. **This app matches its takeoff-angle output within ~1° (measured, reproducible) and runs offline on a phone.** |
| **Comm planning suites (e.g. SPEED)** | Planner-grade propagation and link tools at the S-6/planner level. | Laptop tools for planners, not operators. The output reaches the Marine as a frequency assignment — not as "cut 19 ft 8 in per leg, apex at 16 ft." |
| **The USMC Antenna Handbook** (formerly MCRP 6-22D) and similar references | The doctrinal antenna reference. Excellent theory. | A static book of formulas and generic figures ("468/f", "30–40 ft"). No path-specific computation, no wire-material correction, no feasibility check. This app **is** that handbook's math, executed instantly and specifically. |
| **Modern HF radios (ALE / 3G HF)** | The radio finds the best *frequency* automatically. | ALE optimizes what the antenna gives it. It cannot fix an antenna cut wrong or hung at the wrong height — the single largest factor still left to the human. |
| **Senior operator experience** | The real legacy system. | Non-scalable, unevenly distributed, and thinning. This app is that experience, written down, tested, and issued to everyone. |

**The honest framing:** this is not "more accurate than VOACAP." VOACAP *is*
the standard, and this app measurably matches it in its regime. The claim
is: **the standard's accuracy, in places the standard has never been able
to go** — offline, at the point of construction, in the hands of a boot
Lance Corporal.

## Where it is genuinely better than anything fielded

1. **Point of need.** It's the only tool in this space that works at the
   antenna site: phone, offline, zero setup, under a minute from grids to
   cut lengths.
2. **Field-expedient wire modeling.** Velocity-factor corrections for
   galvanized steel, stainless, iron salvage, speaker wire — by core AND
   gauge. Planning tools assume catalog antennas; this models the wire you
   scrounged. No fielded tool does this.
3. **Buildability checking.** It doesn't just give the radiation-optimal
   height — it checks whether ¼-wave legs can physically reach it, and when
   they can't, tells you the buildable maximum, what you lose, and how to
   fix it (raise the ends, or switch to a flat dipole). Tools that assume
   ideal antennas skip this entirely.
4. **It teaches.** Formulas are shown, not hidden. It doubles as a
   schoolhouse aid for the 06xx pipeline — the same tool trains and fields.
5. **Terrain awareness built in.** Ridge-clearance angle adjustments, ocean
   and desert path corrections — automatically, from the same two grids.
6. **EMCON-clean.** No account, no telemetry, no network requirement. The
   optional NOAA space-weather feed fetches only when online and fails
   silent. Nothing phones home. Cyber review is short because there is
   almost nothing to review.
7. **Free and already deployed.** PWA, Windows executable, Android-buildable.
   A unit can evaluate it today at zero cost and zero risk.

## Proof points (memorize these five numbers)

- **~1°** — maximum deviation from the VOACAP median takeoff angle across
  250–6000 km (1.2° worst case, ~0.4° mean, exact match at 2500 km).
  Reproducible: the study script ships in the repo.
- **10 for 10** — every tested distance lands inside VOACAP's own
  day/season/solar prediction envelope.
- **42** — automated tests pinning every formula to published theory (ARRL,
  ITU-derived geometry, NOAA scales). The physics cannot silently drift.
- **0** — network calls required to operate. Zero accounts, zero telemetry.
- **9 antennas × 8 wire types** — from doctrine-standard dipoles and NVIS
  to delta loops, all with per-material cut corrections and build steps.

## Closing lines that work

- "ALE picks the frequency. Nothing picks the antenna. This does."
- "It's the Antenna Handbook with the math already done — for your exact
  path, your exact wire, before your coffee cools."
- "We validated it against the government's own standard and published the
  study in the repo. Run it yourself."
- "The question isn't whether Marines need this — it's whether we want the
  antenna knowledge of a Master Sergeant in every pack, or only in the
  packs that happen to stand next to one."
