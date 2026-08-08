# Protecting This Work — Practical Checklist

**This is not legal advice.** It is a plain-language to-do list for the
author, written so the steps are concrete rather than abstract. Anything with
real money attached deserves an actual attorney.

---

## Step 1 — Register the copyright (do this first)

Copyright exists the moment you write the code; you already own it. But
**registration** is what lets you sue and, critically, what lets you collect
**statutory damages and attorney's fees** instead of having to prove exactly
how much money you lost. Without registration, a lawsuit is usually not worth
filing. With it, a cease-and-desist letter carries real weight.

- File at **https://www.copyright.gov/registration/** — "Literary Work"
  covers computer programs.
- Cost is a modest filing fee (roughly $45–$65 for a single-author online
  filing; check the current schedule).
- **Deposit:** for source code the Copyright Office accepts the first 25 and
  last 25 pages, and you may **block out trade-secret portions**. You do not
  have to publish your whole codebase to register it.
- Register the **current version**, and re-register after any major rewrite.
  A registration covers the version deposited.
- **Timing matters.** To get statutory damages for an infringement, the
  registration generally has to be in place *before* the infringement starts
  (or within 3 months of first publication). Since this app is already
  public, register now — every month you wait is a month of exposure you
  cannot get statutory damages for.

## Step 2 — Get the ethics answer in writing

*(This is the point that was confusing before, so here it is plainly.)*

**What it means:** Ask your command's ethics counselor or the Staff Judge
Advocate to look at how you built this and confirm, **on paper**, that it is
your personal property and not a government work.

**Why bother, if you already know you built it off duty?** Because "I know
what I did" and "I can prove what I did, two years from now, to someone who
has a reason to disagree" are different things. Right now nobody is
disputing anything, so the answer you get will be a routine, neutral read of
the facts. If a contractor or a program office ever takes an interest, the
conversation becomes adversarial, memories get vague, and the same question
gets a lot harder to answer cleanly.

**How to do it:**

1. Take `PROVENANCE.md` to the ethics counselor / SJA.
2. Ask specifically: *"I developed this application off duty, on my own
   equipment, using only public information, and it was never directed by my
   chain of command. Can you confirm in writing that it is my personal
   property, and advise me on the Joint Ethics Regulation (DoD 5500.07-R)
   requirements for outside activities?"*
3. **Ask for the response in writing.** A verbal "yeah, you're fine" is worth
   nothing in two years. An email is fine. Save it.
4. If they also want an outside-activity notification or approval filed —
   file it. It costs you nothing and it makes the record cleaner, not dirtier.

**The one honest caveat:** you are asking a question they might answer in a
way you do not like. Given the facts as you have stated them — off duty, own
equipment, own network, public sources, undirected — that is unlikely. And
the alternative is worse: an unanswered question that surfaces for the first
time when someone else is motivated to answer it against you.

## Step 3 — Sign and date the provenance statement

*(The other point that was confusing. It is the simplest one on the list.)*

**What it means:** Print `PROVENANCE.md`, sign it, date it, and store a copy
somewhere that is not this repository — personal email to yourself, a cloud
drive, a paper copy at home.

**Why:** it converts what you remember into what you documented, *before*
anyone had a reason to argue about it. The git history already timestamps the
work; this timestamps the *circumstances* of the work, which git cannot.
Together they are hard to argue with.

**How long it takes:** ten minutes, today.

## Step 4 — Trademark the name (optional, later)

Copyright protects the code. A trademark protects the **name** — it stops
someone shipping a competing product called "HF Field Antenna Calculator" and
riding on your reputation. Filing a USPTO trademark runs a few hundred
dollars per class. Worth doing only if the name starts carrying value; not
urgent.

## Step 5 — Understand what a patent would and would not do

A patent protects the *method*, which is the one thing copyright does not
(see below). But:

- It is expensive — thousands of dollars, and years.
- In the U.S. there is a **one-year grace period** from your own first public
  disclosure. This app has been public since **May 2026**. If you ever want a
  U.S. patent on anything in it, that window closes around **May 2027**.
  Outside the U.S., most countries have no grace period at all — public
  disclosure already bars filing there.
- Much of the underlying physics is decades-old published art and is not
  patentable. Any patentable subject matter would be in the specific
  combination, not the equations.

Realistically: probably not worth it. But know the deadline exists rather
than discovering it later.

---

## The contractor question, answered honestly

> *"I would hate for a contractor to rebuild this and get money from it."*

Here is the real picture, without sugar-coating it.

### What copyright DOES stop

Copyright protects your **expression** — the actual code you wrote, the UI
text, the documentation, the layout, the images, the validation write-ups.
If a contractor takes any of that, even in part, even rewritten around the
edges, that is infringement. With a registration in hand (Step 1) that is a
real case with statutory damages attached, and usually it never gets to
court, because a demand letter from a registered copyright holder is taken
seriously.

Practically, this is the most likely scenario. Copying is easier than
rebuilding, the code is right there on GitHub, and people cut corners.
Registration is what turns "that's not fair" into "that's expensive for
them."

### What copyright does NOT stop

Copyright does **not** protect ideas, methods, formulas, or functionality. A
contractor who never looks at your code, and independently writes their own
app that computes apex height from a takeoff angle, is not infringing
anything. That is legal, and no amount of licensing changes it. The physics
is public — that is exactly what makes the app trustworthy, and it is also
what makes the concept copyable.

Anyone who tells you otherwise is selling you something.

### What actually protects you

So the defense is not purely legal. It is a combination:

1. **Registration** (Step 1) — makes literal copying genuinely expensive.
   This covers the most likely threat.

2. **The license you already have.** CC BY-NC-ND is unusually restrictive:
   no commercial use, no derivatives. A contractor cannot fork this, brand
   it, and sell it back to the government without a license from you. Keep
   that license. Do not switch to MIT or Apache to seem generous — that would
   hand away exactly the protection you are asking about.

3. **The provenance record** (Step 3) — closes the "this is government
   property anyway" argument before anyone makes it.

4. **The validation studies.** This is underrated and it is your strongest
   practical moat. A contractor can rebuild the *calculator* in a month. What
   they cannot cheaply rebuild is the evidence: three VOACAP studies, 114
   automated tests pinning the physics, reproduction scripts, and a public
   record of the model being corrected when it was wrong (flat-earth →
   curved-earth in v1.5, no-season → season in v1.13). That is a year of
   credibility. A program office comparing "validated against the government
   standard, here are the scripts" against "trust us" is not a close call.

5. **Being the person, not just the code.** You are an active-duty Marine
   communications technician who built and validated the thing on your own
   time. A contractor cannot buy that, and it is the part of the pitch that
   survives someone else writing similar software. The pitch materials in
   `docs/pitch/` lean on this deliberately.

6. **Register before you brief.** The practical rule: do not walk this into a
   program office, a contractor, or an innovation cell until Steps 1–3 are
   done. Show it after you own it on paper. Anything you demo before then,
   you are demoing on trust.

### One more thing worth knowing

If a government office ever wants to *fund* or *field* this, the transaction
is a **license or a purchase**, not a handover. You would be granting rights
— potentially "Government Purpose Rights" or a limited license — and the
scope is negotiable. Do not let anyone frame it as though the government
already has rights it has not paid for. Under the facts in
`PROVENANCE.md`, it does not.

---

## The short version

| # | Do this | When | Cost |
|---|---|---|---|
| 1 | Register the copyright at copyright.gov | **Now** | ~$45–65 |
| 2 | Get the ethics/SJA opinion **in writing** | **Now** | Free |
| 3 | Print, sign, date, and store `PROVENANCE.md` off-repo | **Today, 10 min** | Free |
| 4 | Keep the CC BY-NC-ND license | Ongoing | Free |
| 5 | Trademark the name | If it gains value | ~$250–350/class |
| 6 | Decide on a patent | Before **May 2027** | $$$ — probably skip |
| 7 | Finish 1–3 before briefing anyone | Rule of thumb | Free |

---

*Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC.
Project signature: HFCALC-AG-EZK-USMC-v1*
