# ATAK Plugin — Scoping Plan

**HF Field Antenna Calculator → TAK ecosystem**
Original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC
Status: scoping document (no plugin code yet)

---

## Why ATAK

ATAK (Android Team Awareness Kit) is where tactical Android software actually
lives: units already run it, devices are already fielded and accredited, and
a plugin inherits that distribution channel instead of fighting for its own.
An HF antenna-planning plugin puts this capability one tap away from the map
the RTO is already looking at — with the TX position and the distant station
as map points instead of typed coordinates.

## What the plugin would do (MVP)

1. User selects own position (self marker) and a target marker on the map.
2. Plugin computes everything the web app computes today: distance/bearing,
   zone, terrain-aware takeoff angle, hop structure, antenna
   recommendations, wire cut lengths for the selected core/gauge, apex
   height with feasibility check.
3. Results render in a plugin pane; antenna azimuth drawn on the map as a
   bearing line from self position.
4. Fully offline, like the host app.

Stretch (post-MVP): CoT message to share an antenna plan with another
station; range rings for NVIS/single-hop coverage; DTED terrain lookup from
ATAK's own elevation data instead of the bounding-box terrain DB (a real
upgrade over the web app).

## Architecture decision

ATAK plugins are Android (Java/Kotlin) loaded by the ATAK host APK. Three
routes, with a clear recommendation:

| Route | Effort | Verdict |
|---|---|---|
| **A. Port the math to Kotlin** | ~600 lines to port (antennaMath.js + propagation.js are already isolated, pure, and unit-tested) | **Recommended.** Native pane, native map objects, no WebView friction. Parity enforced by sharing test vectors (JSON fixtures generated from the JS test suite, run against both implementations). |
| B. WebView plugin hosting the PWA | Low | Fast demo, but WebView plugins feel bolted-on, complicate offline packaging, and limit map integration. Good for a proof-of-concept only. |
| C. Standalone Capacitor app + CoT/intents | Low-medium | Already half-built (Capacitor config exists), but it's *next to* ATAK, not *in* it — doesn't inherit the distribution advantage. |

The JS→Kotlin port is small because of work already done: all physics lives
in two dependency-free modules with 42 pinned tests. The port carries the
tests over; the VOACAP validation transfers to any implementation that
passes the same vectors.

## Concrete steps

1. **Accounts/SDK:** register at tak.gov, download the ATAK-CIV SDK and
   plugin template (public; MIL variants come later through the program).
2. **Port `antennaMath` + `propagation` to Kotlin** with the shared
   test-vector harness (export vectors from the JS tests as JSON; both
   suites must pass identically).
3. **MVP pane UI** (Android layout mirroring the web app's card flow) +
   marker selection + bearing line.
4. **Field test** with the developer's own unit on ATAK-CIV.
5. **TAK Product Center third-party submission** for listing — this is the
   distribution unlock, and where program-office conversations start
   naturally.

Rough effort: MVP is a few weekends of Android work for someone comfortable
in Kotlin; the physics port and its tests are the easy part.

## Prerequisites / blockers

- Google-quality Android dev environment (Android Studio + ATAK SDK).
- The licensing question must be settled first (current CC BY-NC-ND blocks
  derivative works — as author, dual-license or relicense deliberately).
- Ethics/JAG consult if this moves from hobby to anything sold or officially
  adopted (see capability-brief discussion).
- USMC branding/EGA must not appear in the plugin build (trademark).
