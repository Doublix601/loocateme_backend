import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { BleSighting } from '../src/models/BleSighting.js';
import { redisClient } from '../src/config/redis.js';
import { reportBleSightings } from '../src/services/ble.service.js';

// Written before batching reportBleSightings (currently one sequential
// redisClient.get + BleSighting.updateOne per sighting). Stubs both the
// per-item form (get/updateOne) and the batched form (mGet/bulkWrite) so
// the same assertions hold whichever the implementation uses — only the
// observable outcome (which peers got recorded) is checked.

function stubOptIn() {
  const original = User.findById;
  User.findById = () => ({ select: () => Promise.resolve({ privacyPreferences: { bluetoothProximity: true } }) });
  return () => { User.findById = original; };
}

function stubRedisTokens(map) {
  const originalGet = redisClient.get;
  const originalMGet = redisClient.mGet;
  redisClient.get = async (key) => (key in map ? map[key] : null);
  redisClient.mGet = async (keys) => keys.map((k) => (k in map ? map[k] : null));
  return () => {
    redisClient.get = originalGet;
    redisClient.mGet = originalMGet;
  };
}

function stubBleSightingWrites() {
  const upserts = [];
  const originalUpdateOne = BleSighting.updateOne;
  const originalBulkWrite = BleSighting.bulkWrite;
  BleSighting.updateOne = async (filter, update) => {
    upserts.push({ ...filter, ...update.$set });
    return { acknowledged: true };
  };
  BleSighting.bulkWrite = async (ops) => {
    for (const op of ops) {
      const { filter, update } = op.updateOne;
      upserts.push({ ...filter, ...update.$set });
    }
    return { ok: 1 };
  };
  return {
    upserts,
    restore: () => {
      BleSighting.updateOne = originalUpdateOne;
      BleSighting.bulkWrite = originalBulkWrite;
    },
  };
}

test('reportBleSightings records sightings for known, non-self peers with acceptable RSSI', async () => {
  const restoreOptIn = stubOptIn();
  const restoreRedis = stubRedisTokens({ 'ble:token:tok-a': 'peer-1', 'ble:token:tok-b': 'peer-2' });
  const writes = stubBleSightingWrites();
  try {
    const result = await reportBleSightings('me', [
      { token: 'tok-a', rssi: -60 },
      { token: 'tok-b', rssi: -70 },
    ]);
    assert.equal(result.recorded, 2);
    assert.equal(writes.upserts.length, 2);
    assert.deepEqual(writes.upserts.map((u) => u.peerUserId).sort(), ['peer-1', 'peer-2']);
    assert.ok(writes.upserts.every((u) => u.userId === 'me'));
  } finally {
    restoreOptIn();
    restoreRedis();
    writes.restore();
  }
});

test('reportBleSightings skips unknown tokens, self-sightings, and weak RSSI', async () => {
  const restoreOptIn = stubOptIn();
  const restoreRedis = stubRedisTokens({ 'ble:token:tok-self': 'me', 'ble:token:tok-known': 'peer-1' });
  const writes = stubBleSightingWrites();
  try {
    const result = await reportBleSightings('me', [
      { token: 'tok-unknown', rssi: -60 },
      { token: 'tok-self', rssi: -60 },
      { token: 'tok-known', rssi: -95 }, // below MIN_RSSI (-85)
    ]);
    assert.equal(result.recorded, 0);
    assert.equal(writes.upserts.length, 0);
  } finally {
    restoreOptIn();
    restoreRedis();
    writes.restore();
  }
});

test('reportBleSightings returns early without any lookup on empty input', async () => {
  const restoreOptIn = stubOptIn();
  try {
    const result = await reportBleSightings('me', []);
    assert.deepEqual(result, { recorded: 0 });
  } finally {
    restoreOptIn();
  }
});

test('reportBleSightings rejects users who have not opted in to Bluetooth proximity', async () => {
  const original = User.findById;
  User.findById = () => ({ select: () => Promise.resolve({ privacyPreferences: { bluetoothProximity: false } }) });
  try {
    await assert.rejects(
      reportBleSightings('me', [{ token: 'tok-a', rssi: -60 }]),
      (err) => err.code === 'BLE_OPT_IN_REQUIRED'
    );
  } finally {
    User.findById = original;
  }
});
