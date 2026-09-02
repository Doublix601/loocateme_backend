import { PREMIUM_WELCOME_BOOSTS, PREMIUM_WELCOME_SUPERLIKES } from '../constants/premium.js';

// Point de vérité unique de l'entitlement Premium.
//
// `isPremium` (booléen) est la seule source : l'essai maison le met à true
// (premium.controller.js startTrial), les webhooks RevenueCat le mettent à
// jour, et un cron expire l'essai (cron.service.js). On ne se base donc PLUS
// sur `premiumTrialEnd > now` en fallback : ce champ n'était jamais remis à
// null en perdant Premium → un compte redevenu Free gardait les avantages
// (rayon de découverte 30 km, fenêtre "chemins croisés" 7 j, etc.).
export function hasActivePremium(user) {
  return !!user?.isPremium;
}

// Applique l'état "Premium actif" sur un document User (mutation en place, sans
// save — l'appelant enregistre). Utilisé par TOUS les chemins d'activation
// (essai maison, achat mock, webhook RevenueCat) pour que le grant de bienvenue
// soit garanti quel que soit le point d'entrée.
//
// Grant de bienvenue : 3 boosts + 3 superlikes offerts au tout premier passage
// Premium du compte. Idempotent via `premiumWelcomeGrantedAt` — ni le
// renouvellement mensuel ni un re-abonnement ultérieur ne re-créditent.
// `Math.max` : ne rabote jamais un solde déjà supérieur (packs achetés).
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
    user.boostBalance = Math.max(user.boostBalance || 0, PREMIUM_WELCOME_BOOSTS);
    user.superlikeBalance = Math.max(user.superlikeBalance || 0, PREMIUM_WELCOME_SUPERLIKES);
    user.premiumWelcomeGrantedAt = now;
  }
}

// Retire l'état Premium (mutation en place, sans save). Nettoie aussi les dates
// d'essai/expiration pour ne laisser aucun résidu exploitable par un ancien
// fallback (défense en profondeur).
export function deactivatePremium(user) {
  if (!user) return;
  const wasPremium = !!user.isPremium;
  user.isPremium = false;
  if (wasPremium) user.planChangedAt = new Date();
  user.premiumTrialEnd = null;
  user.premiumExpiresAt = null;
}
