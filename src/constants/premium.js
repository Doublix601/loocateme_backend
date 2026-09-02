// Config Premium partagée entre les points d'entrée d'activation (essai maison
// via premium.controller.js, achat via le webhook RevenueCat iap.controller.js)
// pour que le grant de bienvenue reste cohérent quel que soit le chemin.

// Grant unique offert au tout premier passage Premium d'un compte (achat OU
// essai gratuit). Idempotent via User.premiumWelcomeGrantedAt : ni le
// renouvellement mensuel ni un re-abonnement ne re-créditent.
export const PREMIUM_WELCOME_BOOSTS = 3;
export const PREMIUM_WELCOME_SUPERLIKES = 3;

// Recharge hebdomadaire des superlikes pour les comptes Premium (cf.
// premium.controller.js getWeeklyAllowance). Le grant de bienvenue ci-dessus
// s'ajoute à ce plancher hebdo lors de la 1re semaine.
export const SUPERLIKE_WEEKLY_ALLOWANCE = 3;
