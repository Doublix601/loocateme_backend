import { User } from '../models/User.js';

export const PremiumController = {
  startTrial: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const me = await User.findById(userId);
      if (!me) return res.status(404).json({ code: 'USER_NOT_FOUND' });
      const now = new Date();
      // If already premium or trial active, don't recreate
      if (me.isPremium || (me.premiumTrialEnd && me.premiumTrialEnd > now)) {
        return res.json({ success: true, trialActive: true, premium: !!me.isPremium, premiumTrialEnd: me.premiumTrialEnd });
      }
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      me.premiumTrialStart = now;
      me.premiumTrialEnd = end;
      // Grant premium during trial and mark plan change for UI reload
      const before = !!me.isPremium;
      me.isPremium = true;
      if (before !== true) {
        me.planChangedAt = now;
      }
      await me.save();
      return res.json({ success: true, trialActive: true, premium: !!me.isPremium, premiumTrialEnd: end });
    } catch (err) {
      next(err);
    }
  },
  activateBoost: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const me = await User.findById(userId);
      if (!me) return res.status(404).json({ code: 'USER_NOT_FOUND' });

      const now = new Date();
      // Check if already boosted
      if (me.boostUntil && me.boostUntil > now) {
        return res.status(400).json({ code: 'ALREADY_BOOSTED', message: 'Boost déjà actif' });
      }

      // Special handling for Mock/Test purchases in DEV
      const isMock = req.body.isMock === true;

      // Check balance (skip check if it's a mock purchase in dev)
      if (!isMock && (me.boostBalance || 0) <= 0) {
        return res.status(403).json({ code: 'NO_BOOSTS', message: 'Aucun boost disponible' });
      }

      // Use one boost (if not mock)
      if (!isMock) {
        me.boostBalance -= 1;
      } else {
        console.log(`[PremiumController] Mock boost activation for user ${me.username}`);
      }

      me.boostUntil = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes boost

      await me.save();
      return res.json({ success: true, boostUntil: me.boostUntil, boostBalance: me.boostBalance });
    } catch (err) {
      next(err);
    }
  },
};
