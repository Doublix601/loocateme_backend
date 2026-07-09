import Stripe from 'stripe';

// Ne bloque pas le démarrage du serveur si la clé n'est pas encore configurée
// (comme pour SMTP/RevenueCat) ; les appels Stripe échoueront explicitement
// tant que STRIPE_SECRET_KEY n'est pas définie.
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[stripe] STRIPE_SECRET_KEY manquant : les endpoints de facturation pro échoueront.');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_not_configured');

export const TIER_PRICE_ENV = {
  pro1: 'STRIPE_PRICE_PRO1',
  pro2: 'STRIPE_PRICE_PRO2',
  pro3: 'STRIPE_PRICE_PRO3',
};

export function priceIdForTier(tier) {
  const envVar = TIER_PRICE_ENV[tier];
  const priceId = envVar && process.env[envVar];
  if (!priceId) {
    throw Object.assign(new Error(`Aucun price Stripe configuré pour le palier ${tier}`), { status: 500, code: 'STRIPE_PRICE_MISSING' });
  }
  return priceId;
}

export function tierForPriceId(priceId) {
  for (const [tier, envVar] of Object.entries(TIER_PRICE_ENV)) {
    if (process.env[envVar] === priceId) return tier;
  }
  return null;
}
