import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activatePremium,
  deactivatePremium,
  hasActivePremium,
  grantPremiumBoostFloor,
  consumePremiumBoostCounter,
} from '../src/services/premium.service.js';
import { PREMIUM_MONTHLY_BOOSTS } from '../src/constants/premium.js';

test('hasActivePremium: true only when isPremium is true', () => {
  assert.equal(hasActivePremium({ isPremium: true }), true);
  assert.equal(hasActivePremium({ isPremium: false }), false);
  // premiumTrialEnd futur ne suffit plus (c'était le bug du rayon Free)
  assert.equal(hasActivePremium({ isPremium: false, premiumTrialEnd: new Date(Date.now() + 1e9) }), false);
  assert.equal(hasActivePremium(null), false);
});

test('grantPremiumBoostFloor: +3 quand aucun boost premium détenu (ex: 5 achetés → 8)', () => {
  const u = { boostBalance: 5, premiumBoostBalance: 0 };
  const granted = grantPremiumBoostFloor(u);
  assert.equal(granted, PREMIUM_MONTHLY_BOOSTS);
  assert.equal(u.boostBalance, 8);
  assert.equal(u.premiumBoostBalance, 3);
  assert.ok(u.lastBoostAllowanceAt instanceof Date);
});

test('grantPremiumBoostFloor: +0 quand le plancher premium est déjà atteint (ex: 2 achetés + 3 premium → reste 5)', () => {
  const u = { boostBalance: 5, premiumBoostBalance: 3 };
  const granted = grantPremiumBoostFloor(u);
  assert.equal(granted, 0);
  assert.equal(u.boostBalance, 5);
  assert.equal(u.premiumBoostBalance, 3);
});

test('grantPremiumBoostFloor: reconstitue partiellement (2 premium restants → +1)', () => {
  const u = { boostBalance: 2, premiumBoostBalance: 2 };
  grantPremiumBoostFloor(u);
  assert.equal(u.boostBalance, 3);
  assert.equal(u.premiumBoostBalance, 3);
});

test('consumePremiumBoostCounter: décrémente la part premium sans passer sous 0', () => {
  const u = { premiumBoostBalance: 1 };
  consumePremiumBoostCounter(u);
  assert.equal(u.premiumBoostBalance, 0);
  consumePremiumBoostCounter(u);
  assert.equal(u.premiumBoostBalance, 0);
});

test('activatePremium: grant de bienvenue = plancher de boosts, une seule fois', () => {
  const u = { isPremium: false, boostBalance: 0, premiumBoostBalance: 0 };
  activatePremium(u, { source: 'trial' });
  assert.equal(u.isPremium, true);
  assert.equal(u.premiumSource, 'trial');
  assert.equal(u.boostBalance, PREMIUM_MONTHLY_BOOSTS);
  assert.equal(u.premiumBoostBalance, PREMIUM_MONTHLY_BOOSTS);
  assert.ok(u.premiumWelcomeGrantedAt instanceof Date);

  // Re-activation (renouvellement / re-abonnement) → pas de nouveau grant
  const before = u.boostBalance;
  activatePremium(u, { source: 'paid' });
  assert.equal(u.boostBalance, before);
});

test('activatePremium: ne crédite aucun superlike (illimités en Premium)', () => {
  const u = { isPremium: false, superlikeBalance: 0 };
  activatePremium(u, { source: 'paid' });
  assert.equal(u.superlikeBalance, 0);
});

test('deactivatePremium: clears entitlement and residual trial dates', () => {
  const u = {
    isPremium: true,
    boostBalance: 5,
    premiumBoostBalance: 3,
    premiumTrialEnd: new Date(Date.now() + 1e9),
    premiumExpiresAt: new Date(Date.now() + 1e9),
  };
  deactivatePremium(u);
  assert.equal(u.isPremium, false);
  assert.equal(u.premiumTrialEnd, null);
  assert.equal(u.premiumExpiresAt, null);
  assert.equal(u.boostBalance, 5); // soldes conservés
});
