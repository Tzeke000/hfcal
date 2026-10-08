// What changed, in each release — for the operator, not for developers.
// Shown on the HELP tab under WHAT'S NEW (latest few), each with the date it
// was released and the date it reached THIS device.
//
// Newest first. Every release adds an entry at the top: tests/unit/
// changelog.test.js fails if the newest entry is not the version in
// package.json, so this list cannot quietly go stale.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

export const CHANGELOG = [
  {
    version: '1.61.0', date: '2026-10-08', title: 'What’s new',
    notes: [
      'This list: the last few updates, what they changed, and when each reached this device.',
    ],
  },
  {
    version: '1.60.0', date: '2026-10-06', title: 'Tabs along the bottom',
    notes: [
      'PLAN, TOOLS and HELP tabs. PLAN goes straight to the job: your station, target, antenna settings, CALCULATE.',
      'A NEXT row under the answer jumps to the compass, save/QR, the truth log, the forecast or SOI.',
      'HELP has a “where is everything” list. Offline status and INSTALL moved to the header.',
    ],
  },
  {
    version: '1.59.0', date: '2026-10-06', title: 'Is it safe to lose signal?',
    notes: [
      'The app says whether it is saved for offline use: saving, ready, or that the phone refused (usually storage full).',
    ],
  },
  {
    version: '1.58.1', date: '2026-10-06', title: 'Install count fix',
    notes: ['The crash-recovery screen no longer makes a phone count as a second install.'],
  },
  {
    version: '1.58.0', date: '2026-10-02', title: 'Whole-world terrain, offline',
    notes: [
      'Detailed (~4 km) terrain for every continent now ships inside the app and works with no signal. A one-time ~36 MB download.',
    ],
  },
  {
    version: '1.57.0', date: '2026-10-02', title: 'Detailed terrain',
    notes: [
      'Terrain went from ~28 km to ~4 km detail. Base heights and nearby ridges are much more accurate.',
    ],
  },
  {
    version: '1.56.0', date: '2026-10-02', title: 'Real terrain, both ends',
    notes: [
      'Mountains now come from real elevation data, not hand-drawn boxes.',
      'A ridge beside the FAR station is now checked too, not just one beside you.',
    ],
  },
  {
    version: '1.55.0', date: '2026-10-01', title: 'Field reports to a spreadsheet',
    notes: ['Truth-log results can go to the author’s results sheet automatically (opt-in, no grids by default).'],
  },
];
