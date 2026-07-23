import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { recordDailyActivity } from '../src/services/cote.service.js';

const HOUR_MS = 60 * 60 * 1000;

// recordDailyActivity is fire-and-forget in production and talks to Mongo via
// User.updateOne. We stub it out to assert on the update payload without a DB.
function stubUpdateOne() {
  const calls = [];
  const original = User.updateOne;
  User.updateOne = async (filter, update) => {
    calls.push({ filter, update });
    return { acknowledged: true };
  };
  return { calls, restore: () => { User.updateOne = original; } };
}

test('recordDailyActivity: same civil day (gap <= 0) does nothing', async () => {
  const { calls, restore } = stubUpdateOne();
  try {
    const now = new Date();
    await recordDailyActivity('user1', now); // lastLoginAt = now => gap 0
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('recordDailyActivity: one civil day gap increments cotePercent by 25 (capped at 100)', async () => {
  const { calls, restore } = stubUpdateOne();
  try {
    // Yesterday at the same UTC time as "now" => exactly one civil day gap,
    // regardless of where "now" falls within its own UTC day.
    const lastLoginAt = new Date(Date.now() - 24 * HOUR_MS);
    await recordDailyActivity('user1', lastLoginAt);
    assert.equal(calls.length, 1);
    const [update] = calls[0].update;
    assert.deepEqual(update.$set.cotePercent, { $min: [100, { $add: ['$cotePercent', 25] }] });
    assert.equal(update.$set.coteWarningSentAt, null);
  } finally {
    restore();
  }
});

test('recordDailyActivity: missed at least one full civil day resets cotePercent to 0', async () => {
  const { calls, restore } = stubUpdateOne();
  try {
    const lastLoginAt = new Date(Date.now() - 48 * HOUR_MS); // exactly two civil days back, deterministic
    await recordDailyActivity('user1', lastLoginAt);
    assert.equal(calls.length, 1);
    const [, update] = [calls[0].filter, calls[0].update];
    assert.equal(update.$set.cotePercent, 0);
    assert.equal(update.$set.coteWarningSentAt, null);
  } finally {
    restore();
  }
});

test('recordDailyActivity: no prior lastLoginAt is treated as a first-day gap of 1', async () => {
  const { calls, restore } = stubUpdateOne();
  try {
    await recordDailyActivity('user1', null);
    assert.equal(calls.length, 1);
    const [update] = calls[0].update;
    assert.deepEqual(update.$set.cotePercent, { $min: [100, { $add: ['$cotePercent', 25] }] });
  } finally {
    restore();
  }
});
