# Objections & Answers

The questions you will actually get, with answers that survive follow-ups.

---

**"How do I know the math is right?"**
It's validated against VOACAP — the government's own HF prediction standard
— across 10 distances, 24 hours, two seasons, and two solar conditions.
Agreement is within 1.2° of the VOACAP median everywhere, exact at 2500 km.
The full methodology and a one-command reproduction script are in the repo
(`docs/VALIDATION.md`). Separately, 42 automated tests pin every formula to
published theory, so future changes can't silently break the physics.

**"Why not just use VOACAP / our planning tools?"**
Use them — at the planning level. They're desktop tools for trained
analysts. This is for the Marine at the wire with no laptop, no
connectivity, and five minutes: same-standard geometry plus the thing no
planning tool outputs — cut lengths for the wire in hand and buildable mast
heights with construction steps.

**"What about security / can it go on a government device?"**
No account, no telemetry, no server side, and no third-party CDN — static
files running entirely on-device, including the OCR engine and the webfonts.
Everything works with the radio off. Exactly one optional network call
exists: NOAA space-weather advisories, a public U.S. government feed, which
falls back to cached or default values when unreachable and which no
calculation depends on. It can be compiled out for a hardened build. The
review surface is small and the source is fully inspectable.

**"What happens when there's no signal?"**
Everything works. Offline-first is the design center, not a degraded mode.
The only thing you lose offline is the optional space-weather advisory,
which caches its last reading and labels its age.

**"Isn't the ionosphere too variable for a static model?"**
That's exactly what the validation measured. VOACAP's own predictions swing
across time of day, season, and solar cycle — this app's static answer sits
inside that envelope at every tested distance, i.e., it's the right single
number to carry when you can't run the full model. When online, the NOAA
feed adds current-conditions advisories (storm degradation, MUF cautions)
on top.

**"Who maintains it? What happens when you PCS?"**
The codebase is built for handover: physics isolated in small tested
modules, automated test suite, reproducible validation, documented release
process (version bump + one script). Any competent maintainer — government
or contractor — can pick it up. That's deliberate.

**"Radios with ALE already handle propagation."**
ALE selects frequencies from what the antenna delivers. It cannot
compensate for an antenna cut wrong, hung at the wrong height, or built
from uncorrected steel wire. Antenna geometry is the input ALE depends on —
and the part still done by hand, from memory.

**"What does it cost?"**
Today: nothing. It's deployable now for zero-cost unit evaluation. If the
government wants ownership, support, or derived work (e.g., an ATAK
plugin), that's a licensing conversation the author is prepared to have
through proper channels.

**"Is this authorized? Are you allowed to sell this?"**
Being handled correctly and in order: ethics/JAG consult first, trademark
licensing for any commercial variant, and a deliberate license decision by
the author. The free field tool and any commercial arrangement are separate
tracks. (Internal note: do the consult BEFORE pitching officially — see
pitch/README.md.)

**"Why should I trust a Corporal's side project?"**
Judge the artifact, not the rank. The physics is validated against the
government standard with a published, reproducible study; the code carries
an automated test suite; the tool is already deployed and usable. Also —
the person who builds field-expedient HF antennas for a living is exactly
the right person to have built this.
