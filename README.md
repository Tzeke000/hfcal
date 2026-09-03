# HF Field Antenna Calculator

> ### Made by Cpl Angeles-Gonzalez, Ezekiel S. — USMC
> Original work · Project signature: `HFCALC-AG-EZK-USMC-v1`
> Released under [CC BY-NC-ND 4.0](LICENSE)

**Built for the Marine standing at the wire with no signal, no laptop, and no time.**

When SATCOM is denied, HF is the fallback — and HF lives or dies on the antenna. A wire cut wrong or hung at the wrong height is the difference between comms and silence. This app puts that knowledge in your pocket and runs it entirely on the phone: enter your grid, the target grid, and your frequency, and it hands back the wire lengths, the support heights, the direction to point, and a straight answer to the question that actually matters — **will this frequency close this path right now, at the power I have?**

The tools the military already has are good — they are just not where the antenna is. This does not claim to beat them. It claims to match the standard where the standard has never been able to go: **offline, in your hand, at the point of construction.**

---

## 📥 Install

### 🌐 **Web App (one link, every platform)**

### → https://tzeke000.github.io/hfcal/ ←

Open the link in your browser and tap **INSTALL** at the top of the page. Works on:

- **Phone (Android or iPhone)** — installs as a real app icon on your home screen
- **Desktop (Windows / Mac / Linux Chrome / Edge)** — installs as a standalone app with its own window and Start menu / Dock icon

After installing it works **fully offline** — the ionospheric tables, antenna guides, and maps are all carried on the device. Connect once so the full-accuracy ionosphere table and the live space-weather reading can cache; after that it never needs a network again.

✅ Free · ✅ Never expires · ✅ Auto-updates · ✅ No app store

---

### 💻 **Windows .exe Installer (alternative for desktop)**

If you'd rather have a real `.exe` installer instead of a PWA install:

1. Go to [the latest release](https://github.com/Tzeke000/hfcal/releases/latest) — or, if no release is published yet, the [Windows build artifacts](https://github.com/Tzeke000/hfcal/actions/workflows/build-windows.yml)
2. Download the `HFCalc-Setup-*-x64.exe` installer
3. Double-click to install

⚠️ **Heads up:** the installer is **unsigned**. Windows will show *"Windows protected your PC"* the first time you run it. Click **"More info" → "Run anyway"**. (To avoid this we'd need a $200/year code-signing certificate.)

### 📲 Android APK (alternative)

1. Go to the [latest Android build](https://github.com/Tzeke000/hfcal/actions/workflows/build-android.yml)
2. Click the most recent successful run
3. Scroll to the bottom → download `hf-field-antenna-debug-apk` from Artifacts
4. Unzip → transfer the APK to your phone → tap to install (allow "unknown sources" when asked)

📖 [Detailed Android instructions](docs/INSTALL.md#android-apk)

### 🍎 iPhone IPA

The PWA install (above) is much easier on iPhone. The IPA route requires re-signing every 7 days with a free Apple ID. [Detailed iPhone instructions](docs/INSTALL.md#iphone-ipa).

---

## What it does

**Path and geometry**
- **Coordinate input** — MGRS grid straight off a DAGR (or scan the DAGR screen with the camera), DMS, or decimal degrees. Remembers your last known-good pair so it opens cold with something useful.
- **Path analysis** — distance, true and magnetic bearing (the number you dial into a lensatic), back azimuth, and the terrain under the whole great-circle path: ocean, land, mountain, desert, irrigated valley, and what that ground is worth to your signal. Land and sea come from a real 1° coastline mask; the American southwest is broken out to the desert subdivision so the Yuma/WTI training area reads as what it is.
- **Live compass** — uses the phone's magnetometer, corrected by the World Magnetic Model carried on the device, to walk you onto the antenna bearing.

**The frequency answer**
- **Frequency check** — MUF, FOT and LUF for this path at this hour, and a verdict on the frequency you were assigned, with an alternate to request if it will not propagate. Pick any of the 12 months (season at every bounce) and set the transmit power the way the radio is labelled — LOW / MED / HIGH / GLOBAL on an AN/PRC-160, VRC for the 150 W amp, or type your actual watts.
- **24-hour forecast** — MUF / FOT / LUF in 4-hour Zulu blocks with your local time alongside, so comm windows can be planned instead of discovered.
- **SOI mode** — enter your assigned frequencies once; for any path they're ranked: which closes now, which opens at what hour. The actual field question.
- **Next window** — when a path is closed, the app says when it opens ("~0430Z, in 3h") instead of making you read the table.
- **Every bounce checked** — a long shot reflects off the ionosphere several times, each at a different place, local time, and season; the weakest bounce caps the path and the app shows you which one it is.
- **PATH CLOSED warning** — when absorption eats everything the ionosphere would reflect, it says so outright. Checked against VOACAP over 6,912 cases: it has never once fired on a path VOACAP could close.
- **Live space weather** — NOAA solar flux and Kp when a connection exists, cached with its age shown; a stated mid-cycle default when it doesn't. Everything works either way.
- **Auroral absorption** — during a geomagnetic storm the app works out where the auroral oval has reached from the live Kp, checks it against every point your path crosses the absorbing layer, and raises the floor accordingly. A high-latitude circuit that is fine on a quiet day gets told it is closing, and told why.

**The antenna**
- **Terrain masking → NVIS** — if a ridge sits between you and the far station, the mode is chosen by the rock, not the distance. A ground wave doesn't get weaker against 900 m of mountain, it stops, and the far station sits in dead space; the app switches to NVIS, says which ridge and how far, and tells you to keep the wire low.
- **Antenna selection** — recommends from 9 field-expedient types for the path: inverted-V, dipole, sloper, NVIS variants, EFHW, vertical, longwire, delta loop — each with pros/cons, deployment photos, and step-by-step build instructions.
- **Wire physics** — 8 wire core types (bare/stranded/insulated copper, CCS, galvanized steel, stainless, iron, speaker wire) × AWG 10–24 plus custom. Velocity factor computed per combination, so the cut lengths match the wire actually in your hands.
- **Optimal apex height** — computes the support height that puts the antenna's first lobe on your path's takeoff angle, checks it against what an inverted-V's legs can physically reach, and tells you when to just use the buildable maximum.

**Field workflow**
- **QR handoff** — show any plan as a QR code; another operator scans it phone-to-phone and their app opens pre-filled. No network, no typing grids.
- **Field truth log** — one tap after a shot (closed / didn't) records the app's prediction beside reality, plus the space weather it was predicted under, the antenna you built, where you pointed it, the takeoff angle and the wire. If it didn't close, it asks **why** — one tap on a cause, because a failure with no cause attached cannot tell a wrong prediction from a wrong antenna. Logged offline, held on the device, and offered again when signal returns. The app then offers to send the card back so the model can be corrected against real paths: your grids are rounded to whole degrees by default (the resolution the model works at anyway), nothing is transmitted by the app itself — tapping send opens your own share sheet with the text in it — and DON'T ASK is remembered. **POST TO LOG** instead files the same card as a public report on this repo, where every operator can see what has and hasn't closed — those reports are tallied on the author's dashboard.
- **Red-light night mode** — a red-on-black theme that preserves dark adaptation.
- **Saved shots & comm cards** — save any plan, export it as a plain-text comm card (DTG, grids, distance, bearings, wire cut, frequency window, the power and month behind the numbers) to hand to another operator.
- **DAGR help** — the button sequence to pull coordinates off an AN/PSN-13, or skip it and scan the screen.

**Privacy** — your coordinates never leave the device. The app stores your last position locally so it is there when you open it cold; an embedded host must be explicitly authorized (`?embed=1` **and** an on-screen operator approval) before it can read even that, and CLEAR SAVED DATA wipes it. The app's complete network footprint, stated in full: the NOAA space-weather fetch, the update check against its own site, and a **one-time anonymous install ping** on first launch — a bare fetch of a file from this repo with nothing attached, so the author can count installs. None of the three carry coordinates or any identifier, and all fail silently offline.

---

## How close is it?

Measured against **VOACAP** — the U.S. government's own HF prediction engine, the standard since the 1980s — at sites the app's tables were never built from:

| Quantity | Accuracy |
|---|---|
| Takeoff angle | within ~1° of the VOACAP median, 250–6,000 km |
| Critical frequency (foF2) | ~1% (own-built lookup table from 30,240 VOACAP runs) |
| Path geometry (M-factor) | ~4.8% (own-built table from 12,960 more) |
| MUF, mid-latitude | ~4% mean · 2.4% median |
| MUF, pooled across every path type | ~5% mean · within 11% nine times out of ten |
| Arctic / transpolar paths | ~5.5% |
| Transequatorial paths | ~6% (the weakest region, stated in-app) |

The LUF's absorption law, daylight response and path-length dependence are measured against VOACAP's own loss curves; its absolute level rests on a stated anchor rather than a measurement, and the app says so. Where the model is weak, the app tells the operator on screen rather than hiding it.

**The whole study is reproducible.** [`docs/VALIDATION.md`](docs/VALIDATION.md) is the complete record — 44 parts, including the mistakes, the corrections, and the scripts to re-run every measurement. Don't take my word for it — run it yourself.

**309 unit tests** pin the physics so it cannot drift. **50 browser tests** build the app and drive it in Chromium by clicking — every bug ever reported from real use was in the screen, not the math, so the screen is tested too; that suite was proven by re-introducing those bugs and watching it catch them. A hooks lint makes React stale-closure bugs a build failure. All of it runs in CI on every push, and nothing deploys ahead of its tests.

---

## 🤖 AI Integration

The calculator can be **driven by AI assistants** — your own AI projects, Claude, ChatGPT, Claude Code, or any browser-automation agent.

Tell your AI: *"Open the HF calculator and figure out what antenna to use for talking to Lagos from my position on 14.2 MHz."* It opens:

```
https://tzeke000.github.io/hfcal/?from=32.43,-80.67&to=6.45,3.39&freq=14.2&auto=1
```

The calculator auto-fills, runs, and the AI reads back the full result — including the MUF/FOT/LUF verdict, and it can set the month and transmit power to plan ahead.

Three channels: **URL parameters** (any AI that can open a link), **`window.HFCalc.*`** (browser-control agents), and **`postMessage`** (embedding hosts — off by default, requires `?embed=1`, because the reply can carry the operator's coordinates).

📖 **[Full AI integration guide → docs/AI-INTEGRATION.md](docs/AI-INTEGRATION.md)** — written so any AI can read it and learn to drive the calculator. Point your AI at it.

---

## ⚖️ Authorship and License

This application is the original work of **Cpl Angeles-Gonzalez, Ezekiel S.**, United States Marine Corps. All calculation logic, terrain modeling, antenna selection rules, deployment guidance, AI integration layer, and visual design are the author's own.

**Project signature:** `HFCALC-AG-EZK-USMC-v1`

**License:** Released under [Creative Commons BY-NC-ND 4.0](LICENSE).

You **may**:
- ✅ Share, copy, and redistribute this app to fellow military members and ham radio operators
- ✅ Install and use it for personal, educational, and military operational purposes
- ✅ Have your AI assistant drive the calculator on your behalf
- ✅ Link to it from your own materials with proper attribution

You **may not**:
- ❌ Sell this app or use it for commercial purposes
- ❌ Modify it and redistribute the modified version
- ❌ Remove or alter authorship and attribution notices
- ❌ Claim this work as your own

For commercial licensing, derivative works, or other inquiries, [open an issue](https://github.com/Tzeke000/hfcal/issues).

**Independently created.** This work was developed entirely off duty, on the
author's own equipment and networks, from publicly published sources, and was
never directed by the author's chain of command. See
[`docs/legal/PROVENANCE.md`](docs/legal/PROVENANCE.md) for the full statement
and the evidence supporting it.

---

## For developers

- React 18 + Vite 5 + Capacitor 6 (Android/iOS) + Tauri 1.6 (Windows) + vite-plugin-pwa
- **Layout** — `src/physics` (the model, VOACAP-validated), `src/data` (generated tables, never hand-edited), `src/lib` (coordinates, comm cards, space weather), `src/ui` (React), `tests/unit` + `tests/ui`, `scripts/validation/build` (generates the tables) and `scripts/validation/studies` (measures against VOACAP). Each folder has a README.
- Physical constants live in exactly one place (`src/physics/propagation.js`); the validation studies run through a Python mirror that CI checks against the JavaScript to 1e-9 on every push
- Everything ships as local assets — no CDNs, no analytics service. The full network footprint is the three fail-silent fetches listed under Privacy above (space weather, update check, one-time install ping)

```bash
npm install
npm run dev          # local dev server at http://localhost:5173
npm run build        # production web build to dist/
npm run lint         # hooks-only lint: dependency-array bugs are build failures
npm test             # 309 unit tests over the physics, terrain and coordinate math
npm run test:ui      # 50 browser tests: builds dist/, drives it in Chromium (run twice in CI: at / and at /hfcal/)
npm run tauri:build  # build Windows .exe (requires Rust toolchain)
```

Pushing to this repo builds everything automatically — `.apk`, `.ipa`, `.exe`, and the GitHub Pages deploy — and none of it ships unless the full test suite passes first.

---

## Disclaimer

Wire lengths, takeoff angles, and propagation figures are estimates derived from published HF references (ITU, ARRL, USMC MCRP 3-40.3C, Rohde & Schwarz NVIS notes) and measured against VOACAP as documented above. Propagation numbers are statistical monthly-median estimates, not a forecast for one specific hour. **Always trim antennas for SWR and confirm with the radio before you rely on anything here. Your SOI/JCEOI assignment governs.** Not a substitute for issued communications planning tools or procedures. Use at your own risk. The author makes no warranty of any kind.
