import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefreshCity } from '../src/services/geocoding.service.js';

// shouldRefreshCity is the pure throttling decision used by maybeRefreshCity
// (called fire-and-forget from user.service.js/updateLocation). Testing it in
// isolation avoids needing a DB/network stub for the full reverse-geocoding
// flow while still covering the actual throttling rule.

test('shouldRefreshCity: refreshes when user has no city yet', () => {
  const user = { city: '', cityUpdatedAt: null, lastGeocodedCoordinates: null };
  assert.equal(shouldRefreshCity(user, 48.8566, 2.3522), true);
});

test('shouldRefreshCity: does not refresh when city is fresh and coords barely moved', () => {
  const user = {
    city: 'Paris',
    cityUpdatedAt: new Date(), // just now
    lastGeocodedCoordinates: [2.3522, 48.8566],
  };
  // ~100m move
  assert.equal(shouldRefreshCity(user, 48.8575, 2.3522), false);
});

test('shouldRefreshCity: refreshes when coords moved more than ~2km', () => {
  const user = {
    city: 'Paris',
    cityUpdatedAt: new Date(),
    lastGeocodedCoordinates: [2.3522, 48.8566],
  };
  // ~5km north
  assert.equal(shouldRefreshCity(user, 48.9, 2.3522), true);
});

test('shouldRefreshCity: refreshes when last geocoded more than 7 days ago even without moving', () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const user = {
    city: 'Paris',
    cityUpdatedAt: eightDaysAgo,
    lastGeocodedCoordinates: [2.3522, 48.8566],
  };
  assert.equal(shouldRefreshCity(user, 48.8566, 2.3522), true);
});

test('shouldRefreshCity: does not refresh when fresh (< 7 days) and no coordinate history but recently geocoded', () => {
  const user = {
    city: 'Paris',
    cityUpdatedAt: new Date(),
    lastGeocodedCoordinates: null,
  };
  assert.equal(shouldRefreshCity(user, 48.8566, 2.3522), false);
});
