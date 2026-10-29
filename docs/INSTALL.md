# How to Install HF Field Antenna

Pick whichever fits your situation. **PWA is recommended for almost everyone** — easiest install, no expiration, works on any device.

---

## 🌐 PWA (Web App) — recommended

Works on Android, iPhone, Windows, Mac, and Linux. One link, three taps.

**Step 1.** Open this in your browser:

### **https://tzeke000.github.io/hfcal/**

(If you get a 404, the GitHub Pages deploy hasn't finished yet — wait ~5 minutes after pushing and try again. You'll also need to enable Pages once in repo settings; see the "First-time GitHub Pages setup" section at the bottom of this file.)

### Android (Chrome or Edge)

1. Open the link above
2. You should see a popup at the bottom: *"Install HF Antenna"* — tap **Install**
3. If no popup appears: tap the three-dot menu in the top right → **Install app** (or **Add to Home Screen**)
4. The app appears on your home screen with the USMC icon
5. Open it once while you have internet — that caches everything
6. From now on it works fully offline

### iPhone (Safari only — important)

PWAs only install through Safari on iOS. Chrome / Firefox on iPhone won't work.

1. Open the link above in **Safari**
2. Tap the **Share** button at the bottom (the square with the up arrow)
3. Scroll down in the share sheet → tap **Add to Home Screen**
4. Tap **Add** in the top right
5. Open it once while online to cache → after that, fully offline

### Windows / Mac / Linux (Chrome or Edge)

1. Open the link
2. Look for an **install icon** in the address bar (looks like a small monitor with a down arrow)
3. Click **Install** in the popup
4. The app opens in its own window like a native app, lives in your Start menu / Dock

### How to tell it's installed correctly

- The app opens **fullscreen** (no browser address bar)
- It has its own icon on your home screen / Start menu
- It works with WiFi/data turned off

### Updating

Updates download automatically in the background whenever you're online and open the app. No action needed.

### Uninstalling

- **Android:** long-press the icon → **Uninstall** (same as any app)
- **iPhone:** long-press the icon → **Remove App**
- **Windows:** Settings → Apps → find "HF Antenna" → Uninstall
- **Mac:** drag from Applications to Trash

---

## 📲 Android APK

If you'd prefer a real `.apk` file install. **Note:** This is a debug-signed APK — Android may show extra warnings that wouldn't appear with a Play Store install.

### Get the APK

1. Go to: https://github.com/Tzeke000/hfcal/actions/workflows/build-android.yml
2. Click the most recent run with a green ✓ checkmark
3. Scroll to the bottom of the page
4. Under **Artifacts** → click `hf-field-antenna-debug-apk` to download the zip
5. Unzip → you have `app-debug.apk`

### Get it onto your phone

Pick whichever is easiest:

- **Email it to yourself** → open email on phone → tap attachment → save to Downloads
- **Google Drive** → upload from PC → open Drive on phone → tap file → Download
- **USB cable** → plug phone into PC → drag the APK to phone's Downloads folder

### Install it

1. Open your phone's **Files** app
2. Go to **Downloads** → tap **`app-debug.apk`**
3. Android warns: *"For your security…"* → tap **Settings**
4. Toggle on **Allow from this source** → tap back arrow
5. Tap **Install**
6. Tap **Open**, or find the app on your home screen

### Updating later

When a newer version is out, the app shows **UPDATE AVAILABLE → GET THE NEW APK** (it checks the website whenever it has signal). Download the new APK the same way as above.

- **If the run also has `hf-field-antenna-apk`** (the signed build — see *Android signing key* below), download that one. It installs straight over the old app and **keeps your saved shots and truth log**.
- **If there is only `hf-field-antenna-debug-apk`**, every build is signed with a different throwaway key and Android refuses to install it over the old one (*"App not installed"*). You have to uninstall the old app first — and **uninstalling deletes saved shots and the truth log**. Export the shots you need (Saved Shots → EXPORT) before you uninstall.

To check which version is installed: Settings → Apps → HF Field Antenna (the version number matches the app's footer from v1.63 on).

---

## 🍎 iPhone IPA

⚠️ **Almost everyone should use the PWA path instead.** The IPA route has Apple-imposed limitations that make it painful:

- **Free Apple ID:** app stops working every 7 days, must be re-signed
- **Paid Apple Developer ($99/yr):** lasts 1 year per signing
- **No way around this** — it's Apple's policy, not a bug in our setup

If you still want to proceed:

### Method 1: Sideloadly (free, weekly re-signing)

**You need:** a Windows or Mac computer, your iPhone, a USB cable, your Apple ID password.

1. **Get the IPA:** https://github.com/Tzeke000/hfcal/actions/workflows/build-ios.yml → most recent green run → download `hf-field-antenna-ios-unsigned-ipa` artifact → unzip
2. **Install Sideloadly:** https://sideloadly.io/
3. **(Windows only)** Install iTunes from https://www.apple.com/itunes/download/ — Sideloadly needs Apple's USB drivers that come with it
4. **Plug iPhone into computer** with USB. Tap **Trust** if asked.
5. **Open Sideloadly** → drag the `.ipa` into the window
6. Enter your Apple ID email → click **Start** → enter Apple ID password
7. (If you have 2FA on your Apple ID, generate an app-specific password at https://appleid.apple.com/ and paste that instead of your normal password)
8. Wait 1–3 minutes
9. **On the iPhone:** Settings → General → VPN & Device Management → tap your Apple ID → **Trust**
10. Open the app from your home screen

After 7 days the app will refuse to launch. Plug back in, run Sideloadly again to re-sign.

### Method 2: AltStore (free, auto-renews)

Like Sideloadly but it runs a tiny server on your computer that re-signs the app automatically every 7 days **as long as your phone and PC are on the same WiFi**. Setup is more involved.

Guide: https://altstore.io/

### Method 3: Apple Developer account

$99/year, no expiration nonsense, proper signing. Only worth it if you're shipping multiple apps.

---

## 💻 Computer

**Recommended:** Just use the PWA link — it works in any browser, can install to your desktop, and runs offline once cached.

### **https://tzeke000.github.io/hfcal/**

If you want to run the source code locally instead (useful for making changes):

```bash
git clone https://github.com/Tzeke000/hfcal.git
cd hfcal
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173) in your browser.

---

## 🆘 Troubleshooting

### PWA: link gives 404 / page not found

GitHub Pages takes a few minutes after you enable it. Make sure:

1. The "Deploy PWA to GitHub Pages" workflow shows a green checkmark in the [Actions tab](https://github.com/Tzeke000/hfcal/actions)
2. GitHub Pages is enabled for the repo (see "First-time GitHub Pages setup" below)
3. You're using `https://tzeke000.github.io/hfcal/` exactly — case matters, missing trailing slash sometimes matters

### PWA: install button doesn't appear

- **Chrome on Android:** must be visited at least once. Try the three-dot menu → "Install app". If still missing, try clearing cookies for the site and revisiting.
- **Safari on iPhone:** PWA install only works in Safari, not Chrome/Firefox/Edge for iOS. Use the Share button → "Add to Home Screen".
- **Some browsers don't support PWA install at all** (Firefox on iPhone, Brave on some devices). Use Chrome or Safari.

### PWA: app appears blank or stuck loading

The bundle is 1.7 MB — first load needs internet and may take 5-10 seconds on slow networks. If it stays blank, try:
- Pull down to refresh
- Uninstall and reinstall (long-press → uninstall, then revisit and reinstall)

### Android APK: "App not installed"

The installed app was signed with a different key (every debug build has its own). Export any saved shots you need, uninstall the old app, then install. Once the repo has a signing key, use `hf-field-antenna-apk` and this stops happening — see *Android signing key*.

### Android APK: phone says the file is harmful

Some manufacturers (especially Samsung) block APK installs from Chrome by default. Open the APK using your phone's **Files** app instead, or use Google Drive.

### iPhone: app crashes immediately on launch

Settings → General → VPN & Device Management → tap your Apple ID profile → **Trust**. (See step 9 of the Sideloadly steps.)

### iPhone: Sideloadly says "could not find device"

- Confirm iTunes is installed (Windows) — must be the version from apple.com, not Microsoft Store
- Use a real USB data cable, not a charging-only cable
- On iPhone: Settings → Privacy & Security → scroll down → trust the computer
- Try a different USB port (USB 2.0 sometimes works when USB 3.0 doesn't)

### iPhone: app stopped working after a week

That's the free Apple ID expiration. Re-run Sideloadly. Or switch to the PWA (no expiration). Or upgrade to AltStore for auto-renewal.

---

## 🔑 Android signing key (repo owner only, one time)

Without this, every Android build is signed with a new throwaway key, so an update can only be installed after uninstalling the old app (which deletes its saved data). With it, every build is signed with the **same** key and updates install over the top.

1. On any computer with Java installed, make the key (keep the passwords — you will need them in step 3):
   ```
   keytool -genkeypair -v -keystore hfcal-release.keystore -alias hfcal -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Turn it into text: `base64 -w0 hfcal-release.keystore > keystore.txt` (Mac: `base64 -i hfcal-release.keystore -o keystore.txt`).
3. GitHub → this repo → **Settings → Secrets and variables → Actions → New repository secret**, four times:
   - `ANDROID_KEYSTORE_B64` — the contents of `keystore.txt`
   - `ANDROID_KEYSTORE_PASSWORD` — the keystore password
   - `ANDROID_KEY_ALIAS` — `hfcal`
   - `ANDROID_KEY_PASSWORD` — the key password (same as the keystore password unless you chose another)
4. Push anything (or re-run *Build Android APK*). The run now also produces **`hf-field-antenna-apk`** — the one to hand out.

**Back up `hfcal-release.keystore` and its passwords somewhere safe and private.** If it is lost, the next key is a different key, and every phone has to uninstall once more. Never commit it to the repo: anyone holding it can make an "update" a phone will accept.

The first switch to the signed build still needs one uninstall (the old app was signed with a throwaway key). After that, never again.

---

## ⚙️ First-time GitHub Pages setup (repo owner only)

This needs to be done **once** to enable the PWA URL. Skip if you already see content at https://tzeke000.github.io/hfcal/.

1. Go to your repo: https://github.com/Tzeke000/hfcal
2. Click **Settings** (top of repo, far right)
3. Click **Pages** in the left sidebar
4. Under **Build and deployment** → **Source** → select **GitHub Actions**
5. That's it. The next push triggers a deploy. After a few minutes the site is live.

You can confirm the deploy succeeded under the **Actions** tab — look for "Deploy PWA to GitHub Pages" with a green ✓.

---

## ✅ Quick comparison

| | PWA | Android APK | iPhone IPA |
|---|---|---|---|
| Install effort | Open link → tap install | Download → enable unknown sources → install | Sign with Sideloadly → trust profile |
| Setup time | 30 seconds | 5 minutes | 15+ minutes |
| Cost | Free | Free | Free (or $99/yr to skip expiration) |
| Works offline | ✅ After first load | ✅ Immediately | ✅ Immediately |
| Expires? | ❌ Never | ❌ Never | ⚠️ Every 7 days (free) |
| Updates | Auto | Manual reinstall | Re-sign with Sideloadly |
| Real native? | Browser-based but feels native | Yes | Yes |
| Recommended? | ⭐ Yes for most cases | If you prefer a real APK | Last resort |
