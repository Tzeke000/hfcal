# Source layout

Shipped code only — tests live in `tests/`.

| | |
|---|---|
| `physics/` | The propagation model: takeoff angles and hop geometry (`propagation.js`), MUF/FOT/LUF (`freqAdvisor.js`), wire and apex maths (`antennaMath.js`), the world magnetic model (`magnetic.js`), terrain and path sampling (`terrain.js`). Pure functions, no React, all measured against VOACAP — see `docs/VALIDATION.md`. |
| `data/` | **Generated. Do not hand-edit.** The foF2 lookup table reader, the foF2 coefficient map and the M-factor table, all written by `scripts/validation/build/`. Guarded by `tests/unit/generatedData.test.js`. |
| `lib/` | Everything else with no UI in it: coordinate parsing (`coords.js`), comm-card formatting (`commCard.js`), NOAA space weather (`spacewx.js`). |
| `ui/` | React. `HFCalc.jsx` is still the large one; `CompassCard.jsx` and `SavedShots.jsx` were lifted out of it because every bug ever reported from real use was in those two. `theme.js` holds the palette every component reads. |

Physical constants live in exactly one place: `physics/propagation.js` owns
`EARTH_RADIUS_KM` and `F2_HEIGHT_KM`, and the other modules import them. This
project's recurring failure mode is the same quantity computed in two places —
see `docs/VALIDATION.md` Parts 10, 25 and 26.
