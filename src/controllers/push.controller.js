import { FcmToken } from '../models/FcmToken.js';
import { User } from '../models/User.js';

export const PushController = {
  registerToken: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { token, platform } = req.body || {};
      if (!token) return res.status(400).json({ code: 'TOKEN_REQUIRED', message: 'token requis' });

      // Save to dedicated FcmToken collection (multi-device support)
      await FcmToken.updateOne(
        { user: userId, token },
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
};
