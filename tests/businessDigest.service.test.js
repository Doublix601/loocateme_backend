import test from 'node:test';
import assert from 'node:assert/strict';
import { Location } from '../src/models/Location.js';
import { User } from '../src/models/User.js';
import {
  buildDigestEmail,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  sendBusinessWeeklyDigest,
} from '../src/services/businessDigest.service.js';

// Set secret before any test runs so sign/verify work correctly
process.env.DIGEST_UNSUBSCRIBE_SECRET = 'test-secret-for-sdd-suite';

function statsWith({ current = 0, deltaPct = null, visitsByWeekday = [0, 0, 0, 0, 0, 0, 0] } = {}) {
  return { views: { '7d': { current, previous: 0, deltaPct } }, visitsByWeekday };
}

test('buildDigestEmail: normal case includes view count, trend and best weekday', () => {
  const location = { name: 'Le Central' };
  const stats = statsWith({ current: 42, deltaPct: 12.5, visitsByWeekday: [1, 2, 30, 4, 5, 6, 7] });
  const { subject, text } = buildDigestEmail({ location, stats, unsubscribeUrl: 'https://api.loocate.me/x' });
  assert.match(subject, /Le Central/);
  assert.match(text, /42 fois/);
  assert.match(text, /\+12\.5%/);
  assert.match(text, /mercredi/); // index 2 (0=lundi) has the max count (30)
  assert.match(text, /https:\/\/api\.loocate\.me\/x/);
});

test('buildDigestEmail: null deltaPct omits the trend percentage', () => {
  const stats = statsWith({ current: 10, deltaPct: null });
  const { text } = buildDigestEmail({ location: { name: 'X' }, stats, unsubscribeUrl: 'u' });
  assert.match(text, /10 fois/);
  assert.doesNotMatch(text, /%/);
});

test('buildDigestEmail: zero views uses the neutral no-traffic message', () => {
  const stats = statsWith({ current: 0 });
  const { text } = buildDigestEmail({ location: { name: 'X' }, stats, unsubscribeUrl: 'u' });
  assert.match(text, /Aucune vue/);
});

test('buildDigestEmail: all weekdays at zero omits the best-day line', () => {
  const stats = statsWith({ current: 5, visitsByWeekday: [0, 0, 0, 0, 0, 0, 0] });
  const { text } = buildDigestEmail({ location: { name: 'X' }, stats, unsubscribeUrl: 'u' });
  assert.doesNotMatch(text, /meilleur jour/);
});

test('signUnsubscribeToken / verifyUnsubscribeToken: valid round-trip returns the locationId', () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  assert.equal(verifyUnsubscribeToken(token), '64b000000000000000000001');
});

test('verifyUnsubscribeToken: rejects a tampered signature', () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  const lastChar = token.at(-1);
  const tampered = token.slice(0, -1) + (lastChar === '0' ? '1' : '0');
  assert.equal(verifyUnsubscribeToken(tampered), null);
});

test('verifyUnsubscribeToken: rejects malformed or missing tokens', () => {
  assert.equal(verifyUnsubscribeToken('not-a-valid-token'), null);
  assert.equal(verifyUnsubscribeToken(''), null);
  assert.equal(verifyUnsubscribeToken(undefined), null);
});

test('signUnsubscribeToken: throws when DIGEST_UNSUBSCRIBE_SECRET is empty', () => {
  const original = process.env.DIGEST_UNSUBSCRIBE_SECRET;
  try {
    delete process.env.DIGEST_UNSUBSCRIBE_SECRET;
    assert.throws(
      () => signUnsubscribeToken('64b000000000000000000001'),
      { message: /DIGEST_UNSUBSCRIBE_SECRET manquant/ }
    );
  } finally {
    process.env.DIGEST_UNSUBSCRIBE_SECRET = original;
  }
});

function stubLocationFind(locations) {
  const original = Location.find;
  let capturedFilter = null;
  Location.find = (filter) => {
    capturedFilter = filter;
    return { select: () => ({ lean: async () => locations }) };
  };
  return { getFilter: () => capturedFilter, restore: () => { Location.find = original; } };
}

function stubUserFindById(emailsById) {
  const original = User.findById;
  User.findById = (id) => ({
    select: () => ({ lean: async () => (emailsById[id] ? { email: emailsById[id] } : null) }),
  });
  return () => { User.findById = original; };
}

test('sendBusinessWeeklyDigest: queries only pro2/pro3 locations that have not opted out', async () => {
  const { getFilter, restore } = stubLocationFind([]);
  const restoreUser = stubUserFindById({});
  try {
    await sendBusinessWeeklyDigest();
    const filter = getFilter();
    assert.deepEqual(filter.businessTier, { $in: ['pro2', 'pro3'] });
    assert.deepEqual(filter['notificationPreferences.weeklyDigestEmail'], { $ne: false });
  } finally {
    restore();
    restoreUser();
  }
});

test('sendBusinessWeeklyDigest: sends one email per eligible location to its resolved owner email', async () => {
  const locations = [
    { _id: 'loc1', name: 'Le Central', ownerId: 'owner1' },
    { _id: 'loc2', name: 'Chez Momo', ownerId: 'owner2' },
  ];
  const { restore } = stubLocationFind(locations);
  const restoreUser = stubUserFindById({ owner1: 'pro1@example.com', owner2: 'pro2@example.com' });
  const sent = [];
  const sendMailFn = async (msg) => { sent.push(msg); };
  const getStatsFn = async () => statsWith({ current: 5, deltaPct: 25 });
  try {
    const count = await sendBusinessWeeklyDigest({ sendMailFn, getStatsFn });
    assert.equal(count, 2);
    assert.deepEqual(sent.map((m) => m.to), ['pro1@example.com', 'pro2@example.com']);
  } finally {
    restore();
    restoreUser();
  }
});

test('sendBusinessWeeklyDigest: skips a location whose owner has no resolvable email, without crashing', async () => {
  const locations = [{ _id: 'loc1', name: 'Le Central', ownerId: 'ghost' }];
  const { restore } = stubLocationFind(locations);
  const restoreUser = stubUserFindById({});
  const sent = [];
  const sendMailFn = async (msg) => { sent.push(msg); };
  const getStatsFn = async () => statsWith({ current: 1 });
  try {
    const count = await sendBusinessWeeklyDigest({ sendMailFn, getStatsFn });
    assert.equal(count, 0);
    assert.equal(sent.length, 0);
  } finally {
    restore();
    restoreUser();
  }
});

test('sendBusinessWeeklyDigest: a send failure on one location does not stop the others', async () => {
  const locations = [
    { _id: 'loc1', name: 'A', ownerId: 'owner1' },
    { _id: 'loc2', name: 'B', ownerId: 'owner2' },
  ];
  const { restore } = stubLocationFind(locations);
  const restoreUser = stubUserFindById({ owner1: 'a@example.com', owner2: 'b@example.com' });
  const sent = [];
  const sendMailFn = async (msg) => {
    if (msg.to === 'a@example.com') throw new Error('SMTP down');
    sent.push(msg);
  };
  const getStatsFn = async () => statsWith({ current: 1 });
  try {
    const count = await sendBusinessWeeklyDigest({ sendMailFn, getStatsFn });
    assert.equal(count, 1);
    assert.equal(sent[0].to, 'b@example.com');
  } finally {
    restore();
    restoreUser();
  }
});
