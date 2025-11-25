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
      await me.save();
      return res.json({ success: true, trialActive: true, premium: !!me.isPremium, premiumTrialEnd: end });
    } catch (err) {
      next(err);
    }
  },
};
