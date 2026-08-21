import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Location } from '../src/models/Location.js';
import { BusinessDigestController } from '../src/controllers/businessDigest.controller.js';
import { signUnsubscribeToken } from '../src/services/businessDigest.service.js';

function makeRes() {
  return {
    redirectedTo: null,
    redirect(url) { this.redirectedTo = url; },
  };
}

function stubLocationUpdateOne(matchedCount) {
  const original = Location.updateOne;
  const calls = [];
  Location.updateOne = async (filter, update) => {
    calls.push({ filter, update });
    return { matchedCount };
  };
  return { calls, restore: () => { Location.updateOne = original; } };
}

test('unsubscribe: valid token disables the digest and redirects to the success page', async () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  const { calls, restore } = stubLocationUpdateOne(1);
  const req = { query: { token } };
  const res = makeRes();
  try {
    await BusinessDigestController.unsubscribe(req, res);
    assert.equal(calls[0].filter._id, '64b000000000000000000001');
    assert.equal(calls[0].update['notificationPreferences.weeklyDigestEmail'], false);
    assert.match(res.redirectedTo, /digest=unsubscribed/);
  } finally {
    restore();
  }
});

test('unsubscribe: missing token redirects to the error page without touching the DB', async () => {
  const { calls, restore } = stubLocationUpdateOne(1);
  const req = { query: {} };
  const res = makeRes();
  try {
    await BusinessDigestController.unsubscribe(req, res);
    assert.equal(calls.length, 0);
    assert.match(res.redirectedTo, /digest=error/);
  } finally {
    restore();
  }
});

test('unsubscribe: tampered token redirects to the error page without touching the DB', async () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  const lastChar = token.at(-1);
  const tampered = token.slice(0, -1) + (lastChar === '0' ? '1' : '0');
  const { calls, restore } = stubLocationUpdateOne(1);
  const req = { query: { token: tampered } };
  const res = makeRes();
  try {
    await BusinessDigestController.unsubscribe(req, res);
    assert.equal(calls.length, 0);
    assert.match(res.redirectedTo, /digest=error/);
  } finally {
    restore();
  }
});

test('unsubscribe: well-signed token for a location that no longer exists redirects to the error page', async () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  const { restore } = stubLocationUpdateOne(0);
  const req = { query: { token } };
  const res = makeRes();
  try {
    await BusinessDigestController.unsubscribe(req, res);
    assert.match(res.redirectedTo, /digest=error/);
  } finally {
    restore();
  }
});
