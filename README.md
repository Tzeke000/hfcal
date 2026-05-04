# HF Field Antenna Calculator

> ### Made by Cpl Angeles-Gonzalez, Ezekiel S. — USMC
> Original work · Project signature: `HFCALC-AG-EZK-USMC-v1`
> Released under [CC BY-NC-ND 4.0](LICENSE)

A USMC-themed offline HF antenna calculator. Plug in your grid + target grid + frequency, get back wire lengths, takeoff angle, propagation analysis, and step-by-step deployment guides for 9 antenna types.

**Works completely offline once installed.**

---

## 📥 Install

### 🌐 **Web App (one link, every platform)**

### → https://tzeke000.github.io/hfcal/ ←

Open the link in your browser and tap **INSTALL** at the top of the page. Works on:

- **Phone (Android or iPhone)** — installs as a real app icon on your home screen
- **Desktop (Windows / Mac / Linux Chrome / Edge)** — installs as a standalone app with its own window and Start menu / Dock icon

After installing it works **fully offline** — perfect for the field with no signal.

✅ Free · ✅ Never expires · ✅ Auto-updates · ✅ No app store

---

### 💻 **Windows .exe Installer (alternative for desktop)**

If you'd rather have a real `.exe` installer instead of a PWA install:

1. Go to [the latest release](https://github.com/Tzeke000/hfcal/releases/latest) — or, if no release is published yet, the [Windows build artifacts](https://github.com/Tzeke000/hfcal/actions/workflows/build-windows.yml)
2. Download `HFCalc-Setup-1.0.0-x64.exe` (or similar filename)
3. Double-click to install

⚠️ **Heads up:** the installer is **unsigned**. Windows will show *"Windows protected your PC"* the first time you run it. Click **"More info" → "Run anyway"**. (To avoid this we'd need a $200/year code-signing certificate.)

The `.exe` installs HF Field Antenna as a standalone Windows program. Same calculator, same offline support, same AI integration — just a more traditional Windows install experience.

---

### 📲 Android APK (alternative)

If you'd rather install a real `.apk` file:

1. Go to the [latest Android build](https://github.com/Tzeke000/hfcal/actions/workflows/build-android.yml)
2. Click the most recent successful run
3. Scroll to the bottom → download `hf-field-antenna-debug-apk` from Artifacts
4. Unzip → transfer the APK to your phone → tap to install (allow "unknown sources" when asked)

📖 [Detailed Android instructions](INSTALL.md#android-apk)

### 🍎 iPhone IPA

The PWA install (above) is much easier on iPhone. The IPA route requires re-signing every 7 days with a free Apple ID. [Detailed iPhone instructions](INSTALL.md#iphone-ipa).

---

## 🤖 AI Integration

The calculator can be **driven by AI assistants** — your own AI projects (like Ava), Claude, ChatGPT, Claude Code, or any browser-automation agent.

### Quick example

Tell your AI: *"Open the HF calculator and figure out what antenna to use for talking to Lagos from my position on 14.2 MHz."*

The AI opens this URL:
```
https://tzeke000.github.io/hfcal/?from=32.43,-80.67&to=6.45,3.39&freq=14.2&auto=1
```

The calculator auto-fills, runs, and the AI reads back the result.

### Three integration channels

- **URL parameters** — for any AI that can open a link
- **`window.HFCalc.*` JS API** — for browser-control agents and devtools
- **`postMessage`** — for AI hosts that embed the app in an iframe

📖 **[Full AI integration guide → AI-INTEGRATION.md](AI-INTEGRATION.md)**

This guide is written so any AI can read it and learn how to drive the calculator. Point your AI at it.

---

## What it does

- **Coordinate input** — accepts MGRS grid (DAGR-style), DMS, or decimal degrees
- **Path analysis** — distance, bearing, terrain along the great-circle path (ocean / land / mountain / desert)
- **Propagation modeling** — F2-layer multi-hop, ionosphere takeoff angle adjusted for terrain, NVIS / single-hop / DX zone detection
- **Antenna selection** — recommends antennas appropriate for the path: inverted-V, dipole, sloper, NVIS variants, EFHW, vertical, longwire, **delta loop (full-wave)**
- **Wire physics** — 8 wire core types (bare/stranded/insulated copper, CCS, galv steel, stainless, plain iron, speaker wire) × 8 AWG gauges (10–24 AWG) plus custom AWG input. Effective velocity factor computed per-combination.
- **Field-deployable specs** — wire lengths in feet & meters, support heights, leg angles, build steps, deployment diagrams

## Verified against published HF benchmarks

Tested across 12 real-world paths (Norfolk → Lagos transatlantic, Karachi → Beijing through the Himalayas, etc.). Distances and bearings match haversine to <0.05 km / 0.05°. Takeoff angles align with published references (G4KNO, Skywave Radio Handbook, R&S NVIS notes).

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

---

## For developers

- Built with React 18 + Vite 5 + Capacitor 6 (Android/iOS) + Tauri 1.6 (Windows desktop) + vite-plugin-pwa
- Single `src/HFCalc.jsx` component, fully self-contained
- All 24 antenna deployment images embedded as base64 (no external requests)
- Production builds use Terser with aggressive minification + variable mangling
- AI integration layer exposes `window.HFCalc.*`, postMessage, and URL parameters

```bash
npm install
npm run dev          # local dev server at http://localhost:5173
npm run build        # production web build to dist/
npm run tauri:build  # build Windows .exe (requires Rust toolchain)
```

To build the mobile apps and Windows .exe automatically, push to this repo — the GitHub Actions workflows in `.github/workflows/` build:
- `.apk` (Android, debug-signed)
- `.ipa` (iOS, unsigned — needs Sideloadly to install)
- `.exe` (Windows, NSIS installer, unsigned)

---

## Disclaimer

Wire lengths, takeoff angles, and propagation analysis are estimates derived from published HF references (ITU, ARRL, USMC MCRP 3-40.3C, Rohde & Schwarz NVIS notes). Always trim antennas for SWR before transmitting. Use at your own risk. The author makes no warranty of any kind.
