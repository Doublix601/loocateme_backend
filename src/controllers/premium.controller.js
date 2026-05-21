import { User } from '../models/User.js';
import { sendPushUnified } from '../services/push.service.js';

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
  verifyPurchase: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const me = await User.findById(userId);
      if (!me) return res.status(404).json({ code: 'USER_NOT_FOUND' });

      // Special handling for Mock/Test purchases in DEV
      const isMock = req.body.isMock === true;
      if (isMock && process.env.NODE_ENV !== 'production') {
        console.log(`[PremiumController] Mock premium activation for user ${me.username}`);
        me.isPremium = true;
        me.planChangedAt = new Date();
        await me.save();
        return res.json({ success: true, premium: true });
      }

      // Normally, purchase verification is handled via Webhooks from RevenueCat.
      // Here we just refresh the local user state to be sure.
      return res.json({ success: true, premium: !!me.isPremium });
    } catch (err) {
      next(err);
    }
  },
  sendSuperlike: async (req, res, next) => {
    try {
      const senderId = req.user?.id;
      const { targetUserId } = req.body;

      if (!targetUserId) return res.status(400).json({ code: 'MISSING_TARGET' });
      if (String(senderId) === String(targetUserId)) {
        return res.status(400).json({ code: 'SELF_SUPERLIKE' });
      }

      const sender = await User.findById(senderId);
      if (!sender) return res.status(404).json({ code: 'USER_NOT_FOUND' });

      const isMock = req.body.isMock === true && process.env.NODE_ENV !== 'production';

      if (!isMock && (sender.superlikeBalance || 0) <= 0) {
        return res.status(403).json({ code: 'NO_SUPERLIKES', message: 'Aucun superlike disponible' });
      }

      if (!isMock) {
        sender.superlikeBalance = Math.max(0, (sender.superlikeBalance || 0) - 1);
        await sender.save();
      }

      // Push notification to target
      try {
        const senderName = sender.customName || sender.username || 'Quelqu\'un';
        await sendPushUnified({
          userIds: [String(targetUserId)],
          title: '⭐ Superlike reçu !',
          body: `${senderName} te remarque dans cet endroit.`,
          data: { kind: 'superlike', senderId: String(senderId) },
        });
      } catch (_) {}

      return res.json({ success: true, superlikeBalance: sender.superlikeBalance });
    } catch (err) {
      next(err);
    }
  },

  getWeeklyAllowance: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const me = await User.findById(userId);
      if (!me) return res.status(404).json({ code: 'USER_NOT_FOUND' });

      if (!me.isPremium) {
        return res.json({ granted: false, superlikeBalance: me.superlikeBalance || 0 });
      }

      const now = new Date();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const needsReset = !me.lastAllowanceAt || (now.getTime() - new Date(me.lastAllowanceAt).getTime()) >= oneWeekMs;

      if (needsReset) {
        me.superlikeBalance = 3;
        me.lastAllowanceAt = now;
        await me.save();
        return res.json({ granted: true, superlikeBalance: me.superlikeBalance });
      }

      return res.json({ granted: false, superlikeBalance: me.superlikeBalance });
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

      // NEW: Boost Gating - Check if user is physically present at a POI
      if (!me.currentLocation) {
        return res.status(403).json({
          code: 'NOT_AT_POI',
          message: 'Vous devez être présent dans un établissement pour activer un boost.'
        });
      }

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
