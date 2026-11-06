import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowAndroidSwitch, SHOW_UNTIL } from '../../src/lib/androidSwitch.js';

test('android switch notice: shown on the website until dismissed or expired', function() {
  const nov = new Date('2026-11-06T12:00:00Z');
  assert.equal(shouldShowAndroidSwitch(nov, false, false), true, 'web user, not dismissed');
  assert.equal(shouldShowAndroidSwitch(nov, false, true), false, 'GOT IT must stick');
  assert.equal(shouldShowAndroidSwitch(nov, true, false), false, 'never inside the Android app');
  assert.equal(shouldShowAndroidSwitch(new Date(SHOW_UNTIL + 'T00:00:00Z'), false, false), false, 'stops by itself');
  assert.equal(shouldShowAndroidSwitch(new Date('2027-02-28T23:00:00Z'), false, false), true);
});
