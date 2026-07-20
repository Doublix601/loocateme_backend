// Config partagée entre businessBoost.controller.js (achat/activation) et
// businessBilling.controller.js (recharge mensuelle via webhook Stripe), pour
// que les plafonds et libellés restent cohérents entre les deux points d'entrée.

// Plafonds de solde par type de boost. Un crédit gagné (recharge mensuelle ou
// achat à l'unité) au-delà du plafond est perdu — évite l'accumulation qui
// viderait le sens de la limitation anti-spam/anti-abus de chaque boost.
export const BOOST_CAPS = { ultra: 1, pro: 3, event: 1 };

// Achat à l'unité (hors abonnement Pro3) : prix fixes en centimes, pas besoin
// de Price Stripe pré-créée puisque le montant ne varie jamais.
export const BOOST_PRICE_CENTS = { pro: 5000, ultra: 10000, event: 10000 };
export const BOOST_LABELS = { pro: 'Pro Boost', ultra: 'Ultra Boost', event: 'Event Boost' };

// Type de boost -> champ Location.proOffers correspondant.
export const BOOST_BALANCE_FIELD = { pro: 'proBoostBalance', ultra: 'ultraBoostBalance', event: 'eventBoostBalance' };

// boostType réservés au palier pro3 pour l'achat à l'unité (au-delà des règles
// d'accès existantes de pro/ultra, qui restent inchangées).
export const BOOST_MIN_TIER_FOR_PURCHASE = { event: 'pro3' };
