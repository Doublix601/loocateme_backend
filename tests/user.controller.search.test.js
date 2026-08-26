import test from 'node:test';
import assert from 'node:assert/strict';
import { Location } from '../src/models/Location.js';
import { UserController } from '../src/controllers/user.controller.js';

// UserController.search's location branch used to return raw Location docs
// (from Location.aggregate / Location.find().lean()) without ever passing
// them through sanitizePublicLocation — leaking Stripe subscription ids and
// pending-KYC document URLs to any authenticated searcher. These tests pin
// down that both code paths (with and without lat/lon) now scrub them.

function chainableQuery(result) {
  const q = {
    limit: () => q,
    lean: () => Promise.resolve(result),
  };
  return q;
}

function makeReqRes({ q = 'bar', lat, lon, includeUsers = 'false' } = {}) {
  const req = { query: { q, lat, lon, includeUsers }, user: { id: 'u1' } };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

const throwOnNext = (err) => { throw err; };

const RAW_LOCATION = {
  _id: 'loc1',
  name: 'Le Bar Bleu',
  city: 'Compiègne',
  businessTier: 'pro',
  subscription: { stripeCustomerId: 'cus_secret', stripeSubscriptionId: 'sub_secret' },
  documents: [{ type: 'kbis', url: 'https://storage.example.com/kbis-private.pdf' }],
};

test('search: locations found via $geoNear (lat/lon provided) are sanitized before being returned', async () => {
  const original = Location.aggregate;
  Location.aggregate = async () => [{ ...RAW_LOCATION }];
  try {
    const { req, res } = makeReqRes({ lat: '48.8566', lon: '2.3522' });
    await UserController.search(req, res, throwOnNext);
    assert.equal(res.body.locations.length, 1);
    const loc = res.body.locations[0];
    assert.equal(loc.name, 'Le Bar Bleu');
    assert.equal(loc.subscription, undefined);
    assert.equal(loc.documents, undefined);
  } finally {
    Location.aggregate = original;
  }
});

test('search: locations found via a plain name query (no lat/lon) are sanitized before being returned', async () => {
  const original = Location.find;
  Location.find = () => chainableQuery([{ ...RAW_LOCATION }]);
  try {
    const { req, res } = makeReqRes({});
    await UserController.search(req, res, throwOnNext);
    assert.equal(res.body.locations.length, 1);
    const loc = res.body.locations[0];
    assert.equal(loc.subscription, undefined);
    assert.equal(loc.documents, undefined);
  } finally {
    Location.find = original;
  }
});
