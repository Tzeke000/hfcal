# Statement of Independent Creation

**Work:** HF Field Antenna Calculator (this repository)
**Author:** Cpl Angeles-Gonzalez, Ezekiel S.
**First commit:** 3 May 2026 · **Current version:** 1.13.0
**Repository:** https://github.com/Tzeke000/hfcal
**Project signature:** HFCALC-AG-EZK-USMC-v1

> **This is not legal advice.** It is a factual record written by the author,
> to be kept and — if the author chooses — reviewed by a command ethics
> counselor or SJA. Its value is that it was written *before* anyone disputed
> anything. See `COPYRIGHT-CHECKLIST.md` for what to do with it.

---

## Why this document exists

Under 17 U.S.C. § 105, copyright protection is not available for a "work of
the United States Government," which § 101 defines as a work prepared by a
government officer or employee **as part of that person's official duties**.
The dividing line is the phrase "official duties." A work created off duty,
on personal equipment, outside any assigned task is the author's own property
in the ordinary way — the author's military status alone does not transfer
anything to the government.

Because that line is factual rather than legal, the facts are what matter,
and they are easiest to establish while they are fresh. That is the whole
purpose of this file.

## The facts of creation

The author states the following:

1. **Not directed.** Development of this application was never directed,
   tasked, assigned, or requested by the author's chain of command. No order,
   tasker, work request, or performance objective covered it.

2. **Not on duty time.** All development was performed off duty, on the
   author's own time.

3. **Not on government equipment.** No government-owned or government-issued
   computer, phone, or other hardware was used to write, build, test, or
   publish this work.

4. **Not on government networks.** No DoD, government, or otherwise
   official network was used at any point.

5. **No non-public information.** The work uses no classified information, no
   Controlled Unclassified Information (CUI), no For Official Use Only
   material, no personally identifiable information, and no non-public
   government data of any kind.

## What the work is actually built from

Everything in this application derives from openly published sources, and the
repository shows exactly which ones:

- **Antenna and wire physics** — standard transmission-line and velocity-factor
  relations, with the AWG K-factor table from the ARRL Antenna Book, a
  commercially published reference.
- **Ionospheric propagation** — published layer heights and the curved-earth
  skip geometry from Davies, *Ionospheric Radio*, an open academic text.
- **Magnetic declination and dip** — the World Magnetic Model, published
  jointly by NOAA/NCEI and the British Geological Survey and distributed
  publicly.
- **Validation data** — VOACAP 16.1207W, run by the author from the
  open-source `voacapl` port. Reproduction scripts for every study are in
  `scripts/validation/`; raw outputs are in `docs/validation/`.
- **Software dependencies** — React, Vite, Tesseract.js, `geomagnetism`, all
  public open-source packages under permissive licenses.

The Marine Corps context in the app — DAGR button sequences, comm-card
formatting, the COMSEC warning — reflects publicly documented equipment
procedure and general operational familiarity. None of it reproduces
non-public doctrine, TTPs, or controlled material.

## Corroborating evidence already in the repository

This is not a bare assertion. The record supports it:

- **Git history** — every commit is individually timestamped and authored,
  from 3 May 2026 forward. It shows the work being built incrementally, in
  the open, by one person.
- **Public repository** — hosted publicly on GitHub with a public build and
  deployment history through GitHub Actions.
- **Author attribution in source** — the attribution and the project
  signature `HFCALC-AG-EZK-USMC-v1` are embedded in the source files, the
  UI, the package metadata, and the license.
- **Validation studies** — dated, reproducible, and run by the author.
- **Cited sources** — the app's own About tab lists where every formula comes
  from, which independently demonstrates the physics came from open
  literature rather than from anything internal.

## Licensing posture

The work is released under **Creative Commons
Attribution-NonCommercial-NoDerivatives 4.0 International (CC BY-NC-ND 4.0)**.
Copyright © 2026 Cpl Angeles-Gonzalez, Ezekiel S. All rights reserved.

In plain terms, the public license permits anyone to download and use the
app and to share it unmodified with attribution. It does **not** permit
commercial use, and it does **not** permit distributing a modified version.
Any commercial or derivative use — including by a government contractor —
requires a separate written license from the author.

Publishing it free for Marines to use is not the same thing as giving it away
for someone else to sell. Those are separate permissions, and only one of
them has been granted.

## Author's declaration

I, Cpl Angeles-Gonzalez, Ezekiel S., state that the facts above are true and
accurate to the best of my knowledge, and that this application is my own
original work, created entirely on my own time and my own equipment.

Signature: ______________________________  Date: ____________

---

*Retain a signed copy outside this repository. See `COPYRIGHT-CHECKLIST.md`.*
