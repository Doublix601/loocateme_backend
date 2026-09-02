import { PREMIUM_MONTHLY_BOOSTS } from '../constants/premium.js';

// Point de vérité unique de l'entitlement Premium.
//
// `isPremium` (booléen) est la seule source : l'essai maison le met à true
// (premium.controller.js startTrial), les webhooks RevenueCat le mettent à
// jour, et un cron expire l'essai (cron.service.js). On ne se base donc PLUS
// sur `premiumTrialEnd > now` en fallback : ce champ n'était jamais remis à
// null en perdant Premium → un compte redevenu Free gardait les avantages.
export function hasActivePremium(user) {
  return !!user?.isPremium;
}

// Recharge le plancher mensuel de boosts Premium : remonte la part premium du
// solde à PREMIUM_MONTHLY_BOOSTS, sans jamais cumuler au-delà.
//   - avait 5 boosts achetés (premiumBoostBalance 0)  → +3 → 8 (premiumBoostBalance 3)
//   - avait 2 achetés + 3 premium non dépensés         → +0 → 5 (plancher déjà atteint)
//   - avait 2 premium restants (1 dépensé)             → +1 → plancher reconstitué
// Mutation en place, sans save. Retourne le nombre de boosts crédités.
export function grantPremiumBoostFloor(user, now = new Date()) {
  const held = user.premiumBoostBalance || 0;
  const grant = Math.max(0, PREMIUM_MONTHLY_BOOSTS - held);
  if (grant > 0) {
    user.boostBalance = (user.boostBalance || 0) + grant;
    user.premiumBoostBalance = held + grant;
  }
  user.lastBoostAllowanceAt = now;
  return grant;
}

// Décrémente le compteur de part premium quand un boost est dépensé (les boosts
// premium sont consommés en premier — ils se rechargent, contrairement aux packs
// achetés). À appeler APRÈS avoir décrémenté boostBalance.
export function consumePremiumBoostCounter(user) {
  user.premiumBoostBalance = Math.max(0, (user.premiumBoostBalance || 0) - 1);
}

// Applique l'état "Premium actif" (mutation en place, sans save). Utilisé par
// TOUS les chemins d'activation (essai maison, achat mock, webhook RevenueCat,
// admin) pour rester cohérent.
//
// Grant de bienvenue : le plancher de 3 boosts, une seule fois (premiumWelcome
// GrantedAt). Superlikes : rien à créditer, ils sont illimités en Premium.
export function activatePremium(user, { source = null } = {}) {
  if (!user) return;
  const now = new Date();

  const wasPremium = !!user.isPremium;
  user.isPremium = true;
  if (!wasPremium) user.planChangedAt = now;
  if (['paid', 'trial', 'referral_reward', 'promo'].includes(source)) {
    user.premiumSource = source;
  }

  if (!user.premiumWelcomeGrantedAt) {
    grantPremiumBoostFloor(user, now);
    user.premiumWelcomeGrantedAt = now;
  }
}

// Retire l'état Premium (mutation en place, sans save). Nettoie aussi les dates
// d'essai/expiration pour ne laisser aucun résidu exploitable (défense en
// profondeur). Ne touche pas aux soldes de boosts déjà crédités.
export function deactivatePremium(user) {
  if (!user) return;
  const wasPremium = !!user.isPremium;
  user.isPremium = false;
  if (wasPremium) user.planChangedAt = new Date();
  user.premiumTrialEnd = null;
  user.premiumExpiresAt = null;
}
