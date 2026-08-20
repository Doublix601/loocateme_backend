import test from 'node:test';
import assert from 'node:assert/strict';
import { redisClient } from '../src/config/redis.js';
import { invalidateLocationDetailCache, invalidateLocationsListCache } from '../src/utils/locationCache.js';

// Behavioral tests (not tied to KEYS vs SCAN internals) written before
// switching invalidateLocationsListCache off the blocking `KEYS` command:
// they only assert on the observable effect (which keys get deleted), so
// they stay valid whether the implementation iterates via `keys()` or
// `scanIterator()`.

function stubKeyEnumeration(keys) {
  const originalKeys = redisClient.keys;
  const originalScanIterator = redisClient.scanIterator;
  redisClient.keys = async () => keys;
  redisClient.scanIterator = () => (async function* () {
    for (const k of keys) yield k;
  })();
  return () => {
    redisClient.keys = originalKeys;
    redisClient.scanIterator = originalScanIterator;
  };
}

function stubDel() {
  const calls = [];
  const original = redisClient.del;
  redisClient.del = async (keys) => {
    calls.push(keys);
    return Array.isArray(keys) ? keys.length : 1;
  };
  return { calls, restore: () => { redisClient.del = original; } };
}

test('invalidateLocationsListCache deletes every key matching the locations:v1 prefix', async () => {
  const restoreEnum = stubKeyEnumeration(['locations:v1:a', 'locations:v1:b']);
  const del = stubDel();
  try {
    await invalidateLocationsListCache();
    assert.equal(del.calls.length, 1);
    assert.deepEqual([...del.calls[0]].sort(), ['locations:v1:a', 'locations:v1:b']);
  } finally {
    restoreEnum();
    del.restore();
  }
});

test('invalidateLocationsListCache is a no-op when no keys match', async () => {
  const restoreEnum = stubKeyEnumeration([]);
  const del = stubDel();
  try {
    await invalidateLocationsListCache();
    assert.equal(del.calls.length, 0);
  } finally {
    restoreEnum();
    del.restore();
  }
});

test('invalidateLocationsListCache swallows Redis errors instead of throwing', async () => {
  const originalKeys = redisClient.keys;
  const originalScanIterator = redisClient.scanIterator;
  redisClient.keys = async () => { throw new Error('redis down'); };
  redisClient.scanIterator = () => { throw new Error('redis down'); };
  try {
    await assert.doesNotReject(invalidateLocationsListCache());
  } finally {
    redisClient.keys = originalKeys;
    redisClient.scanIterator = originalScanIterator;
  }
});

test('invalidateLocationDetailCache deletes the specific location key', async () => {
  const calls = [];
  const original = redisClient.del;
  redisClient.del = async (key) => { calls.push(key); return 1; };
  try {
    await invalidateLocationDetailCache('abc123');
    assert.deepEqual(calls, ['location:v1:abc123']);
  } finally {
    redisClient.del = original;
  }
});

test('invalidateLocationDetailCache is a no-op without an id', async () => {
  const calls = [];
  const original = redisClient.del;
  redisClient.del = async (key) => { calls.push(key); return 1; };
  try {
    await invalidateLocationDetailCache(null);
    assert.deepEqual(calls, []);
  } finally {
    redisClient.del = original;
  }
});
