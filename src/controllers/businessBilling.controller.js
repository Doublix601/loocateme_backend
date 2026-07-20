import bcrypt from 'bcryptjs';
import { Location } from '../models/Location.js';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { stripe, priceIdForTier, tierForPriceId } from '../services/stripe.service.js';
import { deleteOldMediaFile } from './businessProfile.controller.js';
import { BOOST_CAPS, BOOST_BALANCE_FIELD, BOOST_MIN_TIER_FOR_PURCHASE } from '../constants/boosts.js';

const VALID_TIERS = ['pro1', 'pro2', 'pro3'];
const TIER_RANK = { none: 0, pro1: 1, pro2: 2, pro3: 3 };

// Supprime les avantages premium liés à l'abonnement (photo de profil/couverture,
// stories, PDF) quand un pro annule/perd son abonnement (businessTier -> 'none').
// Ne touche volontairement PAS à proOffers/sponsorship/ultraBoost : les crédits de
// boost sont conservés et un boost en cours reste actif jusqu'à sa propre expiration
// (gérée séparément par cron.service.js), qu'il y ait ou non un abonnement actif.
function revokePremiumAdvantages(location) {
  deleteOldMediaFile(location.bannerUrl);
  deleteOldMediaFile(location.logoUrl);
  location.stories.forEach((story) => {
    deleteOldMediaFile(story.url);
    deleteOldMediaFile(story.thumbnailUrl);
  });
  location.media.forEach((item) => deleteOldMediaFile(item.url));
  location.bannerUrl = '';
  location.logoUrl = '';
  location.stories = [];
  location.media = [];
}

// Rembourse au prorata la portion non consommée de la période Stripe en cours,
// avant résiliation immédiate d'un abonnement (ex : suppression de compte pro).
// Retourne true si un remboursement a bien été émis. N'échoue jamais bruyamment :
// une erreur Stripe ne doit pas bloquer la suppression du compte, elle est
// seulement loggée.
async function refundUnusedSubscriptionPeriod(subId) {
  try {
    const subscription = await stripe.subscriptions.retrieve(subId);
    // Sur les versions récentes de l'API Stripe, current_period_start/end n'existe
    // plus sur la Subscription elle-même mais sur chaque SubscriptionItem.
    const item = subscription.items?.data?.[0];
    const start = item?.current_period_start;
    const end = item?.current_period_end;
    const now = Math.floor(Date.now() / 1000);
    if (!start || !end || now >= end) return false;
    if (!subscription.latest_invoice) return false;

    // De même, Invoice n'expose plus .charge ni .payment_intent : il faut passer
    // par la liste des paiements de la facture pour retrouver le PaymentIntent.
    const invoice = await stripe.invoices.retrieve(subscription.latest_invoice, {
      expand: ['payments'],
    });
    const paymentIntentId = invoice.payments?.data?.[0]?.payment?.payment_intent;
    const paidAmount = invoice.amount_paid;
    if (!paymentIntentId || !paidAmount) return false;

    const totalSeconds = end - start;
    const remainingSeconds = end - now;
    const refundAmount = Math.floor(paidAmount * (remainingSeconds / totalSeconds));
    if (refundAmount <= 0) return false;

    await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: refundAmount,
      reason: 'requested_by_customer',
    });
    return true;
  } catch (err) {
    console.error('[businessBilling] refundUnusedSubscriptionPeriod failed', subId, err?.message);
    return false;
  }
}

async function loadOwnedLocation(req, locationId) {
  const location = await Location.findById(locationId);
  if (!location) throw Object.assign(new Error('Lieu introuvable'), { status: 404, code: 'LOCATION_NOT_FOUND' });
  if (String(location.ownerId) !== String(req.user.id)) {
    throw Object.assign(new Error('Vous ne gérez pas ce lieu'), { status: 403, code: 'FORBIDDEN' });
  }
  return location;
}

export async function ensureStripeCustomer(location) {
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
          // Choisir un palier annule toute résiliation programmée (cf. cancelSubscription
          // ci-dessous) : le pro reste sur un abonnement actif classique.
          cancel_at_period_end: false,
          metadata: { locationId: String(location._id), tier },
        });
        location.businessTier = tier;
        location.subscription.stripePriceId = priceId;
        location.subscription.cancelAtPeriodEnd = false;
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

  // Résilie l'abonnement pour la fin de la période déjà payée plutôt que de
  // repasser le lieu en gratuit immédiatement : le pro a payé cette période,
  // il en garde le bénéfice (businessTier inchangé) jusqu'à currentPeriodEnd,
  // et l'abonnement ne se renouvelle simplement pas ensuite (webhook
  // customer.subscription.deleted / updated ci-dessous s'occupe du passage
  // en 'none' le moment venu).
  cancelSubscription: async (req, res, next) => {
    try {
      const { locationId } = req.body || {};
      const location = await loadOwnedLocation(req, locationId);
      const subId = location.subscription?.stripeSubscriptionId;
      if (!subId) {
        return res.status(400).json({ code: 'NO_SUBSCRIPTION', message: 'Aucun abonnement actif' });
      }
      try {
        await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
      } catch (err) {
        if (err?.code !== 'resource_missing') throw err;
      }
      location.subscription.cancelAtPeriodEnd = true;
      await location.save();
      return res.json({ ok: true, currentPeriodEnd: location.subscription.currentPeriodEnd || null });
    } catch (err) {
      next(err);
    }
  },

  // Annule une résiliation programmée avant la fin de la période en cours :
  // l'abonnement continue de se renouveler normalement.
  reactivateSubscription: async (req, res, next) => {
    try {
      const { locationId } = req.body || {};
      const location = await loadOwnedLocation(req, locationId);
      const subId = location.subscription?.stripeSubscriptionId;
      if (!subId || !location.subscription?.cancelAtPeriodEnd) {
        return res.status(400).json({ code: 'NO_PENDING_CANCELLATION', message: 'Aucune résiliation à annuler' });
      }
      await stripe.subscriptions.update(subId, { cancel_at_period_end: false });
      location.subscription.cancelAtPeriodEnd = false;
      await location.save();
      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },

  // Supprime le compte pro (accountType === 'business') et la fiche établissement
  // associée (photos, stories, PDF, statistiques) immédiatement, car la suppression
  // de compte est un effacement de données à la demande du pro : on ne peut pas
  // différer cet effacement jusqu'à la fin d'une période Stripe. En contrepartie,
  // la part non consommée de la période déjà payée est remboursée au prorata
  // (cf. refundUnusedSubscriptionPeriod ci-dessous) plutôt que conservée sans
  // contrepartie — un abonnement résilié immédiatement sans aucun remboursement
  // du temps non utilisé serait un enrichissement sans cause. N'a aucun effet
  // sur un éventuel compte personnel (mobile), qui est un User distinct
  // (accountType 'individual').
  deleteAccount: async (req, res, next) => {
    try {
      const { password } = req.body || {};
      const user = await User.findById(req.user.id).select('+password accountType');
      if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      if (user.accountType !== 'business') {
        return res.status(403).json({ code: 'NOT_BUSINESS_ACCOUNT', message: "Ce compte n'est pas un compte pro" });
      }
      const ok = await bcrypt.compare(String(password || ''), user.password);
      if (!ok) return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Mot de passe invalide' });

      const locations = await Location.find({ ownerId: user._id });
      let refunded = false;
      for (const location of locations) {
        const subId = location.subscription?.stripeSubscriptionId;
        if (subId) {
          try {
            if (await refundUnusedSubscriptionPeriod(subId)) refunded = true;
            await stripe.subscriptions.cancel(subId);
          } catch (err) {
            if (err?.code !== 'resource_missing') throw err;
          }
        }
        location.ownerId = undefined;
        location.isPro = false;
        location.businessTier = 'none';
        location.subscription = { status: 'canceled' };
        revokePremiumAdvantages(location);
        await location.save();
      }

      await RefreshToken.deleteMany({ user: user._id });
      await User.deleteOne({ _id: user._id });

      return res.json({ success: true, refunded });
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
          const { locationId, tier, kind, boostType } = session.metadata || {};
          if (kind === 'boost_purchase' && locationId && boostType) {
            const field = BOOST_BALANCE_FIELD[boostType] || 'proBoostBalance';
            const cap = BOOST_CAPS[boostType] ?? Infinity;
            const minTier = BOOST_MIN_TIER_FOR_PURCHASE[boostType];
            const location = await Location.findById(locationId);
            if (location && (!minTier || TIER_RANK[location.businessTier] >= TIER_RANK[minTier])) {
              const current = location.proOffers?.[field] || 0;
              location.proOffers[field] = Math.min(current + 1, cap);
              await location.save();
            }
          } else if (locationId && tier) {
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
            location.subscription.cancelAtPeriodEnd = !!subscription.cancel_at_period_end;
            if (tier) {
              location.subscription.stripePriceId = priceId;
              const wasSubscribed = location.businessTier !== 'none';
              location.businessTier = ['active', 'trialing'].includes(subscription.status) ? tier : 'none';
              if (wasSubscribed && location.businessTier === 'none') {
                revokePremiumAdvantages(location);
              }
            }
            await location.save();
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const location = await Location.findOne({ 'subscription.stripeSubscriptionId': subscription.id });
          if (location) {
            location.businessTier = 'none';
            location.subscription.status = 'canceled';
            location.subscription.cancelAtPeriodEnd = false;
            revokePremiumAdvantages(location);
            await location.save();
          }
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
                location.proOffers = location.proOffers || { ultraBoostBalance: 0, proBoostBalance: 0, eventBoostBalance: 0 };
                location.proOffers.ultraBoostBalance = Math.min((location.proOffers.ultraBoostBalance || 0) + 1, BOOST_CAPS.ultra);
                location.proOffers.proBoostBalance = Math.min((location.proOffers.proBoostBalance || 0) + 1, BOOST_CAPS.pro);
                location.proOffers.eventBoostBalance = Math.min((location.proOffers.eventBoostBalance || 0) + 1, BOOST_CAPS.event);
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
