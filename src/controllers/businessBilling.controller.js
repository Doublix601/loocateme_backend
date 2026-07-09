import { Location } from '../models/Location.js';
import { User } from '../models/User.js';
import { stripe, priceIdForTier, tierForPriceId } from '../services/stripe.service.js';

const VALID_TIERS = ['pro1', 'pro2', 'pro3'];

async function loadOwnedLocation(req, locationId) {
  const location = await Location.findById(locationId);
  if (!location) throw Object.assign(new Error('Lieu introuvable'), { status: 404, code: 'LOCATION_NOT_FOUND' });
  if (String(location.ownerId) !== String(req.user.id)) {
    throw Object.assign(new Error('Vous ne gérez pas ce lieu'), { status: 403, code: 'FORBIDDEN' });
  }
  return location;
}

async function ensureStripeCustomer(location) {
  if (location.subscription?.stripeCustomerId) return location.subscription.stripeCustomerId;
  const user = await User.findById(location.ownerId).select('email').lean();
  const customer = await stripe.customers.create({
    email: user?.email,
    metadata: { locationId: String(location._id) },
  });
  location.subscription = location.subscription || {};
  location.subscription.stripeCustomerId = customer.id;
  await location.save();
  return customer.id;
}

export const BusinessBillingController = {
  checkoutSession: async (req, res, next) => {
    try {
      const { locationId, tier } = req.body || {};
      if (!VALID_TIERS.includes(tier)) {
        return res.status(400).json({ code: 'INVALID_TIER', message: 'Palier invalide' });
      }
      const location = await loadOwnedLocation(req, locationId);
      const customerId = await ensureStripeCustomer(location);
      const priceId = priceIdForTier(tier);
      const siteUrl = process.env.BUSINESS_SITE_PUBLIC_URL || 'http://localhost:3000';

      // Si un abonnement actif existe déjà (changement de palier), on le met à
      // jour avec proration au lieu de créer un doublon.
      const existingSubId = location.subscription?.stripeSubscriptionId;
      if (existingSubId && location.subscription?.status && ['active', 'trialing'].includes(location.subscription.status)) {
        const subscription = await stripe.subscriptions.retrieve(existingSubId);
        const itemId = subscription.items.data[0]?.id;
        await stripe.subscriptions.update(existingSubId, {
          items: [{ id: itemId, price: priceId }],
          proration_behavior: 'create_prorations',
          metadata: { locationId: String(location._id), tier },
        });
        location.businessTier = tier;
        location.subscription.stripePriceId = priceId;
        await location.save();
        return res.json({ url: `${siteUrl}/dashboard/billing?updated=1` });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${siteUrl}/dashboard?checkout=success`,
        cancel_url: `${siteUrl}/paywall?checkout=cancelled`,
        metadata: { locationId: String(location._id), tier },
        subscription_data: { metadata: { locationId: String(location._id), tier } },
      });
      return res.json({ url: session.url });
    } catch (err) {
      next(err);
    }
  },

  portalSession: async (req, res, next) => {
    try {
      const { locationId } = req.body || {};
      const location = await loadOwnedLocation(req, locationId);
      const customerId = await ensureStripeCustomer(location);
      const siteUrl = process.env.BUSINESS_SITE_PUBLIC_URL || 'http://localhost:3000';
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${siteUrl}/dashboard/billing`,
      });
      return res.json({ url: session.url });
    } catch (err) {
      next(err);
    }
  },

  // Repasse immédiatement le lieu en compte gratuit : annule l'abonnement Stripe
  // sans attendre la fin de la période en cours plutôt que de le programmer pour
  // plus tard, pour rester cohérent avec le changement de palier immédiat de
  // checkoutSession ci-dessus.
  cancelSubscription: async (req, res, next) => {
    try {
      const { locationId } = req.body || {};
      const location = await loadOwnedLocation(req, locationId);
      const subId = location.subscription?.stripeSubscriptionId;
      if (subId) {
        try {
          await stripe.subscriptions.cancel(subId);
        } catch (err) {
          if (err?.code !== 'resource_missing') throw err;
        }
      }
      location.businessTier = 'none';
      if (location.subscription) location.subscription.status = 'canceled';
      await location.save();
      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },

  // Route publique (signature Stripe vérifiée), body brut (express.raw), montée
  // avant express.json() dans server.js.
  stripeWebhook: async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[stripe] Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const { locationId, tier } = session.metadata || {};
          if (locationId && tier) {
            await Location.findByIdAndUpdate(locationId, {
              businessTier: tier,
              'subscription.stripeSubscriptionId': session.subscription,
              'subscription.status': 'active',
            });
          }
          break;
        }
        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const location = await Location.findOne({ 'subscription.stripeSubscriptionId': subscription.id });
          if (location) {
            const priceId = subscription.items.data[0]?.price?.id;
            const tier = tierForPriceId(priceId);
            location.subscription.status = subscription.status;
            location.subscription.currentPeriodEnd = subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : undefined;
            if (tier) {
              location.subscription.stripePriceId = priceId;
              location.businessTier = ['active', 'trialing'].includes(subscription.status) ? tier : 'none';
            }
            await location.save();
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          await Location.findOneAndUpdate(
            { 'subscription.stripeSubscriptionId': subscription.id },
            { businessTier: 'none', 'subscription.status': 'canceled' }
          );
          break;
        }
        case 'invoice.paid': {
          const invoice = event.data.object;
          if (invoice.subscription) {
            const location = await Location.findOne({ 'subscription.stripeSubscriptionId': invoice.subscription });
            if (location && location.businessTier === 'pro3') {
              // Idempotent par période de facturation Stripe plutôt que par billing_reason :
              // un abonnement initial, une facture de proration (changement de palier en
              // cours de mois) ou un renouvellement doivent tous pouvoir déclencher le
              // crédit s'ils font entrer/rester le lieu en Pro3 — mais une seule fois par
              // période, même si plusieurs factures tombent dans la même période (ex :
              // upgrade Pro1→Pro3 puis renouvellement le même mois).
              const periodEnd = invoice.lines?.data?.[0]?.period?.end || null;
              const alreadyGranted = periodEnd && location.proOffers?.lastGrantedPeriodEnd === periodEnd;
              if (!alreadyGranted) {
                location.proOffers = location.proOffers || { ultraBoostBalance: 0, proBoostBalance: 0 };
                location.proOffers.ultraBoostBalance = (location.proOffers.ultraBoostBalance || 0) + 1;
                location.proOffers.proBoostBalance = (location.proOffers.proBoostBalance || 0) + 1;
                if (periodEnd) location.proOffers.lastGrantedPeriodEnd = periodEnd;
                await location.save();
              }
            }
          }
          break;
        }
        default:
          break;
      }
      return res.json({ received: true });
    } catch (err) {
      console.error('[stripe] Webhook handling error:', err);
      return res.status(500).json({ received: false });
    }
  },
};
