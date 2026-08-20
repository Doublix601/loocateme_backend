import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { Location } from '../src/models/Location.js';
import { redisClient } from '../src/config/redis.js';
import { LocationController } from '../src/controllers/location.controller.js';

// Written before extracting getLocations' business logic (radius widening,
// scoring, sponsor injection) into location.service.js — captures the
// externally observable behavior so the extraction can be verified against
// it without depending on internal structure.

function stubNoBlocks() {
  const originalFindById = User.findById;
  const originalFind = User.find;
  User.findById = () => ({ select: () => ({ lean: () => Promise.resolve({ blockedUsers: [] }) }) });
  User.find = () => ({ select: () => ({ lean: () => Promise.resolve([]) }) });
  return () => {
    User.findById = originalFindById;
    User.find = originalFind;
  };
}

function stubRedisMiss() {
  const originalGet = redisClient.get;
  const originalSet = redisClient.set;
  // getLocations coalesces concurrent callers via singleflightRedis, which
  // takes its own Redis lock (`SET lockKey token NX PX ...`) before running
  // the aggregation. Simulate an uncontested lock acquisition and keep only
  // the actual cache writes in `sets` (what these tests care about).
  const sets = [];
  redisClient.get = async () => null;
  redisClient.set = async (key, value, opts) => {
    if (opts?.NX) return 'OK';
    sets.push({ key, value, opts });
    return 'OK';
  };
  return { sets, restore: () => { redisClient.get = originalGet; redisClient.set = originalSet; } };
}

function stubNoSponsor() {
  const original = Location.findOne;
  Location.findOne = () => ({ lean: () => Promise.resolve(null) });
  return () => { Location.findOne = original; };
}

function makeReqRes({ lat = 48.8566, lon = 2.3522, vibe, limit } = {}) {
  const req = { query: { lat: String(lat), lon: String(lon), vibe, limit }, user: { id: 'u1' } };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

const throwOnNext = (err) => { throw err; };

function makeIdReqRes(id) {
  const req = { params: { id }, user: { id: 'u1' } };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

// Mongoose-style chainable query stub supporting any order/combination of
// .select()/.sort()/.limit() before .lean() resolves.
function chainableQuery(result) {
  const q = {
    select: () => q,
    sort: () => q,
    limit: () => q,
    lean: () => Promise.resolve(result),
  };
  return q;
}

test('getLocations returns the first radius step once it has enough matches', async () => {
  const restoreBlocks = stubNoBlocks();
  const redis = stubRedisMiss();
  const restoreSponsor = stubNoSponsor();
  const maxDistancesRequested = [];
  const original = Location.aggregate;
  Location.aggregate = async (pipeline) => {
    maxDistancesRequested.push(pipeline[0].$geoNear.maxDistance);
    return Array.from({ length: 40 }, (_, i) => ({ _id: `loc-${i}`, distance: i, stars: 3, type: 'Bar 🍺' }));
  };
  try {
    const { req, res } = makeReqRes({ vibe: 'moon' });
    await LocationController.getLocations(req, res, throwOnNext);
    assert.deepEqual(maxDistancesRequested, [10000]);
    assert.equal(res.body.locations.length, 40);
    assert.equal(redis.sets.length, 1);
  } finally {
    Location.aggregate = original;
    restoreBlocks();
    redis.restore();
    restoreSponsor();
  }
});

test('getLocations never leaks Stripe subscription ids or KYC documents, regardless of businessTier', async () => {
  const restoreBlocks = stubNoBlocks();
  const redis = stubRedisMiss();
  const restoreSponsor = stubNoSponsor();
  const original = Location.aggregate;
  Location.aggregate = async () => [
    {
      _id: 'loc-pro',
      distance: 1,
      stars: 3,
      type: 'Bar 🍺',
      businessTier: 'pro2',
      subscription: { stripeCustomerId: 'cus_secret', stripeSubscriptionId: 'sub_secret' },
      documents: [{ type: 'KBIS', url: 'https://example.com/kbis.pdf', status: 'pending' }],
    },
  ];
  try {
    const { req, res } = makeReqRes({ vibe: 'moon' });
    await LocationController.getLocations(req, res, throwOnNext);
    const [loc] = res.body.locations;
    assert.equal(loc.subscription, undefined);
    assert.equal(loc.documents, undefined);
  } finally {
    Location.aggregate = original;
    restoreBlocks();
    redis.restore();
    restoreSponsor();
  }
});

test('getLocations widens the search radius until it finds enough locations', async () => {
  const restoreBlocks = stubNoBlocks();
  const redis = stubRedisMiss();
  const restoreSponsor = stubNoSponsor();
  const maxDistancesRequested = [];
  const original = Location.aggregate;
  Location.aggregate = async (pipeline) => {
    const maxDistance = pipeline[0].$geoNear.maxDistance;
    maxDistancesRequested.push(maxDistance);
    const count = maxDistance === 100000 ? 40 : 5;
    return Array.from({ length: count }, (_, i) => ({ _id: `loc-${maxDistance}-${i}`, distance: i, stars: 3, type: 'Bar 🍺' }));
  };
  try {
    const { req, res } = makeReqRes({ vibe: 'moon' });
    await LocationController.getLocations(req, res, throwOnNext);
    assert.deepEqual(maxDistancesRequested, [10000, 30000, 100000]);
    assert.equal(res.body.locations.length, 40);
  } finally {
    Location.aggregate = original;
    restoreBlocks();
    redis.restore();
    restoreSponsor();
  }
});

test('getLocations serves a cached response without hitting the DB, still stripping blocked users', async () => {
  const restoreBlocks = stubNoBlocks();
  const cachedPayload = { locations: [{ _id: 'loc-1', activeUsers: [{ _id: 'blocked-1' }, { _id: 'ok-1' }] }] };
  const originalGet = redisClient.get;
  redisClient.get = async () => JSON.stringify(cachedPayload);
  const originalAggregate = Location.aggregate;
  let aggregateCalled = false;
  Location.aggregate = async () => { aggregateCalled = true; return []; };
  User.findById = () => ({ select: () => ({ lean: () => Promise.resolve({ blockedUsers: ['blocked-1'] }) }) });
  User.find = () => ({ select: () => ({ lean: () => Promise.resolve([]) }) });
  try {
    const { req, res } = makeReqRes();
    await LocationController.getLocations(req, res, throwOnNext);
    assert.equal(aggregateCalled, false);
    assert.equal(res.body.locations[0].activeUsers.length, 1);
    assert.equal(res.body.locations[0].activeUsers[0]._id, 'ok-1');
  } finally {
    redisClient.get = originalGet;
    Location.aggregate = originalAggregate;
    restoreBlocks();
  }
});

test('getLocations rejects invisible-mode users and invalid coordinates before touching the DB', async () => {
  const { req: reqInvisible, res: resInvisible } = makeReqRes();
  reqInvisible.user.invisibleMode = true;
  await LocationController.getLocations(reqInvisible, resInvisible, throwOnNext);
  assert.equal(resInvisible.statusCode, 403);

  const { req: reqBad, res: resBad } = makeReqRes({ lat: 'nope' });
  await LocationController.getLocations(reqBad, resBad, throwOnNext);
  assert.equal(resBad.statusCode, 400);
});

// Regression test: getLocationById uses the process-local `singleflight`
// (not `singleflightRedis`, which getLocations was switched to) — a prior
// change removed the `singleflight` import while only updating getLocations,
// crashing this endpoint with "singleflight is not defined" in production.
test('getLocationById returns the location and its users on a cache miss', async () => {
  const restoreBlocks = stubNoBlocks();
  const redis = stubRedisMiss();
  const originalFindById = Location.findById;
  const fakeLocation = {
    _id: 'loc-1',
    name: 'Le Central',
    businessTier: 'none',
    popularity: 3,
    toObject() { return { ...this }; },
  };
  Location.findById = () => Promise.resolve(fakeLocation);
  const originalUserFind = User.find;
  // getBlockedIds (called first, via stubNoBlocks) and the location's
  // active-users query both go through User.find — disambiguate by filter
  // shape instead of a blanket override, otherwise the "who blocked me"
  // lookup would also resolve to the fake active-user list and incorrectly
  // filter it out via stripBlockedFromUsers.
  User.find = (filter) => {
    if (filter && filter.blockedUsers) return { select: () => ({ lean: () => Promise.resolve([]) }) };
    return chainableQuery([{ _id: 'user-1', boostUntil: null }]);
  };
  try {
    const { req, res } = makeIdReqRes('loc-1');
    await LocationController.getLocationById(req, res, throwOnNext);
    assert.equal(res.body.location._id, 'loc-1');
    assert.equal(res.body.users.length, 1);
    assert.equal(res.body.users[0]._id, 'user-1');
  } finally {
    Location.findById = originalFindById;
    User.find = originalUserFind;
    restoreBlocks();
    redis.restore();
  }
});

test('getLocationById returns 404 when the location does not exist', async () => {
  const restoreBlocks = stubNoBlocks();
  const redis = stubRedisMiss();
  const originalFindById = Location.findById;
  Location.findById = () => Promise.resolve(null);
  try {
    const { req, res } = makeIdReqRes('missing-id');
    await LocationController.getLocationById(req, res, throwOnNext);
    assert.equal(res.statusCode, 404);
  } finally {
    Location.findById = originalFindById;
    restoreBlocks();
    redis.restore();
  }
});
