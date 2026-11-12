// The optional user list (v1.66): what it sends, and the promises it makes —
// SKIP sends nothing and sticks, an empty form is a SKIP, no signal loses
// nothing, nothing is asked until the Form is live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROSTER_CONFIG, ROSTER_FIELDS, ROSTER_KEY, cleanEntry, isEmptyEntry, encodeRoster, sendRoster, skipRoster,
  flushRoster, loadRoster, shouldAskRoster, isRosterConfigured,
} from '../../src/lib/roster.js';

const CFG = { formAction: 'https://docs.google.com/forms/d/e/X/formResponse',
  fields: Object.fromEntries(ROSTER_FIELDS.map((k, i) => [k, 'entry.' + (10 + i)])) };
const META = { platform: 'Android app', appVersion: '1.66.0', firstOpened: '2026-10-08' };

async function withStorage(fn) {
  const store = new Map();
  global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try { return await fn(store); } finally { delete global.localStorage; delete global.fetch; }
}

test('roster: entries are cleaned — trimmed, capped, MOS upper-cased, no control characters', function() {
  const e = cleanEntry({ name: '  Smith\n', rank: 'cpl', unit: 'x'.repeat(200), mos: ' 0621a ' });
  assert.equal(e.name, 'Smith');
  assert.equal(e.rank, 'cpl');
  assert.equal(e.unit.length, 80);
  assert.equal(e.mos, '0621A');
  assert.ok(isEmptyEntry({ name: '  ', rank: '', unit: '\t', mos: '' }));
  assert.ok(!isEmptyEntry({ mos: '0621' }));
});

test('roster: the row carries exactly the typed boxes plus kind of app, version and date', function() {
  const body = encodeRoster({ name: 'Smith', rank: 'Cpl', unit: '8th Comm Bn', mos: '0621' }, META, CFG);
  const sent = Object.fromEntries([...body.entries()]);
  assert.deepEqual(sent, {
    'entry.10': 'Smith', 'entry.11': 'Cpl', 'entry.12': '8th Comm Bn', 'entry.13': '0621',
    'entry.14': 'Android app', 'entry.15': '1.66.0', 'entry.16': '2026-10-08',
  });
  assert.equal(ROSTER_FIELDS.length, 7, 'a new field must be added to the Form and to this test on purpose');
});

test('roster: nothing is asked or sent until the Form is configured', async function() {
  await withStorage(async () => {
    assert.equal(isRosterConfigured({ formAction: '', fields: {} }), false);
    assert.equal(isRosterConfigured({ formAction: 'http://insecure/x', fields: { name: 'entry.1' } }), false, 'plain http is refused');
    assert.equal(shouldAskRoster({ formAction: '', fields: {} }), false);
    assert.equal(shouldAskRoster(CFG), true);
  });
});

test('roster: SKIP sends nothing and is remembered; an all-empty SEND is a SKIP', async function() {
  await withStorage(async () => {
    let calls = 0;
    global.fetch = () => { calls += 1; return Promise.resolve({}); };
    skipRoster();
    assert.equal(loadRoster().state, 'skipped');
    assert.equal(shouldAskRoster(CFG), false, 'asked again after SKIP');
    assert.equal(calls, 0);
  });
  await withStorage(async () => {
    let calls = 0;
    global.fetch = () => { calls += 1; return Promise.resolve({}); };
    assert.equal(await sendRoster({ name: ' ', mos: '' }, META, undefined, CFG), 'skipped');
    assert.equal(calls, 0, 'an empty form must not post a blank row');
  });
});

test('roster: no signal keeps the entry and sends it later, once', async function() {
  await withStorage(async () => {
    global.fetch = () => Promise.reject(new Error('offline'));
    assert.equal(await sendRoster({ name: 'Smith', mos: '0621' }, META, undefined, CFG), 'pending');
    assert.equal(loadRoster().state, 'pending');
    assert.equal(shouldAskRoster(CFG), false, 'asked again while the first answer is still waiting');
    const posted = [];
    global.fetch = (url, init) => { posted.push(new URLSearchParams(init.body).get('entry.10')); return Promise.resolve({}); };
    assert.equal(await flushRoster(CFG), 'sent');
    assert.equal(await flushRoster(CFG), 'sent');
    assert.deepEqual(posted, ['Smith'], 'sent more than once');
  });
});

test('roster: unreadable storage is treated as "not answered", never a crash', async function() {
  await withStorage(async (store) => {
    store.set(ROSTER_KEY, '{not json');
    assert.equal(loadRoster(), null);
    store.set(ROSTER_KEY, JSON.stringify({ state: 'weird' }));
    assert.equal(loadRoster(), null);
  });
});

test('roster: the live form is https and gets exactly its five questions', function() {
  assert.ok(isRosterConfigured(ROSTER_CONFIG));
  assert.match(ROSTER_CONFIG.formAction, /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/formResponse$/);
  const body = encodeRoster({ name: 'Smith', rank: 'Cpl', unit: '8th Comm Bn', mos: '0621' }, META, ROSTER_CONFIG);
  assert.deepEqual([...body.keys()].length, 5, 'the form has five questions: Name, Rank, Unit, MOS, Platform');
  assert.equal(body.get(ROSTER_CONFIG.fields.platform), 'Android app');
});
