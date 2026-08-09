# Validation

Everything that measures this app against VOACAP.

| | |
|---|---|
| `appmodel.py` | **The Python mirror of the shipped JavaScript.** Every study computes the app's answer through this, so a study can never accidentally test something the app does not do. `python3 appmodel.py --check` compares it against `src/physics/freqAdvisor.js` over 455 cases and must report zero difference. |
| `build/` | Generates the data files the app ships: the foF2 grid and lookup table, the coefficient map, the M-factor table. Slow, run rarely, output committed. |
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
