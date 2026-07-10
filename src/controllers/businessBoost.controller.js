import { SponsorshipSlot } from '../models/SponsorshipSlot.js';
import { broadcastUltraBoost } from '../services/ultraBoost.service.js';
import { stripe } from '../services/stripe.service.js';
import { ensureStripeCustomer } from './businessBilling.controller.js';

const PRO_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;
const ULTRA_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;

// Achat à l'unité (hors abonnement Pro3) : prix fixes en centimes, pas besoin
// de Price Stripe pré-créée puisque le montant ne varie jamais.
const BOOST_PRICE_CENTS = { pro: 5000, ultra: 10000 };
const BOOST_LABELS = { pro: 'Pro Boost', ultra: 'Ultra Boost' };

export const BusinessBoostController = {
  getBoosts: async (req, res, next) => {
    try {
      const location = req.location;
      return res.json({
        ultraBoostBalance: location.proOffers?.ultraBoostBalance || 0,
        proBoostBalance: location.proOffers?.proBoostBalance || 0,
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
      const { recipients } = await broadcastUltraBoost(location);
      const now = new Date();
      location.proOffers.ultraBoostBalance -= 1;
      location.ultraBoost = { active: true, until: new Date(now.getTime() + ULTRA_BOOST_DURATION_MS), activatedAt: now, claimedBy: [] };
      await location.save();
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
      const until = new Date(now.getTime() + PRO_BOOST_DURATION_MS);

      // S'assure que le document singleton existe (no-op s'il existe déjà),
      // puis effectue le compare-and-swap atomique sans ambiguïté d'upsert.
      await SponsorshipSlot.updateOne(
        { _id: 'GLOBAL' },
        { $setOnInsert: { activeLocationId: null, until: null } },
        { upsert: true }
      );
      const slot = await SponsorshipSlot.findOneAndUpdate(
        { _id: 'GLOBAL', $or: [{ activeLocationId: null }, { until: null }, { until: { $lte: now } }] },
        { activeLocationId: location._id, until },
        { new: true }
      );

      if (!slot || String(slot.activeLocationId) !== String(location._id)) {
        return res.status(409).json({
          code: 'SPONSORSHIP_SLOT_TAKEN',
          message: 'Un autre lieu est déjà sponsorisé actuellement, réessayez plus tard.',
        });
      }

      location.proOffers.proBoostBalance -= 1;
      location.sponsorship = { active: true, until, activatedAt: now };
      await location.save();

      return res.json({ success: true, sponsorship: location.sponsorship, proBoostBalance: location.proOffers.proBoostBalance });
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
