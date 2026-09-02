// Config Premium partagée entre les points d'entrée (activation, cron mensuel,
// endpoint /premium/allowance) pour que la mécanique reste cohérente partout.

// Premium = superlikes ILLIMITÉS (aucun décompte) + un plancher de boosts
// rechargé chaque mois.
//
// Plancher de boosts « premium » : chaque mois, la part premium du solde est
// remontée à 3. Elle ne se cumule pas au-delà de 3 — un boost premium non
// dépensé le mois M n'ajoute rien le mois M+1 (mais un solde plus élevé issu
// d'achats in-app n'est jamais raboté). But UX : inciter les premium à dépenser
// leurs boosts inclus, qui ne s'accumulent pas.
//
// `User.premiumBoostBalance` suit la part premium encore non dépensée (0→3) ;
// `User.boostBalance` reste le solde total (premium + packs achetés).
export const PREMIUM_MONTHLY_BOOSTS = 3;

// Fenêtre de recharge du plancher de boosts premium.
export const PREMIUM_BOOST_ALLOWANCE_MS = 30 * 24 * 60 * 60 * 1000;
