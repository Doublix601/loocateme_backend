import test from 'node:test';
import assert from 'node:assert/strict';
import { BusinessProfileController } from '../src/controllers/businessProfile.controller.js';

function makeLocation(overrides = {}) {
  return {
    notificationPreferences: { weeklyDigestEmail: true },
    saveCalls: 0,
    save() { this.saveCalls += 1; return Promise.resolve(this); },
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const throwOnNext = (err) => { throw err; };

test('updateNotificationPreferences: disables the weekly digest and persists it', async () => {
  const location = makeLocation();
  const req = { location, body: { weeklyDigestEmail: false } };
  const res = makeRes();
  await BusinessProfileController.updateNotificationPreferences(req, res, throwOnNext);
  assert.equal(location.notificationPreferences.weeklyDigestEmail, false);
  assert.equal(location.saveCalls, 1);
  assert.equal(res.body.location.notificationPreferences.weeklyDigestEmail, false);
});

test('updateNotificationPreferences: re-enables the weekly digest', async () => {
  const location = makeLocation({ notificationPreferences: { weeklyDigestEmail: false } });
  const req = { location, body: { weeklyDigestEmail: true } };
  const res = makeRes();
  await BusinessProfileController.updateNotificationPreferences(req, res, throwOnNext);
  assert.equal(location.notificationPreferences.weeklyDigestEmail, true);
});

test('updateNotificationPreferences: rejects a non-boolean value without saving', async () => {
  const location = makeLocation();
  const req = { location, body: { weeklyDigestEmail: 'yes' } };
  const res = makeRes();
  await BusinessProfileController.updateNotificationPreferences(req, res, throwOnNext);
  assert.equal(res.statusCode, 400);
  assert.equal(location.saveCalls, 0);
});
