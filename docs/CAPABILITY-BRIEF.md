# HF Field Antenna Calculator — Capability Brief

**Developer:** Cpl Angeles-Gonzalez, Ezekiel S., USMC
**Version:** 1.15.0 · **Live demo:** https://tzeke000.github.io/hfcal/
**Classification:** UNCLASSIFIED — no CUI, no PII, no network dependency

---

## The problem

Distributed operations doctrine assumes SATCOM-denied environments where HF
is the fallback long-haul communications path. Effective HF depends on
antenna geometry matched to the path: the difference between an antenna cut
and raised correctly for a 300 km NVIS shot versus a 1500 km single-hop is
the difference between comms and silence. That knowledge lives in
experienced radio operators and scattered manual tables — and it erodes.
Existing prediction tools (VOACAP and derivatives) assume a desktop, a
trained analyst, and connectivity. The Marine at the antenna has none of
those.

## The capability

A phone-based antenna construction calculator that turns two grid
coordinates and a frequency into a complete, buildable antenna solution:

- **Wire cut lengths** adjusted for conductor material and gauge — including
  field-expedient wire (galvanized steel, salvage iron, speaker wire), not
  just catalog copper.
- **Computed antenna geometry:** optimal apex/support height for the path's
  takeoff angle, with a feasibility check against leg geometry, and honest
  fallbacks when the ideal is unbuildable.
- **Path analysis:** great-circle distance/bearing from lat/lon, MGRS, or
  DMS; terrain-aware takeoff angles (obstacle clearance, ocean/desert
  paths); ionospheric hop structure; NVIS/ground-wave/skywave zone logic.
- **Nine antenna types** with step-by-step field construction instructions,
  written for issued equipment (DAGR button sequences, tactical radio
  references).
- **Photograph the DAGR** to fill in a grid — on-device OCR, no connection
  required.
- **True and magnetic bearing** — the app's great-circle bearing is true north;
  it also gives the corrected number to dial into a lensatic compass, from an
  on-device World Magnetic Model (declination runs 7–11° across CONUS and
  reverses sign coast to coast).
- **Built-in compass** — phone magnetometer with the target bearing marked on
  the dial and a turn-left/turn-right cue. Works with no calculation run, so it
  is usable as a standalone compass, and is labelled as an aid to a lensatic
  rather than a replacement.
- **Transmit power aware** — the LUF moves with the radio you actually have,
  selected the way the radio labels it (LOW / MED / HIGH / GLOBAL on an
  AN/PRC-160 manpack, VRC with the 150 W amplifier, or a typed wattage for the
  radio's USER level), and with hop count. Absorption physics
  corroborated against VOACAP. The MUF correctly does not move: more power
  never gets you above it. Warns outright when the LUF exceeds the MUF and no
  frequency will close the path at the selected power.
- **Aims at a frequency that actually holds** — the FOT is defined as the
  frequency good 9 days in 10, and the textbook shortcut for it (85% of the
  MUF) measurably delivers about 82%, so a plan built on it fails nearer one
  day in five. Measured twice against VOACAP's own day-by-day statistics —
  the second time on a grid fine enough to prove the answer had converged.
- **Frequency check** — given the path, time of day and month, estimates
  MUF / FOT / LUF offline and rules on whether the assigned frequency will
  close the link, with an alternate to request if it will not. The
  ionospheric model is season- and latitude-aware: it works out the local
  season at the path's reflection point from the World Magnetic Model carried
  on the device, so a July shot in Finland and a July shot in New Zealand get
  opposite corrections.
- **24-hour frequency forecast** — MUF/FOT/LUF in 4-hour Zulu blocks with a
  verdict per block, so comm windows can be planned a day ahead rather than
  checked one moment at a time. A 12-month selector lets the operator plan
  for a future month, not just today.
- **Saved shots and comm-card export** — keep the day's link plans on the
  device and export any of them as a plain-text comm card.

## Differentiators

- **Fully offline.** Installs as a PWA / Windows executable / Android APK;
  every calculation runs on-device. No account, no cloud, no telemetry, no
  server side and no third-party CDN — even the OCR engine and the webfonts
  are vendored, so nothing is fetched from anyone else's infrastructure.
  Exactly one optional network call exists in the whole app (NOAA SWPC
  space-weather advisories); it falls back to cached or default solar
  activity when unreachable, and no calculation depends on it.
- **Field-expedient first.** Models the wire you actually have, not the
  antenna you wish you had.
- **Teaches while it calculates.** Formulas are exposed, not hidden —
  usable as a schoolhouse training aid for the communications pipeline.
- **Validated twice.** Takeoff-angle and hop predictions compared against VOACAP
  (the government-standard HF prediction engine) across 10 path distances ×
  24 hours × 2 seasons × 2 solar conditions: agreement within 1.2° of the
  VOACAP median (mean ≈ 0.4°) across the entire 250–6000 km envelope,
  inside VOACAP's own environmental spread at every distance. Full
  methodology and reproduction scripts: `docs/VALIDATION.md`. The frequency
  model was validated the same way against VOACAP's MUF output over 288
  hourly samples: 12.4% mean error, 80% within 20%. A third study extended
  that worldwide — six sites from 60 N to 44 S across all twelve months —
  to fit the season and magnetic-latitude terms. Accuracy is now uniform to
  within 0.3 points across three very different regimes — 12.1% regional,
  12.3% across latitudes, 12.4% transequatorial — and effectively unbiased on
  paths crossing the equator. A fourth checked the
  ionospheric layer table against both closed-form geometry and VOACAP's own
  mode selection, correcting a hop limit that exceeded what its layer height
  can physically support. A fifth tested six real hemisphere-to-hemisphere
  circuits — opposite seasons at either end, crossing the geomagnetic equator.
  A ninth evaluates every ionospheric bounce on a multi-hop path rather than
  the midpoint alone, since the signal is capped by its weakest reflection —
  which on a long shot can be in the other hemisphere's winter. A sixth
  rebuilt the frequency model on solar zenith angle and Chapman layer theory
  and refitted it against all 4320 accumulated VOACAP samples at once:
  **13.3% mean MUF error, and now roughly uniform** (12.4% regional, 13.3%
  across latitudes, 13.4% transequatorial) rather than accurate only where it
  was originally tuned. The docs are equally candid about what is *not*
  validated — the LUF has never been checked against anything.
- **Engineered, not improvised:** automated physics test suite (163 tests
  pinning the formulas to published theory), versioned releases,
  self-updating deployment with stale-install notification.

## Maturity

| Area | Status |
|---|---|
| Core physics | Validated vs VOACAP; unit-tested against ARRL/ITU references |
| Platforms | Web/PWA (live), Windows .exe (CI-built), Android/iOS (Capacitor buildable) |
| Offline operation | Complete, including DAGR photo OCR and fonts — all engines and assets are vendored and service-worker precached (7.8 MB install). The only network call in the entire app is the optional NOAA space-weather advisory, which falls back to cached or default solar activity |
| Integration | JS API + URL parameters + postMessage for external tooling |
| Known limits | VOACAP-class monthly-median accuracy; live NOAA SWPC feed (SFI/Kp) is advisory, fetched only when online |

## Potential adoption paths

- **Training command evaluation** — Communication School curriculum aid for
  the radio-operator and communications-maintenance pipelines (zero-cost
  pilot; already deployable).
- **ATAK plugin** — port of the calculation engine into the tactical Android
  ecosystem units already field.
- **Unit-level fielding** as a free capability with sustainment support, or
  transition via SBIR/Tradewinds pathways.

## Point of contact

Cpl Angeles-Gonzalez, Ezekiel S., USMC — via https://github.com/Tzeke000/hfcal
