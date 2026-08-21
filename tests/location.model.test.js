import test from 'node:test';
import assert from 'node:assert/strict';
import { Location } from '../src/models/Location.js';

test('Location schema: notificationPreferences.weeklyDigestEmail defaults to true', () => {
  const doc = new Location({ name: 'Test Bar', ownerId: '000000000000000000000000' });
  assert.equal(doc.notificationPreferences.weeklyDigestEmail, true);
});

test('Location schema: notificationPreferences.weeklyDigestEmail can be set to false', () => {
  const doc = new Location({
    name: 'Test Bar',
    ownerId: '000000000000000000000000',
    notificationPreferences: { weeklyDigestEmail: false },
  });
  assert.equal(doc.notificationPreferences.weeklyDigestEmail, false);
});
