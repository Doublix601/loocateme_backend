import { SponsorshipSlot } from '../models/SponsorshipSlot.js';
import { broadcastUltraBoost } from '../services/ultraBoost.service.js';

const PRO_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;

export const BusinessBoostController = {
  getBoosts: async (req, res, next) => {
    try {
      const location = req.location;
      return res.json({
        ultraBoostBalance: location.proOffers?.ultraBoostBalance || 0,
        proBoostBalance: location.proOffers?.proBoostBalance || 0,
        sponsorship: location.sponsorship || { active: false, until: null },
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
      location.proOffers.ultraBoostBalance -= 1;
      await location.save();
      return res.json({ success: true, recipients, ultraBoostBalance: location.proOffers.ultraBoostBalance });
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
};
