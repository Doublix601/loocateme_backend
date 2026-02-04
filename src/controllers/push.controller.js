import { FcmToken } from '../models/FcmToken.js';
import { User } from '../models/User.js';

export const PushController = {
  registerToken: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { token, platform } = req.body || {};
      if (!token) return res.status(400).json({ code: 'TOKEN_REQUIRED', message: 'token requis' });

      // If token already exists for another user, detach it from their profile
      try {
        const existing = await FcmToken.findOne({ token }).select('user').lean();
        if (existing?.user && String(existing.user) !== String(userId)) {
          await User.updateMany({ _id: existing.user, expoPushToken: token }, { $unset: { expoPushToken: '' } });
        }
      } catch (_) {}

      // Save to dedicated FcmToken collection (multi-device support)
      await FcmToken.findOneAndUpdate(
        { token },
        { $set: { user: userId, token, platform: platform || 'unknown', lastSeenAt: new Date() } },
        { upsert: true }
      );

      // Also save to User model for quick access/reference if it's an Expo token
      if (userId && typeof token === 'string' && (token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken'))) {
        await User.findByIdAndUpdate(userId, { expoPushToken: token });
      }

      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
  unregisterToken: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { token } = req.body || {};
      if (!token) return res.status(400).json({ code: 'TOKEN_REQUIRED', message: 'token requis' });

      await FcmToken.deleteOne({ user: userId, token });
      await User.updateMany({ _id: userId, expoPushToken: token }, { $unset: { expoPushToken: '' } });

      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
