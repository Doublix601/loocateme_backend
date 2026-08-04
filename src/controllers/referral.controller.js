import { getOrCreateReferralCode, getReferralProgress, getReferralHistory, redeemCode } from '../services/referral.service.js';

export const ReferralController = {
  me: async (req, res, next) => {
    try {
      await getOrCreateReferralCode(req.user.id);
      const progress = await getReferralProgress(req.user.id);
      return res.json(progress);
    } catch (err) {
      next(err);
    }
  },

  redeem: async (req, res, next) => {
    try {
      const { code } = req.body || {};
      const result = await redeemCode(req.user.id, code);
      return res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
      next(err);
    }
  },

  history: async (req, res, next) => {
    try {
      const { page, limit } = req.query;
      const history = await getReferralHistory(req.user.id, { page, limit });
      return res.json({ referrals: history });
    } catch (err) {
      next(err);
    }
  },
};
