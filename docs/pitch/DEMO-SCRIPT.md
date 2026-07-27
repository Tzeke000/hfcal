# 5-Minute Demo Script

Run it on a phone, in airplane mode, handed to the audience if possible.
The medium is the message: no laptop, no network, no login.

---

**[0:00] Setup — one sentence.**
"Two grids and a frequency. Watch how long this takes."

**[0:15] Put the phone in airplane mode** — do it visibly, first.
"Everything you're about to see happens with zero connectivity."

**[0:30] Enter the scenario.** Your position (paste an MGRS grid — mention
the DAGR button-sequence instructions are built in for Marines who have
never pulled coords off one), a distant station ~700–800 km away,
frequency 11.104 MHz.

**[1:00] Select the wire that hurts.** Pick **stainless steel, 18 AWG** —
not copper. Say: "Planning tools assume catalog antennas. This models the
wire you actually scrounged — the velocity factor changes, so every cut
length just changed. Watch the numbers."

**[1:30] CALCULATE. Walk the results top-down, fast:**
- Distance / bearing — from the grids.
- Propagation zone + hop analysis — "single F2 hop, and here's the
  terrain-adjusted takeoff angle it needs."
- **The inverted-V card — the money slide.** "It computed the
  radiation-optimal apex height for this exact path… and then checked
  whether quarter-wave legs can physically reach it. They can't — so it
  tells me the buildable maximum, what takeoff angle I actually get at
  that height, and the two ways to fix it. No fielded tool does this."
- Cut lengths in feet-and-inches per leg, for stainless 18 AWG
  specifically.
- Build steps — "written for the Marine who has never built one."

**[2:45] Change the frequency, live.** Results recompute as you type.
"Frequency change from higher? New cut lengths, new apex, instantly.
Re-planning in the field costs nothing."

**[3:15] The validation claim** — one line, then move on:
"The takeoff-angle model was validated against VOACAP — the government's HF
prediction standard — within about a degree across everything from NVIS to
6000 km. The study and the script to reproduce it are public in the repo."

**[3:45] Turn airplane mode off, pull to refresh.** The Space Weather card
appears: live NOAA solar flux and Kp with path-specific advisories.
"Online it adds current conditions from NOAA. Offline it never needed
them. That's the EMCON posture of the whole tool."

**[4:15] Close.**
"ALE picks the frequency. Nothing picks the antenna. This does — with the
government standard's accuracy, on a phone, for free, today. What would it
take to put this in front of [the schoolhouse / your Marines / the comm
chief] for an evaluation?"

---

### Prep checklist
- App installed to home screen beforehand (icon shows the version badge).
- Have the 770 km scenario grids memorized or staged.
- Screenshot backup of every screen in case of device failure.
- Leave-behind: the one-page capability brief (`docs/CAPABILITY-BRIEF.md`)
  printed, with the validation chart on the back.
