import test from 'node:test';
import assert from 'node:assert/strict';
import { activatePremium, deactivatePremium, hasActivePremium } from '../src/services/premium.service.js';
import { PREMIUM_WELCOME_BOOSTS, PREMIUM_WELCOME_SUPERLIKES } from '../src/constants/premium.js';

test('hasActivePremium: true only when isPremium is true', () => {
  assert.equal(hasActivePremium({ isPremium: true }), true);
  assert.equal(hasActivePremium({ isPremium: false }), false);
  // premiumTrialEnd dans le futur ne suffit plus (c'était le bug du rayon Free)
  assert.equal(
    hasActivePremium({ isPremium: false, premiumTrialEnd: new Date(Date.now() + 1e9) }),
    false,
  );
  assert.equal(hasActivePremium(null), false);
});

test('activatePremium: grants the welcome bundle on first activation', () => {
  const u = { isPremium: false, boostBalance: 0, superlikeBalance: 0 };
  activatePremium(u, { source: 'trial' });
  assert.equal(u.isPremium, true);
  assert.equal(u.premiumSource, 'trial');
  assert.equal(u.boostBalance, PREMIUM_WELCOME_BOOSTS);
  assert.equal(u.superlikeBalance, PREMIUM_WELCOME_SUPERLIKES);
  assert.ok(u.premiumWelcomeGrantedAt instanceof Date);
  assert.ok(u.planChangedAt instanceof Date);
});

test('activatePremium: idempotent — no second grant on renewal / re-subscribe', () => {
  const grantedAt = new Date(Date.now() - 1e6);
  const u = { isPremium: false, boostBalance: 1, superlikeBalance: 0, premiumWelcomeGrantedAt: grantedAt };
  activatePremium(u, { source: 'paid' });
  assert.equal(u.isPremium, true);
  assert.equal(u.boostBalance, 1); // inchangé
  assert.equal(u.superlikeBalance, 0);
  assert.equal(u.premiumWelcomeGrantedAt, grantedAt);
});

test('activatePremium: never lowers a balance above the welcome floor', () => {
  const u = { isPremium: false, boostBalance: 10, superlikeBalance: 7 };
  activatePremium(u, { source: 'paid' });
  assert.equal(u.boostBalance, 10);
  assert.equal(u.superlikeBalance, 7);
});

test('activatePremium: already premium → keeps planChangedAt untouched', () => {
  const u = { isPremium: true, boostBalance: 3, superlikeBalance: 3, premiumWelcomeGrantedAt: new Date() };
  activatePremium(u, { source: 'paid' });
  assert.equal(u.planChangedAt, undefined);
});

test('deactivatePremium: clears entitlement and residual trial dates', () => {
  const u = {
    isPremium: true,
    premiumTrialEnd: new Date(Date.now() + 1e9),
    premiumExpiresAt: new Date(Date.now() + 1e9),
  };
  deactivatePremium(u);
  assert.equal(u.isPremium, false);
  assert.equal(u.premiumTrialEnd, null);
  assert.equal(u.premiumExpiresAt, null);
  assert.ok(u.planChangedAt instanceof Date);
});
