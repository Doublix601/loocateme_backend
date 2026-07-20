import fs from 'fs';
import path from 'path';
import { SponsorshipSlot } from '../models/SponsorshipSlot.js';
import { broadcastUltraBoost } from '../services/ultraBoost.service.js';
import { broadcastEventBoost } from '../services/eventBoost.service.js';
import { stripe } from '../services/stripe.service.js';
import { ensureStripeCustomer } from './businessBilling.controller.js';
import { BOOST_PRICE_CENTS, BOOST_LABELS, BOOST_MIN_TIER_FOR_PURCHASE } from '../constants/boosts.js';
import { businessMediaPublicUrl } from '../services/storage.service.js';
import { processImage, processVideo, extractVideoThumbnail } from '../services/mediaProcessing.service.js';

const PRO_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;
const ULTRA_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;
const EVENT_DEFAULT_VISIBILITY_MS = 7 * 24 * 60 * 60 * 1000; // fallback si pas de eventDate
const EVENT_DATE_GRACE_MS = 24 * 60 * 60 * 1000; // eventDate + 1 jour

const TIER_RANK = { none: 0, pro1: 1, pro2: 2, pro3: 3 };

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

  activateEventBoost: async (req, res, next) => {
    try {
      const location = req.location;
      if (location.businessTier !== 'pro3') {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ code: 'TIER_REQUIRED', message: 'Palier pro3 requis', requiredTier: 'pro3' });
      }
      if ((location.proOffers?.eventBoostBalance || 0) <= 0) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ code: 'NO_EVENT_BOOST', message: 'Aucun Event Boost disponible' });
      }
      const { title, body, eventDate } = req.body || {};
      if (!title || !body) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ code: 'MISSING_FIELDS', message: 'Titre et message requis' });
      }

      let mediaUrl, mediaType, thumbnailUrl;
      if (req.file) {
        const isVideo = req.file.mimetype.startsWith('video/');
        if (isVideo) {
          mediaType = 'video';
          const finalFilename = await processVideo(req.file.path, { maxHeight: 1280 });
          const finalAbsPath = path.join(path.dirname(req.file.path), finalFilename);
          const thumbFilename = await extractVideoThumbnail(finalAbsPath);
          mediaUrl = businessMediaPublicUrl(req, finalFilename);
          thumbnailUrl = businessMediaPublicUrl(req, thumbFilename);
        } else {
          mediaType = 'image';
          const finalFilename = await processImage(req.file.path, { maxWidth: 1080, maxHeight: 1920 });
          mediaUrl = businessMediaPublicUrl(req, finalFilename);
        }
      }

      const { recipients } = await broadcastEventBoost(location, { title, body, eventDate });

      const now = new Date();
      const parsedEventDate = eventDate ? new Date(eventDate) : null;
      const expiresAt = parsedEventDate && !Number.isNaN(parsedEventDate.getTime())
        ? new Date(parsedEventDate.getTime() + EVENT_DATE_GRACE_MS)
        : new Date(now.getTime() + EVENT_DEFAULT_VISIBILITY_MS);

      location.activeEventBoost = {
        title,
        body,
        mediaUrl,
        mediaType,
        thumbnailUrl,
        eventDate: parsedEventDate,
        sentAt: now,
        expiresAt,
      };
      location.proOffers.eventBoostBalance -= 1;
      await location.save();
      return res.json({
        success: true,
        recipients,
        eventBoostBalance: location.proOffers.eventBoostBalance,
        activeEventBoost: location.activeEventBoost,
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
