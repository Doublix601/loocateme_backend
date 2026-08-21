import { estimateUltraBoostRecipients, enqueueUltraBoostBroadcast } from '../services/ultraBoost.service.js';
import { estimateEventBoostRecipients, enqueueEventBoostBroadcast } from '../services/eventBoost.service.js';
import { stripe } from '../services/stripe.service.js';
import { ensureStripeCustomer } from './businessBilling.controller.js';
import { BOOST_PRICE_CENTS, BOOST_LABELS, BOOST_MIN_TIER_FOR_PURCHASE } from '../constants/boosts.js';
import { redisClient } from '../config/redis.js';

const PRO_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;
const ULTRA_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;

const TIER_RANK = { none: 0, pro1: 1, pro2: 2, pro3: 3 };

// Anti-spam : un lieu ne peut déclencher qu'UN SEUL boost géociblé (Ultra ou
// Event confondus) par heure, même s'il dispose de solde pour les deux. Sans
// cette limite, un pro peut activer un Ultra Boost puis un Event Boost
// quelques minutes après : filterBoostCooldown (boostNotify.service.js)
// dédupliquant déjà les push par utilisateur sur 4h, le second envoi se
// retrouve alors sans aucun destinataire (tous les riverains ont déjà reçu le
// premier boost) sans que le pro n'en soit informé. Verrou Redis (SET NX EX)
// plutôt qu'un champ Mongo : évite une race entre les deux routes
// d'activation et centralise le TTL sans étape de nettoyage.
const BOOST_ACTIVATION_COOLDOWN_SECONDS = 60 * 60;

async function checkAndSetBoostActivationCooldown(locationId) {
  const key = `boost_activation_cooldown:${locationId}`;
  try {
    const ok = await redisClient.set(key, '1', { NX: true, EX: BOOST_ACTIVATION_COOLDOWN_SECONDS });
    if (ok) return { allowed: true };
    const ttl = await redisClient.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : BOOST_ACTIVATION_COOLDOWN_SECONDS };
  } catch (e) {
    // Redis indisponible : on autorise plutôt que de bloquer toute activation de boost.
    console.warn('[businessBoost] Redis cooldown check failed, failing open:', e.message);
    return { allowed: true };
  }
}

export const BusinessBoostController = {
  getBoosts: async (req, res, next) => {
    try {
      const location = req.location;
      return res.json({
        ultraBoostBalance: location.proOffers?.ultraBoostBalance || 0,
        proBoostBalance: location.proOffers?.proBoostBalance || 0,
        eventBoostBalance: location.proOffers?.eventBoostBalance || 0,
        sponsorship: location.sponsorship || { active: false, until: null },
        ultraBoost: location.ultraBoost || { active: false, until: null },
      });
    } catch (err) {
      next(err);
    }
  },

  activateUltraBoost: async (req, res, next) => {
    try {
      const location = req.location;
      if ((location.proOffers?.ultraBoostBalance || 0) <= 0) {
        return res.status(403).json({ code: 'NO_ULTRA_BOOST', message: 'Aucun Ultra Boost disponible' });
      }
      const cooldown = await checkAndSetBoostActivationCooldown(location._id);
      if (!cooldown.allowed) {
        return res.status(429).json({
          code: 'BOOST_COOLDOWN',
          message: 'Un seul boost (Ultra ou Event) peut être activé par heure pour ce lieu. Réessayez plus tard.',
          retryAfterSeconds: cooldown.retryAfterSeconds,
        });
      }
      const recipients = await estimateUltraBoostRecipients(location);
      await enqueueUltraBoostBroadcast(location);
      const now = new Date();
      location.proOffers.ultraBoostBalance -= 1;
      location.ultraBoost = { active: true, until: new Date(now.getTime() + ULTRA_BOOST_DURATION_MS), activatedAt: now, claimedBy: [] };
      await location.save({ validateModifiedOnly: true });
      return res.json({
        success: true,
        recipients,
        ultraBoostBalance: location.proOffers.ultraBoostBalance,
        ultraBoost: location.ultraBoost,
      });
    } catch (err) {
      next(err);
    }
  },

  activateProBoost: async (req, res, next) => {
    try {
      const location = req.location;
      if ((location.proOffers?.proBoostBalance || 0) <= 0) {
        return res.status(403).json({ code: 'NO_PRO_BOOST', message: 'Aucun Pro Boost disponible' });
      }

      const now = new Date();
      if (location.sponsorship?.active && location.sponsorship.until > now) {
        return res.status(409).json({
          code: 'SPONSORSHIP_ALREADY_ACTIVE',
          message: 'Ce lieu est déjà sponsorisé actuellement.',
        });
      }
      const until = new Date(now.getTime() + PRO_BOOST_DURATION_MS);

      location.proOffers.proBoostBalance -= 1;
      location.sponsorship = { active: true, until, activatedAt: now };
      await location.save({ validateModifiedOnly: true });

      return res.json({ success: true, sponsorship: location.sponsorship, proBoostBalance: location.proOffers.proBoostBalance });
    } catch (err) {
      next(err);
    }
  },

  // Envoie une notification pour un événement déjà créé (cf.
  // businessProfile.controller.js#addEvent, accessible dès pro2). L'Event
  // Boost lui-même reste réservé pro3 et ne fait que déclencher l'envoi —
  // il ne crée ni ne modifie le contenu de l'événement.
  activateEventBoost: async (req, res, next) => {
    try {
      const location = req.location;
      if (location.businessTier !== 'pro3') {
        return res.status(403).json({ code: 'TIER_REQUIRED', message: 'Palier pro3 requis', requiredTier: 'pro3' });
      }
      if ((location.proOffers?.eventBoostBalance || 0) <= 0) {
        return res.status(403).json({ code: 'NO_EVENT_BOOST', message: 'Aucun Event Boost disponible' });
      }
      const event = location.events.id(req.params.eventId);
      if (!event) {
        return res.status(404).json({ code: 'EVENT_NOT_FOUND', message: 'Événement introuvable' });
      }

      const cooldown = await checkAndSetBoostActivationCooldown(location._id);
      if (!cooldown.allowed) {
        return res.status(429).json({
          code: 'BOOST_COOLDOWN',
          message: 'Un seul boost (Ultra ou Event) peut être activé par heure pour ce lieu. Réessayez plus tard.',
          retryAfterSeconds: cooldown.retryAfterSeconds,
        });
      }

      const recipients = await estimateEventBoostRecipients(location);
      await enqueueEventBoostBroadcast(location, event);

      event.boostedAt = new Date();
      location.proOffers.eventBoostBalance -= 1;
      await location.save({ validateModifiedOnly: true });
      return res.json({
        success: true,
        recipients,
        eventBoostBalance: location.proOffers.eventBoostBalance,
        event,
      });
    } catch (err) {
      next(err);
    }
  },

  purchaseCheckout: async (req, res, next) => {
    try {
      const location = req.location;
      const { boostType } = req.body || {};
      if (!BOOST_PRICE_CENTS[boostType]) {
        return res.status(400).json({ code: 'INVALID_BOOST_TYPE', message: 'Type de boost invalide' });
      }
      const minTier = BOOST_MIN_TIER_FOR_PURCHASE[boostType];
      if (minTier && TIER_RANK[location.businessTier] < TIER_RANK[minTier]) {
        return res.status(403).json({ code: 'TIER_REQUIRED', message: `Palier ${minTier} requis pour ce boost`, requiredTier: minTier });
      }

      const customerId = await ensureStripeCustomer(location);
      const siteUrl = process.env.BUSINESS_SITE_PUBLIC_URL || 'http://localhost:3000';

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: BOOST_PRICE_CENTS[boostType],
              product_data: { name: BOOST_LABELS[boostType] },
            },
            quantity: 1,
          },
        ],
        success_url: `${siteUrl}/dashboard?boost=success`,
        cancel_url: `${siteUrl}/dashboard?boost=cancelled`,
        metadata: { kind: 'boost_purchase', locationId: String(location._id), boostType },
      });

      return res.json({ url: session.url });
    } catch (err) {
      next(err);
    }
  },
};
