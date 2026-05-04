# HF Field Antenna Calculator

> ### Made by Cpl Angeles-Gonzalez, Ezekiel S. — USMC
> Original work · Project signature: `HFCALC-AG-EZK-USMC-v1`
> Released under [CC BY-NC-ND 4.0](LICENSE)

A USMC-themed offline HF antenna calculator. Plug in your grid + target grid + frequency, get back wire lengths, takeoff angle, propagation analysis, and step-by-step deployment guides for 8 antenna types.

**Works completely offline once installed.**

---

## 📥 Install

### 🌐 **→ https://tzeke000.github.io/hfcal/ ←**

One link, three platforms.

#### 📲 Phone (Android or iPhone)
- **Android (Chrome):** Open the link → tap menu → **"Install app"** or **"Add to Home Screen"**
- **iPhone (Safari only):** Open the link → tap **Share** ⬆️ → **"Add to Home Screen"**

#### 💻 Desktop (Windows, Mac, Linux)
Open the link in **Chrome** or **Edge**. You'll see a big **"INSTALL ON DESKTOP"** button at the top of the page. Click it.

The app installs as a **real desktop application** with:
- Its own icon in your Start menu / Dock / Applications
- Its own window (no browser tab or address bar)
- Works fully offline after first open
- Auto-updates in the background

You can also use the install icon that appears in Chrome/Edge's address bar.

#### Once installed — works offline
Open it once with internet on (caches everything). After that it works in the field with no signal, no cell service, nothing. Perfect for deployment.

---

### Alternative install paths

If you'd rather have a real `.apk` or `.ipa` file (more involved):

- 📲 **Android APK** — [latest build](https://github.com/Tzeke000/hfcal/actions/workflows/build-android.yml) → most recent green run → Artifacts → `hf-field-antenna-debug-apk`
- 🍎 **iPhone IPA** — [latest build](https://github.com/Tzeke000/hfcal/actions/workflows/build-ios.yml) → unsigned, requires [Sideloadly](https://sideloadly.io/) (re-sign every 7 days with free Apple ID)

📖 [Detailed install instructions for all paths](INSTALL.md)

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
- **Antenna selection** — recommends 1–3 antennas appropriate for the path: inverted-V, dipole, sloper, NVIS variants, EFHW, vertical, longwire
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

- Built with React 18 + Vite 5 + Capacitor 6 + vite-plugin-pwa
- Single `src/HFCalc.jsx` component, fully self-contained
- All 24 antenna deployment images embedded as base64 (no external requests)
- Production builds use Terser with aggressive minification + variable mangling
- AI integration layer exposes `window.HFCalc.*`, postMessage, and URL parameters

```bash
npm install
npm run dev      # local dev server at http://localhost:5173
npm run build    # production build to dist/
```

To build the Capacitor mobile apps, push to this repo — the GitHub Actions workflows in `.github/workflows/` build APK and unsigned IPA automatically.

---

## Disclaimer

Wire lengths, takeoff angles, and propagation analysis are estimates derived from published HF references (ITU, ARRL, USMC MCRP 3-40.3C, Rohde & Schwarz NVIS notes). Always trim antennas for SWR before transmitting. Use at your own risk. The author makes no warranty of any kind.
