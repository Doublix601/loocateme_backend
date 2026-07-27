import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { FcmToken } from '../src/models/FcmToken.js';
import { recordDailyActivity, sendCoteExpiryWarnings } from '../src/services/cote.service.js';

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

function stubUserFind(users) {
  const original = User.find;
  User.find = () => ({
    select: () => ({ lean: async () => users }),
  });
  return () => { User.find = original; };
}

// sendPushUnified resolves tokens via FcmToken.find; stub it to return none so
// the real push service short-circuits to a no-op skip instead of hitting a DB.
function stubNoPushTokens() {
  const original = FcmToken.find;
  FcmToken.find = () => ({ distinct: async () => [] });
  return () => { FcmToken.find = original; };
}

test('sendCoteExpiryWarnings: warns a user whose real deadline is ~48h after login (old +18-24h window would have missed this)', async () => {
  // Fixed reference "now": 2026-01-10T02:00:00Z. Login at 2026-01-08T00:01Z
  // (just after UTC midnight) => decay deadline = UTC midnight two calendar
  // days later = 2026-01-10T00:00Z, which is *in the past* relative to "now"
  // here (48h+ after login), and *well past* the old fixed 18-24h-since-login
  // window that never would have looked this far out. Use a "now" 3h before
  // that midnight instead so it falls inside the new 6h pre-deadline window.
  const now = new Date('2026-01-09T21:00:00.000Z');
  const lastLoginAt = new Date('2026-01-08T00:01:00.000Z'); // deadline = 2026-01-10T00:00Z, 3h after "now"

  const restoreFind = stubUserFind([
    { _id: 'user1', cotePercent: 75, lastLoginAt, coteWarningSentAt: null },
  ]);
  const restorePush = stubNoPushTokens();
  let updateCalls = [];
  const restoreUpdate = (() => {
    const original = User.updateOne;
    User.updateOne = async (filter, update) => { updateCalls.push({ filter, update }); return { acknowledged: true }; };
    return () => { User.updateOne = original; };
  })();

  try {
    const sent = await sendCoteExpiryWarnings(now);
    assert.equal(sent, 1);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].filter._id, 'user1');
  } finally {
    restoreFind();
    restorePush();
    restoreUpdate();
  }
});

test('sendCoteExpiryWarnings: skips a user already warned during the current login cycle', async () => {
  const now = new Date('2026-01-09T21:00:00.000Z');
  const lastLoginAt = new Date('2026-01-08T00:01:00.000Z'); // deadline 3h from "now", inside the window

  const restoreFind = stubUserFind([
    {
      _id: 'user1',
      cotePercent: 50,
      lastLoginAt,
      coteWarningSentAt: new Date(lastLoginAt.getTime() + HOUR_MS), // already warned since this login
    },
  ]);
  const restorePush = stubNoPushTokens();

  try {
    const sent = await sendCoteExpiryWarnings(now);
    assert.equal(sent, 0);
  } finally {
    restoreFind();
    restorePush();
  }
});

test('sendCoteExpiryWarnings: does not warn a user far from their deadline', async () => {
  const now = new Date('2026-01-09T21:00:00.000Z');
  const lastLoginAt = new Date(now.getTime() - 1 * HOUR_MS); // just logged in, deadline ~47h away

  const restoreFind = stubUserFind([
    { _id: 'user1', cotePercent: 100, lastLoginAt, coteWarningSentAt: null },
  ]);
  const restorePush = stubNoPushTokens();

  try {
    const sent = await sendCoteExpiryWarnings(now);
    assert.equal(sent, 0);
  } finally {
    restoreFind();
    restorePush();
  }
});

test('sendCoteExpiryWarnings: does not warn once the deadline has already passed', async () => {
  const now = new Date('2026-01-09T21:00:00.000Z');
  const lastLoginAt = new Date('2026-01-06T00:01:00.000Z'); // deadline 2026-01-08T00:00Z, already passed

  const restoreFind = stubUserFind([
    { _id: 'user1', cotePercent: 25, lastLoginAt, coteWarningSentAt: null },
  ]);
  const restorePush = stubNoPushTokens();

  try {
    const sent = await sendCoteExpiryWarnings(now);
    assert.equal(sent, 0);
  } finally {
    restoreFind();
    restorePush();
  }
});
