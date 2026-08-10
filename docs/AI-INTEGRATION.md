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
https://tzeke000.github.io/hfcal/?from={LAT,LON}&to={LAT,LON}&freq={MHZ}&wire={copper|steel}&core={CORE_KEY}&gauge={AWG}&watts={W}&month={1-12}&auto={0|1}
```

### Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `from` | `lat,lon` decimal degrees | No | Your station location |
| `to` | `lat,lon` decimal degrees | No | Target station location |
| `freq` | number 1–30 | No | Operating frequency in MHz |
| `wire` | `copper` or `steel` | No | Legacy wire type for velocity factor |
| `core` | wire core key (see "Wire cores") | No | Detailed wire core selection — overrides `wire` |
| `gauge` | AWG number e.g. `14`, `18`, `22` | No | Wire gauge in AWG; custom values accepted |
| `legend` | number + optional unit, e.g. `3`, `3in`, `0.5ft`, `0.08m` | No | Leg end height (inverted-V/dipole leg ends above ground). Bare number = inches. Default 3 in |
| `watts` | number, greater than 0, at most 10000 | No | Transmit power in watts — sets the LUF. The QR handoff encodes it so the receiver reproduces the sender's verdict |
| `month` | integer 1–12 | No | Month of operation — sets the MUF (season at every bounce) |
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
window.HFCalc.version     // e.g. '1.3.0' — always matches package.json
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
  wireType: 'copper',            // optional legacy: 'copper' or 'steel'
  wireCore: 'copper_bare',       // optional NEW: see "Wire cores" below
  wireGauge: '14',               // optional NEW: AWG, see "Wire gauges" below
});
console.log(result.distance.km);  // 9068.4
console.log(result.directive.antenna_type);  // "Sloper or longwire aimed toward target"
console.log(result.recommended_antennas);    // [{key,name,height}, ...]
console.log(result.velocity_factor);         // computed VF based on core+gauge
```

### Wire cores

The `wireCore` parameter accepts these values for selecting the conductor type:

| Key | Material | Base VF | Quality |
|---|---|---|---|
| `copper_bare` | Bare solid copper | 0.95 | excellent (default) |
| `copper_stranded` | Stranded copper | 0.94 | excellent |
| `copper_insulated` | Insulated copper (PVC) | 0.93 | good |
| `copper_clad_steel` | Copper-clad steel (CCS) | 0.95 | excellent |
| `galvanized_steel` | Galvanized steel | 0.90 | fair |
| `stainless_steel` | Stainless steel | 0.89 | fair |
| `iron` | Plain iron / mystery wire | 0.85 | poor (field-expedient only) |
| `speaker_wire` | Speaker wire / lamp cord | 0.92 | fair |

### Wire gauges

The `wireGauge` parameter accepts AWG values as strings: `'10'`, `'12'`, `'14'`, `'16'`, `'18'`, `'20'`, `'22'`, `'24'`. Custom AWG values (e.g. `'17'`) are also accepted — the math will interpolate. Thinner wire (higher AWG) has slightly higher VF; thicker wire has slightly lower VF.

#### `setFromLocation(value)` / `setToLocation(value)` / `setFrequency(value)` / `setWireType(value)`

Set inputs without triggering calculation. Useful when the AI wants to populate fields but let the user click CALCULATE themselves.

```javascript
window.HFCalc.setFromLocation('32.4316,-80.6698');
window.HFCalc.setToLocation('17NL2030');         // MGRS also accepted
window.HFCalc.setFrequency('7.3');
window.HFCalc.setWireType('steel');
```

#### `setLegEndHeight(value, unit)`

Set the inverted-V / dipole leg end height above ground (feeds the apex-height
optimizer). `unit` is `'in'` (default), `'ft'`, or `'m'`.

```javascript
window.HFCalc.setLegEndHeight(3);          // 3 inches (the default)
window.HFCalc.setLegEndHeight(6, 'ft');    // elevated inverted-V
```

#### `getInputs() → {from, to, freq, wireType, wireCore, wireGauge, velocityFactor, legEndHeightM}`

Read whatever's currently in the input fields. `legEndHeightM` is the leg end
height converted to meters.

#### `setMonth(value)` · `setTxWatts(value)`  — NEW (v1.38)

The month drives the MUF (season at every bounce) and the transmit power
drives the LUF. Both feed the `frequency_check` block in the next
`getResults()`. `setMonth` takes 1–12; `setTxWatts` takes watts (an
AN/PRC-160 is 2 / 5 / 10 / 20, the RF-5833H amp is 150). Until v1.38 these
were the only calculator inputs an external agent could not reach.

Like every setter here, these go through React state — allow the page a
moment (~250 ms) before reading the change back through `getResults()`.

#### `getResults() → Result | null`

Read the most recent calculation result, or `null` if nothing's been calculated.

#### `reset()`

Clear all inputs and results.

### Result schema

```javascript
{
  calc_seq: 7,                        // NEW (v1.36): increments every calculation.
                                      //   Poll this to tell a fresh answer from
                                      //   the previous one still in state.
  distance: { km: 9068.4, mi: 5635.6 },
  bearing: { deg: 92.7, cardinal: 'E' },
  frequency_mhz: 14.2,
  wire_type: 'copper',                // legacy
  wire_core: 'copper_bare',           // NEW: detailed core key
  wire_core_label: 'Bare Copper',     // NEW: human-readable label
  wire_gauge_awg: '14',               // NEW: AWG used for calculation
  velocity_factor: 0.95,              // NEW: actual VF used (core × gauge)
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

  leg_end_height_m: 0.0762,           // NEW: leg end height used by the apex optimizer

  frequency_check: {                  // NEW (v1.36): the propagation verdict —
    muf_mhz: 18.4,                    //   the point of the whole tool. null only
    fot_mhz: 14.2,                    //   before the ionospheric context exists.
    luf_mhz: 6.2,                     //   Same numbers the Frequency Check panel
    suggested_mhz: 14.2,             //   shows, evaluated at the current UTC hour.
    tx_watts: 20,
    path_closed: false,              //   true when LUF > MUF: nothing will close it
    using_default_solar: true,       //   true when no NOAA reading is cached
    verdict: { code: 'good', label: 'GOOD', ok: true },
  },

  recommended_antennas: [
    // height_plan is non-null for inverted-V / dipole / NVIS types on
    // skywave paths — the same numbers the antenna cards display.
    // kind 'apex':  { apexFt, apexM, optFt, feasible, practical,
    //                 actualTakeoffDeg, endNeededFt, legFt, legM,
    //                 endIn, endM, takeoffDeg, hops }
    // kind 'nvis':  { tenthWlFt, tenthWlM }  — keep center 8-10 ft, under 0.1 λ
    { key: 'invertedv',  name: 'INVERTED-V DIPOLE', height: '…',
      height_plan: { kind: 'apex', apexFt: 16.4, optFt: 30.3, feasible: false, /* … */ } },
    { key: 'longwire',   name: 'Longwire (random wire)', height: '6-30 ft', height_plan: null },
    { key: 'efhw',       name: 'End-Fed Half-Wave (EFHW)', height: '15-30 ft', height_plan: null },
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

> ### ⚠ The bridge is OFF by default. Load the app with `?embed=1`.
>
> ```
> https://tzeke000.github.io/hfcal/?embed=1
> ```
>
> Without that parameter every method except `ping` is refused, and the refusal
> tells you so.
>
> **Why.** Until v1.29 this bridge answered any message from any origin and
> broadcast its replies to `'*'`. The calculator caches the operator's last
> known-good coordinate pair and loads it into state before any user action, so
> any web page could embed the app, send `getInputs`, and read back where the
> operator had been and what they were shooting at. The frame runs on the app's
> own origin, so it sees the operator's own cached data. This app is used by
> Marines in the field; position is the one thing it must never hand out to a
> page that merely asked.
>
> A host that genuinely embeds the calculator builds the URL and adds the
> parameter. A drive-by iframe does not. Replies are also now addressed to the
> asking origin rather than broadcast, and operator data is never sent to an
> opaque (`"null"`) origin, because an opaque origin cannot be checked.
>
> **Cross-origin hosts additionally need one-time operator approval** (since
> v1.46). `?embed=1` is attacker-supplied — a hostile page can `window.open`
> the app with it and message from the opener, which the framing check cannot
> see. So the data-bearing methods (`calculate`, `getResults`, `getInputs`)
> answer a cross-origin sender only after the operator taps **ALLOW THIS
> HOST** on a card the app shows when the first request arrives. The refusal
> reply says approval is pending; re-send the request after the operator
> approves. Approved origins persist on the device. Same-origin senders and
> the `set*` / `ping` methods are unaffected.
>
> `window.HFCalc.*` (Channel 2) is unaffected — it requires running script in
> the page itself, which is a different thing entirely.

### Schema

**Request (host → calculator):**
```javascript
{
  type: 'hfcalc:request',
  id: 'unique-id-for-correlation',
  method: 'calculate' | 'getResults' | 'getInputs' | 'reset' | 'setFromLocation' | 'setToLocation' | 'setLegEndHeight' | 'setMonth' | 'setTxWatts' | 'ping',
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
  version: '1.3.0',
  signature: 'HFCALC-AG-EZK-USMC-v1'
}
```

### Example: host driving the calculator in an iframe

```javascript
const HFCALC_ORIGIN = 'https://tzeke000.github.io';
// NOTE the ?embed=1 — the bridge stays off without it. See the box above.
// <iframe id="hfcalc-iframe" src="https://tzeke000.github.io/hfcal/?embed=1">
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
    }, HFCALC_ORIGIN);   // address the calculator, do not broadcast
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
- `getInputs` — returns `{from, to, freq, wireType, wireCore, wireGauge, velocityFactor, legEndHeightM}`
- `reset` — clears state
- `setFromLocation`, `setToLocation` — pass `{value: '...'}` in params
- `setLegEndHeight` — pass `{value: 3, unit: 'in'|'ft'|'m'}` in params
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

This integration layer is part of the HF Field Antenna Calculator, original work of **Cpl Angeles-Gonzalez, Ezekiel S.**, USMC. Project signature `HFCALC-AG-EZK-USMC-v1`. Released under [CC BY-NC-ND 4.0](../LICENSE).
