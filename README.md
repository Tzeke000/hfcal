# HF Field Antenna Calculator

A USMC-themed offline HF antenna calculator. Plug in your grid + target grid + frequency, get back wire lengths, takeoff angle, propagation analysis, and step-by-step deployment guides for 8 antenna types.

**Works completely offline once installed.**

---

## 📥 Three ways to install

### 🌐 Best for most people — Web App (PWA)

Open this in your phone or computer browser:

### **→ https://tzeke000.github.io/hfcal/ ←**

- **On Android / Chrome / Edge / Desktop:** look for the install button in the address bar, or tap menu → "Install app" / "Add to Home Screen"
- **On iPhone (Safari only):** tap the Share button ⬆️ → "Add to Home Screen"

After installing it works **fully offline** — keep using it in the field with no signal. Updates download in the background when you're online.

✅ Free · ✅ Never expires · ✅ Works on any device · ✅ No app store

---

### 📲 Android APK (alternative)

If you'd rather install a real `.apk` file:

1. Go to the [latest Android build](https://github.com/Tzeke000/hfcal/actions/workflows/build-android.yml)
2. Click the most recent successful run
3. Scroll to the bottom → download `hf-field-antenna-debug-apk` from Artifacts
4. Unzip → transfer the APK to your phone → tap to install (allow "unknown sources" when asked)

📖 [Detailed Android instructions](INSTALL.md#android-apk)

---

### 🍎 iPhone IPA (only if you really want a native install)

⚠️ The free path requires re-signing every 7 days. **The PWA above is much easier on iPhone.** If you still want the IPA:

1. Go to the [latest iOS build](https://github.com/Tzeke000/hfcal/actions/workflows/build-ios.yml)
2. Download `hf-field-antenna-ios-unsigned-ipa`
3. Sign with [Sideloadly](https://sideloadly.io/) using your Apple ID

📖 [Detailed iPhone instructions](INSTALL.md#iphone-ipa)

---

## What it does

- **Coordinate input** — accepts MGRS grid (DAGR-style), DMS, or decimal degrees
- **Path analysis** — distance, bearing, terrain along the great-circle path (ocean / land / mountain / desert)
- **Propagation modeling** — F2-layer multi-hop, ionosphere takeoff angle adjusted for terrain, NVIS / single-hop / DX zone detection
- **Antenna selection** — recommends 1–3 antennas appropriate for the path: inverted-V, dipole, sloper, NVIS variants, EFHW, vertical, longwire
- **Field-deployable specs** — wire lengths in feet & meters, support heights, leg angles, build steps, deployment diagrams

## Verified against published HF benchmarks

Tested across 12 real-world paths (Norfolk → Lagos transatlantic, Karachi → Beijing through the Himalayas, etc.). Distances and bearings match haversine to <0.05 km / 0.05°. Takeoff angles align with published references (G4KNO, Skywave Radio Handbook, R&S NVIS notes).

## For developers

- Built with React 18 + Vite 5 + Capacitor 6
- Single `src/HFCalc.jsx` component, ~2,250 lines, fully self-contained
- All 24 antenna deployment images embedded as base64 (no external requests)
- Calculation logic preserved from the original Base44 implementation
- PWA via `vite-plugin-pwa` with Workbox precaching

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
```

To build the Capacitor mobile apps, push to this repo — the GitHub Actions workflows in `.github/workflows/` build APK and unsigned IPA automatically.

## License

Personal / educational use. Wire calculations are guidance only — always trim for SWR before transmitting.
