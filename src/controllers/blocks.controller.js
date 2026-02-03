import { User } from '../models/User.js';

export const BlocksController = {
  list: async (req, res, next) => {
    try {
      const me = await User.findById(req.user?.id)
        .populate('blockedUsers', 'username firstName lastName customName profileImageUrl')
        .lean();
      if (!me) return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      const items = Array.isArray(me.blockedUsers)
        ? me.blockedUsers.map((u) => ({
          id: u._id,
          username: u.username,
          name: u.customName || u.firstName || u.username || 'Inconnu',
          profileImageUrl: u.profileImageUrl || '',
        }))
        : [];
      return res.json({ items });
    } catch (err) {
      next(err);
    }
  },

  add: async (req, res, next) => {
    try {
      const { targetUserId } = req.body || {};
      if (!targetUserId) return res.status(400).json({ code: 'TARGET_REQUIRED', message: 'targetUserId requis' });
      if (String(targetUserId) === String(req.user?.id)) {
        return res.status(400).json({ code: 'CANNOT_BLOCK_SELF', message: 'Impossible de se bloquer soi-même' });
      }
      const target = await User.findById(targetUserId).select('_id').lean();
      if (!target) return res.status(404).json({ code: 'TARGET_NOT_FOUND', message: 'Utilisateur introuvable' });
      await User.updateOne({ _id: req.user?.id }, { $addToSet: { blockedUsers: targetUserId } });
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  remove: async (req, res, next) => {
    try {
      const targetUserId = String(req.params.id || '').trim();
      if (!targetUserId) return res.status(400).json({ code: 'TARGET_REQUIRED', message: 'ID utilisateur requis' });
      await User.updateOne({ _id: req.user?.id }, { $pull: { blockedUsers: targetUserId } });
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
