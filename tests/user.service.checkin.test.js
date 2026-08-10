import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { Location } from '../src/models/Location.js';
import { redisClient } from '../src/config/redis.js';
import { forceCheckIn, forceCheckOut, expireStalePresence } from '../src/services/user.service.js';

// Même approche que tests/streak.service.test.js : on stub les statics
// Mongoose directement (pas de DB réelle), en couvrant les deux formes
// d'appel utilisées par le code (`User.findById(id).select(...)` et
// `await User.findById(id)` sans .select, cf. le fallback "requête plus
// récente a gagné" dans forceCheckIn/forceCheckOut).
function stubUserFindById(docs) {
  const queue = Array.isArray(docs) ? [...docs] : null;
  const calls = [];
  const original = User.findById;
  User.findById = (id) => {
    calls.push(id);
    const doc = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : docs;
    return { select: () => Promise.resolve(doc), then: (resolve) => resolve(doc) };
  };
  return { calls, restore: () => { User.findById = original; } };
}

function stubLocationFindById(doc) {
  const original = Location.findById;
  Location.findById = () => ({ select: () => Promise.resolve(doc) });
  return () => { Location.findById = original; };
}

function stubFindOneAndUpdate(returnDoc) {
  const calls = [];
  const original = User.findOneAndUpdate;
  User.findOneAndUpdate = async (filter, update, opts) => {
    calls.push({ filter, update, opts });
    return returnDoc;
  };
  return { calls, restore: () => { User.findOneAndUpdate = original; } };
}

function stubUserFindSelect(docs) {
  const original = User.find;
  User.find = () => ({ select: () => Promise.resolve(docs) });
  return () => { User.find = original; };
}

function stubUpdateMany() {
  const calls = [];
  const original = User.updateMany;
  User.updateMany = async (filter, update) => {
    calls.push({ filter, update });
    return { acknowledged: true };
  };
  return { calls, restore: () => { User.updateMany = original; } };
}

// Les fonctions testées invalident le cache Redis (locationCache.js) — déjà
// protégé par un try/catch qui avale les erreurs de connexion, mais on stub
// quand même pour garder les tests rapides/déterministes sans dépendre d'un
// Redis en cours d'exécution.
function stubRedisCache() {
  const originalDel = redisClient.del;
  const originalKeys = redisClient.keys;
  redisClient.del = async () => 0;
  redisClient.keys = async () => [];
  return () => {
    redisClient.del = originalDel;
    redisClient.keys = originalKeys;
  };
}

const PARIS = { lat: 48.86, lon: 2.35 };
// ~130m au nord de PARIS (delta lat ~0.00117°) : au-delà de FORCE_CHECKIN_MAX_M (100m).
const FAR_FROM_PARIS = { lat: 48.8612, lon: 2.35 };

test('forceCheckIn: happy path sets currentLocation/currentLocationSince/lastCheckInMode', async () => {
  const restoreFindById = stubUserFindById([{ boostUntil: null, currentLocation: 'oldLoc' }]);
  const restoreLocation = stubLocationFindById({ location: { coordinates: [PARIS.lon, PARIS.lat] } });
  const { calls, restore: restoreUpdate } = stubFindOneAndUpdate({
    _id: 'user1',
    currentLocation: 'newLoc',
    currentLocationSince: new Date(),
    lastCheckInMode: 'manual',
  });
  const restoreRedis = stubRedisCache();
  try {
    const result = await forceCheckIn('user1', { locationId: 'newLoc', lat: PARIS.lat, lon: PARIS.lon, mode: 'manual' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].update.$set.currentLocation, 'newLoc');
    assert.equal(calls[0].update.$set.lastCheckInMode, 'manual');
    assert.ok(calls[0].update.$set.currentLocationSince instanceof Date);
    assert.equal(result.currentLocation, 'newLoc');
  } finally {
    restoreFindById.restore();
    restoreLocation();
    restoreUpdate();
    restoreRedis();
  }
});

test('forceCheckIn: rejects when farther than FORCE_CHECKIN_MAX_M without bypassDistance', async () => {
  const restoreFindById = stubUserFindById([{ boostUntil: null, currentLocation: null }]);
  const restoreLocation = stubLocationFindById({ location: { coordinates: [PARIS.lon, PARIS.lat] } });
  try {
    await assert.rejects(
      () => forceCheckIn('user1', { locationId: 'loc1', lat: FAR_FROM_PARIS.lat, lon: FAR_FROM_PARIS.lon }),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      },
    );
  } finally {
    restoreFindById.restore();
    restoreLocation();
  }
});

test('forceCheckIn: bypassDistance lifts the distance guard', async () => {
  const restoreFindById = stubUserFindById([{ boostUntil: null, currentLocation: null }]);
  const restoreLocation = stubLocationFindById({ location: { coordinates: [PARIS.lon, PARIS.lat] } });
  const { calls, restore: restoreUpdate } = stubFindOneAndUpdate({ _id: 'user1', currentLocation: 'loc1' });
  const restoreRedis = stubRedisCache();
  try {
    const result = await forceCheckIn('user1', {
      locationId: 'loc1',
      lat: FAR_FROM_PARIS.lat,
      lon: FAR_FROM_PARIS.lon,
      bypassDistance: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(result.currentLocation, 'loc1');
  } finally {
    restoreFindById.restore();
    restoreLocation();
    restoreUpdate();
    restoreRedis();
  }
});

test('forceCheckIn: throws BOOST_ACTIVE when a boost is currently running', async () => {
  const restoreFindById = stubUserFindById([{ boostUntil: new Date(Date.now() + 60_000), currentLocation: 'loc0' }]);
  try {
    await assert.rejects(
      () => forceCheckIn('user1', { locationId: 'loc1', lat: PARIS.lat, lon: PARIS.lon }),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'BOOST_ACTIVE');
        return true;
      },
    );
  } finally {
    restoreFindById.restore();
  }
});

test('forceCheckIn: ordering guard — a newer request already won, falls back to the current (already correct) state', async () => {
  const currentDoc = { _id: 'user1', currentLocation: 'newerLoc' };
  // 1er appel (boostUntil check) puis 2e appel (fallback sans .select, cf. stub thenable) après échec du findOneAndUpdate.
  const restoreFindById = stubUserFindById([{ boostUntil: null, currentLocation: 'oldLoc' }, currentDoc]);
  const restoreLocation = stubLocationFindById({ location: { coordinates: [PARIS.lon, PARIS.lat] } });
  const { restore: restoreUpdate } = stubFindOneAndUpdate(null); // simule la course perdue
  try {
    const result = await forceCheckIn('user1', { locationId: 'loc1', lat: PARIS.lat, lon: PARIS.lon });
    assert.equal(result, currentDoc);
  } finally {
    restoreFindById.restore();
    restoreLocation();
    restoreUpdate();
  }
});

test('forceCheckOut: happy path nulls currentLocation/currentLocationSince/pendingLocation', async () => {
  const restoreFindById = stubUserFindById([{ boostUntil: null, currentLocation: 'loc1' }]);
  const { calls, restore: restoreUpdate } = stubFindOneAndUpdate({
    _id: 'user1',
    currentLocation: null,
    currentLocationSince: null,
  });
  const restoreRedis = stubRedisCache();
  try {
    const result = await forceCheckOut('user1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].update.$set.currentLocation, null);
    assert.equal(calls[0].update.$set.currentLocationSince, null);
    assert.equal(calls[0].update.$set.pendingLocation, null);
    assert.equal(result.currentLocation, null);
  } finally {
    restoreFindById.restore();
    restoreUpdate();
    restoreRedis();
  }
});

test('forceCheckOut: throws BOOST_ACTIVE when a boost is currently running', async () => {
  const restoreFindById = stubUserFindById([{ boostUntil: new Date(Date.now() + 60_000), currentLocation: 'loc0' }]);
  try {
    await assert.rejects(
      () => forceCheckOut('user1'),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'BOOST_ACTIVE');
        return true;
      },
    );
  } finally {
    restoreFindById.restore();
  }
});

test('forceCheckOut: ordering guard — a newer request already won, falls back to the current state', async () => {
  const currentDoc = { _id: 'user1', currentLocation: 'stillHereLoc' };
  const restoreFindById = stubUserFindById([{ boostUntil: null, currentLocation: 'loc1' }, currentDoc]);
  const { restore: restoreUpdate } = stubFindOneAndUpdate(null);
  try {
    const result = await forceCheckOut('user1');
    assert.equal(result, currentDoc);
  } finally {
    restoreFindById.restore();
    restoreUpdate();
  }
});

test('expireStalePresence: returns {count, userIds} and clears currentLocation for stale users', async () => {
  const staleUsers = [
    { _id: 'u1', currentLocation: 'loc1' },
    { _id: 'u2', currentLocation: 'loc2' },
  ];
  const restoreFind = stubUserFindSelect(staleUsers);
  const { calls, restore: restoreUpdateMany } = stubUpdateMany();
  const restoreRedis = stubRedisCache();
  try {
    const result = await expireStalePresence();
    assert.deepEqual(result, { count: 2, userIds: ['u1', 'u2'] });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].filter._id.$in, ['u1', 'u2']);
    assert.equal(calls[0].update.$set.currentLocation, null);
    assert.equal(calls[0].update.$set.pendingLocation, null);
  } finally {
    restoreFind();
    restoreUpdateMany();
    restoreRedis();
  }
});

test('expireStalePresence: no-op returns {count: 0, userIds: []} without writing', async () => {
  const restoreFind = stubUserFindSelect([]);
  const { calls, restore: restoreUpdateMany } = stubUpdateMany();
  try {
    const result = await expireStalePresence();
    assert.deepEqual(result, { count: 0, userIds: [] });
    assert.equal(calls.length, 0);
  } finally {
    restoreFind();
    restoreUpdateMany();
  }
});
