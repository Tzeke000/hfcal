# Validation

Everything that measures this app against VOACAP.

| | |
|---|---|
| `appmodel.py` | **The Python mirror of the shipped JavaScript.** Every study computes the app's answer through this, so a study can never accidentally test something the app does not do. `python3 appmodel.py --check` compares it against `src/physics/freqAdvisor.js` over 455 cases and must report zero difference. |
| `build/` | Generates the data files the app ships: the foF2 grid and lookup table, the coefficient map, the M-factor table, and the 1° land/sea bitmask (build_land_mask.py, from Natural Earth coastlines). Slow, run rarely, output committed. |
| `studies/` | Measures the app against VOACAP and writes results to `docs/validation/`. Safe to re-run any time. Each one is documented as a numbered Part in `docs/VALIDATION.md`. |

## Running a study

```bash
python3 scripts/validation/studies/run_muf_study.py
```

Needs `voacapl` on PATH and an `~/itshfbc` data directory.

## A rule this earned the hard way

`appmodel.py` **refuses to run** when it cannot find a data file the app ships,
rather than falling back to a rougher model. The app itself is right to fall
back — that is what makes it work offline. A mirror that falls back silently is
not: it makes a study report the fallback's accuracy while claiming to have
measured what ships.

The v1.32 reorganisation proved the point. Moving `mfactorTable.js` into
`src/data/` left one path stale, and `run_muf_study.py` went on to report 5.4%
mean error against a known 4.4% without a word of complaint. It was caught only
because somebody remembered the old number. Now it stops.

## Where terrain data comes from (and where it does NOT)

**VOACAP holds no elevation data.** It is an ionospheric propagation engine:
it takes ground conductivity as an *input* for antenna modelling and knows
nothing about ridgelines. It can validate the propagation answer for a path
out of a given site — that is what the studies here do — but it cannot tell
you what a station has to shoot over. Terrain has to come from a real
elevation dataset.

The terrain database in `src/physics/terrain.js` is still hand-entered
bounding boxes with cited elevations. Replacing it with real data, the way
`build_land_mask.py` replaced the hand-drawn ocean boxes with a coastline
(VALIDATION Part 35), is the outstanding next step. Sources, best first:

| source | what it gives | how to get it |
|---|---|---|
| **USGS 3DEP / The National Map** | 1/3 arc-second (~10 m) DEM, authoritative for the US — the right source for Yuma, BMGR and 29 Palms | [apps.nationalmap.gov/downloader](https://apps.nationalmap.gov/downloader/) — draw a box, pick "Elevation Products (3DEP)", download GeoTIFF |
| **OpenTopography** | SRTM 30 m and Copernicus 30 m, global, plus a REST API that takes a bounding box | [opentopography.org](https://opentopography.org/) |
| **USGS EPQS** | elevation at a single lat/lon as JSON — good for spot-checking a handful of points with no GIS tooling | `https://epqs.nationalmap.gov/v1/json?x=LON&y=LAT&units=Meters` |
| **FCC M3 map** | *effective ground conductivity* for the US — the actual standard behind the conductivity classes used here | [fcc.gov/media/radio/m3-map-of-effective-ground-conductivity](https://www.fcc.gov/media/radio/m3-map-of-effective-ground-conductivity) |
| **ITU-R P.832** | world atlas of ground conductivity, for everywhere outside the US | ITU-R recommendation P.832 |

**What to hand over.** A GeoTIFF or ESRI ASCII grid (`.asc`) covering the
region of interest is enough; drop it anywhere in the repo and the builder can
be written against it. For a quick, no-tooling improvement, a list of
`name, lat, lon, peak_elevation_m` for the ranges that matter is also usable —
that is the form the current boxes are in, and it is what the Gila, Kofa and
Chocolate Mountains entries were built from.

**Resolution honesty.** The model samples the near field at 4 km and the rest
of the path at path-length/32. Feeding it a 10 m DEM does not make it a
10 m model; it makes the boxes it does have correct. Anything finer than a
few km is beyond what the propagation model can use, and the operator's eyes
and a map will always beat it locally.
