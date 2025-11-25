import { FcmToken } from '../models/FcmToken.js';

export const PushController = {
  registerToken: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { token, platform } = req.body || {};
      if (!token) return res.status(400).json({ code: 'TOKEN_REQUIRED', message: 'token requis' });
      await FcmToken.updateOne(
        { user: userId, token },
        { $set: { user: userId, token, platform: platform || 'unknown', lastSeenAt: new Date() } },
        { upsert: true }
      );
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
