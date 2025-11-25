import { Event } from '../models/Event.js';
import { User } from '../models/User.js';

function getDateRange(range) {
  const now = new Date();
  let from;
  if (range === 'day') {
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
  } else if (range === 'week') {
    const d = new Date(now);
    const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
    const diff = (day + 6) % 7; // days since Monday
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    from = d;
  } else if (range === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
  }
  return { from, to: now };
}

export const StatsController = {
  overview: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const range = String(req.query.range || 'day');
      const { from, to } = getDateRange(range);

      const [viewsCount, clicksAgg] = await Promise.all([
        Event.countDocuments({ type: 'profile_view', targetUser: userId, createdAt: { $gte: from, $lte: to } }),
        Event.aggregate([
          { $match: { type: 'social_click', targetUser: userId, createdAt: { $gte: from, $lte: to } } },
          { $group: { _id: '$socialNetwork', count: { $sum: 1 } } },
        ]),
      ]);

      const clicksByNetwork = {};
      for (const row of clicksAgg) clicksByNetwork[row._id || 'unknown'] = row.count;

      return res.json({
        range,
        from,
        to,
        views: viewsCount,
        clicksByNetwork,
      });
    } catch (err) {
      next(err);
    }
  },

  detailedProfileViews: async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const me = await User.findById(userId).lean();
      const now = new Date();
      // Premium-only: only isPremium flag is considered
      if (!me?.isPremium) {
        return res.status(403).json({ code: 'PREMIUM_REQUIRED', message: 'Fonctionnalité réservée aux comptes Premium' });
      }
      const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
      // Only last 30 days
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const events = await Event.find({ type: 'profile_view', targetUser: userId, createdAt: { $gte: cutoff } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('actor', 'username firstName lastName customName profileImageUrl')
        .lean();
      const items = events.map((e) => ({
        id: e._id,
        at: e.createdAt,
        actor: e.actor ? {
          id: e.actor._id,
          username: e.actor.username,
          name: e.actor.customName || e.actor.firstName || e.actor.username || 'Inconnu',
          profileImageUrl: e.actor.profileImageUrl || '',
        } : null,
      }));
      return res.json({ items });
    } catch (err) {
      next(err);
    }
  },
};
