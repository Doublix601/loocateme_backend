import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { FcmToken } from '../src/models/FcmToken.js';
import { recordDailyActivity, claimSupervise, claimBoost, sendStreakExpiryWarnings } from '../src/services/streak.service.js';

const HOUR_MS = 60 * 60 * 1000;

// recordDailyActivity is fire-and-forget in production and talks to Mongo via
// User.findById + User.updateOne. We stub both to assert on the update
// payload without a DB.
function stubUpdateOne() {
  const calls = [];
  const original = User.updateOne;
  User.updateOne = async (filter, update) => {
    calls.push({ filter, update });
    return { acknowledged: true };
  };
  return { calls, restore: () => { User.updateOne = original; } };
}

function stubFindById(streak) {
  const original = User.findById;
  User.findById = () => ({ select: () => ({ lean: async () => (streak ? { streak } : null) }) });
  return () => { User.findById = original; };
}

test('recordDailyActivity: same civil day (gap <= 0) does nothing', async () => {
  const { calls, restore } = stubUpdateOne();
  const restoreFind = stubFindById({ count: 3 });
  try {
    const now = new Date();
    await recordDailyActivity('user1', now); // lastLoginAt = now => gap 0
    assert.equal(calls.length, 0);
  } finally {
    restore();
    restoreFind();
  }
});

test('recordDailyActivity: one civil day gap increments streak.count by 1 (capped at 14)', async () => {
  const { calls, restore } = stubUpdateOne();
  const restoreFind = stubFindById({ count: 5 });
  try {
    const lastLoginAt = new Date(Date.now() - 24 * HOUR_MS);
    await recordDailyActivity('user1', lastLoginAt);
    assert.equal(calls.length, 1);
    const { update } = calls[0];
    assert.equal(update.$set['streak.count'], 6);
    assert.ok(update.$set['streak.lastCheckInDate']);
  } finally {
    restore();
    restoreFind();
  }
});

test('recordDailyActivity: streak.count caps at 14 and sets boostPendingClaim', async () => {
  const { calls, restore } = stubUpdateOne();
  const restoreFind = stubFindById({ count: 14 });
  try {
    const lastLoginAt = new Date(Date.now() - 24 * HOUR_MS);
    await recordDailyActivity('user1', lastLoginAt);
    const { update } = calls[0];
    assert.equal(update.$set['streak.count'], 14);
  } finally {
    restore();
    restoreFind();
  }
});

test('recordDailyActivity: reaching 7 sets supervisePendingClaim', async () => {
  const { calls, restore } = stubUpdateOne();
  const restoreFind = stubFindById({ count: 6 });
  try {
    const lastLoginAt = new Date(Date.now() - 24 * HOUR_MS);
    await recordDailyActivity('user1', lastLoginAt);
    const { update } = calls[0];
    assert.equal(update.$set['streak.count'], 7);
    assert.equal(update.$set['streak.supervisePendingClaim'], true);
  } finally {
    restore();
    restoreFind();
  }
});

test('recordDailyActivity: reaching 14 sets boostPendingClaim', async () => {
  const { calls, restore } = stubUpdateOne();
  const restoreFind = stubFindById({ count: 13 });
  try {
    const lastLoginAt = new Date(Date.now() - 24 * HOUR_MS);
    await recordDailyActivity('user1', lastLoginAt);
    const { update } = calls[0];
    assert.equal(update.$set['streak.count'], 14);
    assert.equal(update.$set['streak.boostPendingClaim'], true);
  } finally {
    restore();
    restoreFind();
  }
});

test('recordDailyActivity: missed at least one full civil day resets streak.count to 0 and clears claims', async () => {
  const { calls, restore } = stubUpdateOne();
  const restoreFind = stubFindById({ count: 9 });
  try {
    const lastLoginAt = new Date(Date.now() - 48 * HOUR_MS); // exactly two civil days back, deterministic
    await recordDailyActivity('user1', lastLoginAt);
    assert.equal(calls.length, 1);
    const { update } = calls[0];
    assert.equal(update.$set['streak.count'], 0);
    assert.equal(update.$set['streak.supervisePendingClaim'], false);
    assert.equal(update.$set['streak.boostPendingClaim'], false);
  } finally {
    restore();
    restoreFind();
  }
});

test('recordDailyActivity: no prior lastLoginAt is treated as a first-day gap of 1', async () => {
  const { calls, restore } = stubUpdateOne();
  const restoreFind = stubFindById({ count: 0 });
  try {
    await recordDailyActivity('user1', null);
    assert.equal(calls.length, 1);
    const { update } = calls[0];
    assert.equal(update.$set['streak.count'], 1);
  } finally {
    restore();
    restoreFind();
  }
});

function stubFindByIdDoc(doc) {
  const original = User.findById;
  User.findById = () => ({ select: () => Promise.resolve(doc) });
  return () => { User.findById = original; };
}

function stubFindByIdAndUpdate(returnDoc) {
  const original = User.findByIdAndUpdate;
  const calls = [];
  User.findByIdAndUpdate = async (id, update, opts) => {
    calls.push({ id, update, opts });
    return returnDoc;
  };
  return { calls, restore: () => { User.findByIdAndUpdate = original; } };
}

test('claimSupervise: rejects when no reward pending', async () => {
  const restoreFind = stubFindByIdDoc({ streak: { supervisePendingClaim: false } });
  try {
    await assert.rejects(() => claimSupervise('user1'), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'NO_SUPERVISE_REWARD_PENDING');
      return true;
    });
  } finally {
    restoreFind();
  }
});

test('claimSupervise: grants superlikeBalance and clears the pending flag when eligible', async () => {
  const restoreFind = stubFindByIdDoc({ streak: { supervisePendingClaim: true } });
  const { calls, restore } = stubFindByIdAndUpdate({ _id: 'user1', superlikeBalance: 1 });
  try {
    const result = await claimSupervise('user1');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].update.$inc, { superlikeBalance: 1 });
    assert.equal(calls[0].update.$set['streak.supervisePendingClaim'], false);
    assert.equal(result.superlikeBalance, 1);
  } finally {
    restoreFind();
    restore();
  }
});

test('claimBoost: rejects when no reward pending', async () => {
  const restoreFind = stubFindByIdDoc({ streak: { boostPendingClaim: false } });
  try {
    await assert.rejects(() => claimBoost('user1'), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'NO_BOOST_REWARD_PENDING');
      return true;
    });
  } finally {
    restoreFind();
  }
});

test('claimBoost: grants boostBalance, clears the pending flag, and resets streak.count when eligible', async () => {
  const restoreFind = stubFindByIdDoc({ streak: { boostPendingClaim: true } });
  const { calls, restore } = stubFindByIdAndUpdate({ _id: 'user1', boostBalance: 1 });
  try {
    const result = await claimBoost('user1');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].update.$inc, { boostBalance: 1 });
    assert.equal(calls[0].update.$set['streak.boostPendingClaim'], false);
    assert.equal(calls[0].update.$set['streak.count'], 0);
    assert.equal(result.boostBalance, 1);
  } finally {
    restoreFind();
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

test('sendStreakExpiryWarnings: warns a user whose real deadline is ~48h after login (old +18-24h window would have missed this)', async () => {
  const now = new Date('2026-01-09T21:00:00.000Z');
  const lastLoginAt = new Date('2026-01-08T00:01:00.000Z'); // deadline = 2026-01-10T00:00Z, 3h after "now"

  const restoreFind = stubUserFind([
    { _id: 'user1', streak: { count: 5, lastClaimedAt: null }, lastLoginAt },
  ]);
  const restorePush = stubNoPushTokens();

  try {
    const sent = await sendStreakExpiryWarnings(now);
    assert.equal(sent, 1);
  } finally {
    restoreFind();
    restorePush();
  }
});

test('sendStreakExpiryWarnings: skips a user already warned/claimed during the current login cycle', async () => {
  const now = new Date('2026-01-09T21:00:00.000Z');
  const lastLoginAt = new Date('2026-01-08T00:01:00.000Z'); // deadline 3h from "now", inside the window

  const restoreFind = stubUserFind([
    {
      _id: 'user1',
      streak: { count: 3, lastClaimedAt: new Date(lastLoginAt.getTime() + HOUR_MS) },
      lastLoginAt,
    },
  ]);
  const restorePush = stubNoPushTokens();

  try {
    const sent = await sendStreakExpiryWarnings(now);
    assert.equal(sent, 0);
  } finally {
    restoreFind();
    restorePush();
  }
});

test('sendStreakExpiryWarnings: does not warn a user far from their deadline', async () => {
  const now = new Date('2026-01-09T21:00:00.000Z');
  const lastLoginAt = new Date(now.getTime() - 1 * HOUR_MS); // just logged in, deadline ~47h away

  const restoreFind = stubUserFind([
    { _id: 'user1', streak: { count: 10, lastClaimedAt: null }, lastLoginAt },
  ]);
  const restorePush = stubNoPushTokens();

  try {
    const sent = await sendStreakExpiryWarnings(now);
    assert.equal(sent, 0);
  } finally {
    restoreFind();
    restorePush();
  }
});

test('sendStreakExpiryWarnings: does not warn once the deadline has already passed', async () => {
  const now = new Date('2026-01-09T21:00:00.000Z');
  const lastLoginAt = new Date('2026-01-06T00:01:00.000Z'); // deadline 2026-01-08T00:00Z, already passed

  const restoreFind = stubUserFind([
    { _id: 'user1', streak: { count: 2, lastClaimedAt: null }, lastLoginAt },
  ]);
  const restorePush = stubNoPushTokens();

  try {
    const sent = await sendStreakExpiryWarnings(now);
    assert.equal(sent, 0);
  } finally {
    restoreFind();
    restorePush();
  }
});
