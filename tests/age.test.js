import test from 'node:test';
import assert from 'node:assert/strict';
import { isAtLeast18 } from '../src/utils/age.js';

// isAtLeast18 gates account creation on a dating app — getting this wrong is
// a legal/compliance issue, so it's worth covering precisely even though it's
// a tiny pure function.

test('isAtLeast18: birthdate exactly 18 years ago today is at least 18', () => {
  const now = new Date();
  const birthdate = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  assert.equal(isAtLeast18(birthdate), true);
});

test('isAtLeast18: birthdate one day short of the 18th anniversary is not 18 yet', () => {
  const now = new Date();
  // Turns 18 tomorrow => still 17 today.
  const birthdate = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate() + 1);
  assert.equal(isAtLeast18(birthdate), false);
});

test('isAtLeast18: an unparsable birthdate is rejected rather than treated as adult', () => {
  assert.equal(isAtLeast18('not-a-date'), false);
});
