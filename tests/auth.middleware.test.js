import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';

import { User } from '../src/models/User.js';
import { redisClient } from '../src/config/redis.js';
import { requireAuth } from '../src/middlewares/auth.js';

// requireAuth now caches the User.findById ban/role lookup (short TTL Redis
// cache, cf. utils/authCache.js) instead of hitting Mongo on every request.
// The one behavior that must NOT regress: recordDailyActivity (streak) reads
// the cached lastLoginAt too, and if the cache isn't invalidated right after
// it writes a new lastLoginAt, every subsequent request within the TTL would
// replay the same stale gap and re-increment the streak. These tests cover
// both the caching win and that specific correctness requirement.

function makeToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

function makeReqRes(userId) {
  const req = { headers: { authorization: `Bearer ${makeToken(userId)}` } };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

function stubUserFindById(doc) {
  const calls = [];
  const original = User.findById;
  User.findById = (id) => {
    calls.push(id);
    return { select: () => ({ lean: () => Promise.resolve(doc) }) };
  };
  return { calls, restore: () => { User.findById = original; } };
}

// Like stubUserFindById, but User.updateOne mutates the doc future finds
// return — needed to realistically test cache-invalidation-after-write.
function makeMutableUserStub(initialDoc) {
  let doc = { ...initialDoc };
  const findCalls = [];
  const updateCalls = [];
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  User.findById = (id) => {
    findCalls.push(id);
    return { select: () => ({ lean: () => Promise.resolve({ ...doc }) }) };
  };
  User.updateOne = async (filter, update) => {
    updateCalls.push(update);
    if (update.$set) doc = { ...doc, ...update.$set };
    return { acknowledged: true };
  };
  return {
    findCalls,
    updateCalls,
    restore: () => { User.findById = originalFindById; User.updateOne = originalUpdateOne; },
  };
}

function stubRedis() {
  const store = new Map();
  const originalGet = redisClient.get;
  const originalSet = redisClient.set;
  const originalDel = redisClient.del;
  redisClient.get = async (k) => (store.has(k) ? store.get(k) : null);
  redisClient.set = async (k, v) => { store.set(k, v); };
  redisClient.del = async (k) => { store.delete(k); };
  return { store, restore: () => { redisClient.get = originalGet; redisClient.set = originalSet; redisClient.del = originalDel; } };
}

// recordDailyActivity + the auth-cache invalidation run fire-and-forget
// (requireAuth calls next() without awaiting them) — let the microtask queue
// drain before asserting on their side effects.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('requireAuth caches the DB lookup and reuses it on the next request within the TTL', async () => {
  const find = stubUserFindById({ role: 'user', moderation: {}, lastLoginAt: new Date(), invisibleMode: false });
  const redis = stubRedis();
  try {
    const { req: req1, res: res1 } = makeReqRes('user-1');
    await requireAuth(req1, res1, (err) => { throw err; });
    await flush();
    assert.equal(find.calls.length, 1);
    assert.equal(req1.user.role, 'user');

    const { req: req2, res: res2 } = makeReqRes('user-1');
    await requireAuth(req2, res2, (err) => { throw err; });
    await flush();
    assert.equal(find.calls.length, 1); // served from cache, not Mongo
    assert.equal(req2.user.role, 'user');
  } finally {
    find.restore();
    redis.restore();
  }
});

test('requireAuth rejects a banned user (cached or not) without calling next', async () => {
  const find = stubUserFindById({ role: 'user', moderation: { bannedPermanent: true }, lastLoginAt: new Date(), invisibleMode: false });
  const redis = stubRedis();
  try {
    const { req, res } = makeReqRes('user-2');
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'BANNED');
  } finally {
    find.restore();
    redis.restore();
  }
});

test('requireAuth invalidates the auth cache once the streak actually advances, preventing a duplicate increment on the next request', async () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const stub = makeMutableUserStub({ role: 'user', moderation: {}, lastLoginAt: eightDaysAgo, invisibleMode: false, streak: { count: 3 } });
  const redis = stubRedis();
  try {
    const { req: req1, res: res1 } = makeReqRes('user-3');
    await requireAuth(req1, res1, (err) => { throw err; });
    await flush();
    assert.equal(stub.findCalls.length, 1);
    assert.equal(stub.updateCalls.length, 1); // streak reset/bumped once for the real day gap

    // Cache must have been invalidated after the write above: this second
    // request should re-fetch from Mongo (picking up the now-current
    // lastLoginAt) instead of replaying the stale cached value, which would
    // otherwise look like another new day and trigger a second update.
    const { req: req2, res: res2 } = makeReqRes('user-3');
    await requireAuth(req2, res2, (err) => { throw err; });
    await flush();
    assert.equal(stub.findCalls.length, 2);
    assert.equal(stub.updateCalls.length, 1); // no duplicate streak write
  } finally {
    stub.restore();
    redis.restore();
  }
});
