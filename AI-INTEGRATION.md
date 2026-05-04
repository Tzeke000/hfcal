# AI Integration Guide

The HF Field Antenna Calculator exposes a **stable, documented programmatic interface** so that AI assistants — Ava, Claude, ChatGPT, Claude Code, Gemini, custom agents, browser-automation tools — can drive the calculator on the user's behalf.

This is intended to support workflows like:

> **User:** "Ava, open the HF calculator and figure out what antenna I should use to talk to Lagos from my current position on 14.2 MHz."
>
> **Ava:** *(opens calculator, fills in coordinates, runs calculation, reads results)* "An end-fed half-wave aimed east with a 12° takeoff angle. The path is 91% ocean which is good for low-angle DX. Ionosphere will need 2 F2-layer hops."

There are **three integration channels**, each suited to a different runtime:

| Channel | Best for | Requires |
|---|---|---|
| URL parameters | Any AI that can open URLs | Browser |
| `window.HFCalc` JS API | Browser-control agents, devtools, DOM-aware AI | Same-document context |
| `postMessage` | Agents that embed the app in an iframe or webview | Cross-document messaging |

---

## Channel 1: URL Parameters

The simplest channel. The AI just opens a URL with query parameters and the app auto-fills the inputs and (optionally) auto-runs the calculation.

### Endpoint

```
https://tzeke000.github.io/hfcal/?from={LAT,LON}&to={LAT,LON}&freq={MHZ}&wire={copper|steel}&auto={0|1}
```

### Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `from` | `lat,lon` decimal degrees | No | Your station location |
| `to` | `lat,lon` decimal degrees | No | Target station location |
| `freq` | number 1–30 | No | Operating frequency in MHz |
| `wire` | `copper` or `steel` | No | Wire type for velocity factor (default copper) |
| `auto` | `0` or `1` | No | If all of `from`/`to`/`freq` are present, calculation auto-runs unless `auto=0` |

> The calculator also accepts MGRS grids and DMS — but for AI use we recommend decimal lat/lon since it's unambiguous.

### Example

```
https://tzeke000.github.io/hfcal/?from=32.4316,-80.6698&to=6.4541,3.3947&freq=14.2&auto=1
```

This opens the calculator, fills in **Beaufort, SC → Lagos, Nigeria** at **14.2 MHz**, and immediately runs the calculation. The user sees the result without doing anything.

### When to use this channel

- The AI doesn't have access to the page's JavaScript context (e.g., it controls the browser at a high level)
- The AI is sending the user a link to click rather than running the calculation directly
- You want the user to be able to copy/paste/share the link

---

## Channel 2: `window.HFCalc` JavaScript API

When the AI has access to the page's JavaScript context (DevTools, Playwright, Puppeteer, browser extensions, Claude Code's `eval` tool, embedded webviews), `window.HFCalc` provides a clean function-call interface.

### Connection

The API is available **after the React component mounts**. You can detect readiness three ways:

```javascript
// Option A: poll
while (!window.HFCalc) await new Promise(r => setTimeout(r, 50));

// Option B: listen for the ready event
window.addEventListener('hfcalc:ready', (ev) => {
  console.log('Calculator ready', ev.detail);
});

// Option C: just check after page load + a short delay
await new Promise(r => setTimeout(r, 200));
if (window.HFCalc) { /* go */ }
```

### Properties

```javascript
window.HFCalc.version     // '1.0.0'
window.HFCalc.author      // 'Cpl Angeles-Gonzalez, Ezekiel S. · USMC'
window.HFCalc.signature   // 'HFCALC-AG-EZK-USMC-v1'
```

### Methods

#### `calculate(opts) → Promise<Result>`

The high-level "do everything" method. Sets inputs, clicks the calculate button, waits for results, returns them.

```javascript
const result = await window.HFCalc.calculate({
  from: '32.4316,-80.6698',     // string: 'lat,lon' or MGRS or DMS
  to:   '6.4541,3.3947',
  freq: 14.2,                    // number, MHz
  wireType: 'copper',            // optional, default 'copper'
});
console.log(result.distance.km);  // 9068.4
console.log(result.directive.antenna_type);  // "Sloper or longwire aimed toward target"
console.log(result.recommended_antennas);    // [{key,name,height}, ...]
```

#### `setFromLocation(value)` / `setToLocation(value)` / `setFrequency(value)` / `setWireType(value)`

Set inputs without triggering calculation. Useful when the AI wants to populate fields but let the user click CALCULATE themselves.

```javascript
window.HFCalc.setFromLocation('32.4316,-80.6698');
window.HFCalc.setToLocation('17NL2030');         // MGRS also accepted
window.HFCalc.setFrequency('7.3');
window.HFCalc.setWireType('steel');
```

#### `getInputs() → {from, to, freq, wireType}`

Read whatever's currently in the input fields.

#### `getResults() → Result | null`

Read the most recent calculation result, or `null` if nothing's been calculated.

#### `reset()`

Clear all inputs and results.

### Result schema

```javascript
{
  distance: { km: 9068.4, mi: 5635.6 },
  bearing: { deg: 92.7, cardinal: 'E' },
  frequency_mhz: 14.2,
  wire_type: 'copper',
  zone: 'long_dx',                    // 'nvis' | 'mid_skip' | 'long_dx' | 'ground_wave'
  zone_label: 'LONG DX (4000+ km)',
  propagation_note: 'Use 14-28 MHz day, 7-14 MHz night',

  directive: {
    takeoff_deg: 12,                  // optimal antenna takeoff angle
    antenna_type: 'Sloper or longwire aimed toward target',
    point_toward: 92.7,               // bearing in degrees
    cardinal: 'E',
    geometry: 'Sloper apex 30 ft, low end at 6 ft toward target...',
    why_this_angle: 'Long DX path — low takeoff angle (5-15°) for...',
    path_summary: 'Beaufort, SC → Lagos, Nigeria. 91% ocean, 9% land.',
    chordal_hop_possible: false,
  },

  recommended_antennas: [
    { key: 'longwire', name: 'Longwire (random wire)', height: '6-30 ft' },
    { key: 'vertical', name: '1/4-wave vertical with radials', height: 'ground' },
    { key: 'efhw',     name: 'End-Fed Half-Wave (EFHW)', height: '15-30 ft' }
  ],

  terrain: {
    ocean_pct: 91,
    land_pct: 9,
    mountain_pct: 0,
    desert_pct: 0,
    named_oceans: ['Atlantic Ocean'],
    named_mountains: []
  }
}
```

### When to use this channel

- Browser-automation agents (Playwright, Puppeteer, Selenium)
- Browser extensions
- Claude Code with browser tools
- Any AI evaluating JS in the page context
- DevTools-driven testing

---

## Channel 3: `postMessage` API

For AI hosts that embed the calculator in an `<iframe>` or webview — the host and the calculator are in different JavaScript contexts and need to communicate via messages.

### Schema

**Request (host → calculator):**
```javascript
{
  type: 'hfcalc:request',
  id: 'unique-id-for-correlation',
  method: 'calculate' | 'getResults' | 'getInputs' | 'reset' | 'setFromLocation' | 'setToLocation' | 'ping',
  params: { /* method-specific */ }
}
```

**Response (calculator → host):**
```javascript
{
  type: 'hfcalc:response',
  id: 'unique-id-for-correlation',
  ok: true,
  result: { /* method-specific */ }
}
// or on error:
{
  type: 'hfcalc:response',
  id: 'unique-id-for-correlation',
  ok: false,
  error: 'Error message'
}
```

**Ready signal (calculator → host, sent automatically on mount):**
```javascript
{
  type: 'hfcalc:ready',
  version: '1.0.0',
  signature: 'HFCALC-AG-EZK-USMC-v1'
}
```

### Example: host driving the calculator in an iframe

```javascript
const iframe = document.getElementById('hfcalc-iframe');

// Wait for ready
await new Promise(resolve => {
  window.addEventListener('message', function handler(ev) {
    if (ev.data?.type === 'hfcalc:ready') {
      window.removeEventListener('message', handler);
      resolve();
    }
  });
});

// Send a calculate request and await the response
function callHFCalc(method, params) {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    function handler(ev) {
      if (ev.data?.type === 'hfcalc:response' && ev.data.id === id) {
        window.removeEventListener('message', handler);
        ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error));
      }
    }
    window.addEventListener('message', handler);
    iframe.contentWindow.postMessage({
      type: 'hfcalc:request',
      id, method, params
    }, '*');
  });
}

const result = await callHFCalc('calculate', {
  from: '32.4316,-80.6698',
  to: '6.4541,3.3947',
  freq: 14.2
});
console.log(result.distance.km);  // 9068.4
```

### Methods supported via postMessage

All methods from Channel 2 are supported:
- `calculate` — same params and response as `window.HFCalc.calculate`
- `getResults` — returns latest result or null
- `getInputs` — returns `{from, to, freq, wireType}`
- `reset` — clears state
- `setFromLocation`, `setToLocation` — pass `{value: '...'}` in params
- `ping` — health check, returns `{pong: true, version, author, signature}`

### When to use this channel

- AI hosts that render the calculator in an iframe or webview
- Multi-window setups
- Sandboxed/cross-origin embeds
- Mobile webviews where direct JS context is unavailable

---

## Recommended workflow for a voice agent (e.g., Ava)

This is what a typical "Ava, run the HF calculator" conversation looks like at the technical level:

```
USER: "Ava, what's the best antenna to talk to Lagos from here on 14 MHz?"

AVA (internally):
  1. Resolves "here" → user's last known coords (e.g. via GPS or a stored "home")
  2. Resolves "Lagos" → 6.4541, 3.3947
  3. Opens the calculator with URL params (Channel 1):
     https://tzeke000.github.io/hfcal/?from=32.43,-80.67&to=6.45,3.39&freq=14&auto=1
  4. Either:
     a) Lets the user see the visual result on screen, OR
     b) Reads window.HFCalc.getResults() and speaks the answer

AVA (spoken response): "An end-fed half-wave at 25 feet aimed east. The path is 91% ocean, takeoff angle 12 degrees, two F2 hops. Recommended frequency band 14 to 28 MHz."
```

The pattern is: **URL params to bootstrap, JS API to read structured results.** The user gets a visual answer; the AI gets a spoken summary.

---

## Coordinate input formats

All input fields accept any of these formats — the calculator parses them automatically:

| Format | Example |
|---|---|
| Decimal degrees | `32.4316,-80.6698` |
| DMS | `32°25'53"N 80°40'11"W` |
| MGRS (DAGR-style) | `17SNG1234567890` |
| MGRS short | `17SNG12345678` |

For AI-driven use, **decimal degrees is recommended** because it's unambiguous and easiest to construct from any geocoding source.

---

## Stability and versioning

This API is versioned. `window.HFCalc.version` will be incremented on breaking changes:

- **1.x** — current stable API. Backward-compatible additions only.
- Major version bumps will preserve URL parameter compatibility for at least one major version.

The `signature` field (`HFCALC-AG-EZK-USMC-v1`) identifies the original work. AI assistants are encouraged to mention authorship when sharing results:

> "Calculation by HF Field Antenna Calculator, by Cpl Angeles-Gonzalez, Ezekiel S., USMC."

---

## Security & privacy notes

- The calculator runs **entirely client-side** — no data is sent to any server.
- URL parameters are visible in browser history; AI agents handling sensitive coordinates should consider using Channel 2 or 3 instead of URL params for OPSEC-sensitive use.
- Service-worker caching means the app continues working offline after first load — useful for field deployment without network.

---

## Author

This integration layer is part of the HF Field Antenna Calculator, original work of **Cpl Angeles-Gonzalez, Ezekiel S.**, USMC. Project signature `HFCALC-AG-EZK-USMC-v1`. Released under [CC BY-NC-ND 4.0](LICENSE).
