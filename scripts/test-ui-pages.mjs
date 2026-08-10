// Run the browser suite against the Pages-base build — cross-platform.
//
// The obvious one-liner (`PWA_BASE=/hfcal/ vite build && …`) is Bash env
// syntax; npm on Windows hands it to cmd.exe and it dies (Iris R3-3). This
// wrapper sets the env in-process and spawns node directly, so the pages
// variant reproduces on any dev machine, not just ubuntu CI. No cross-env
// dependency: the repo stays dependency-light on principle.
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1

import { spawnSync } from 'node:child_process';

const env = { ...process.env, PWA_BASE: '/hfcal/', HFCALC_BASE_PATH: '/hfcal/' };

function run(args) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
}

run(['node_modules/vite/bin/vite.js', 'build']);
run(['--test', 'tests/ui/flows.test.mjs']);
