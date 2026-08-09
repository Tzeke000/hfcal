// Documentation that points at files which exist.
//
// This project's recurring failure mode is a fact stated in two places where
// only one gets updated (docs/VALIDATION.md Parts 25, 26 and 27). File paths
// are the worst version of it: a stale path in prose is invisible until
// somebody follows it, and the v1.32 reorganisation moved almost everything.
//
// The move did leave one broken link, found by hand. This is so the next one
// is found by the suite instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function markdownFiles(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      markdownFiles(rel, out);
    } else if (e.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

const DOCS = ['README.md', ...markdownFiles('docs'), ...markdownFiles('src'),
  ...markdownFiles('scripts')];

test('every markdown link points at something that exists', function() {
  const broken = [];
  for (const f of DOCS) {
    const body = readFileSync(join(ROOT, f), 'utf8');
    for (const m of body.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
      const target = m[2].split('#')[0].trim();
      if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
      if (!existsSync(resolve(ROOT, dirname(f), target))) {
        broken.push(f + ' -> ' + target);
      }
    }
  }
  assert.deepEqual(broken, [], 'broken links:\n  ' + broken.join('\n  '));
});

test('every repo path named in backticks exists', function() {
  // Catches "see src/freqAdvisor.js" going stale after a move, which is the
  // form most of this project's prose uses.
  const missing = [];
  for (const f of DOCS) {
    const body = readFileSync(join(ROOT, f), 'utf8');
    for (const m of body.matchAll(/`((?:src|tests|scripts|public|docs)\/[^`\s]+\.[A-Za-z0-9]{1,5})`/g)) {
      if (!existsSync(join(ROOT, m[1]))) missing.push(f + ' -> ' + m[1]);
    }
  }
  assert.deepEqual(missing, [], 'paths named in docs that do not exist:\n  ' + missing.join('\n  '));
});

test('the npm scripts point at directories that exist', function() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    for (const m of String(cmd).matchAll(/(?:^|\s)((?:src|tests|scripts)\/[^\s*]*)/g)) {
      const p = m[1].replace(/\/$/, '');
      assert.ok(existsSync(join(ROOT, p)), 'npm script "' + name + '" references missing ' + p);
    }
  }
});
