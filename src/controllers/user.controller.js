import { getNearbyUsers, updateLocation, getUsersByEmails, getPopularUsers, searchUsers } from '../services/user.service.js';

export const UserController = {
  me: async (req, res, next) => {
    try {
      // Return full user profile (sans password)
      const { User } = await import('../models/User.js');
      const user = await User.findById(req.user.id).select('-password');
      if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      // Ensure new fields exist with sane defaults for legacy users
      let changed = false;
      if (typeof user.username !== 'string' || user.username.trim() === '') {
        const fallback = (user.name && user.name.trim()) || (user.email ? String(user.email).split('@')[0] : '');
        user.username = fallback;
        // keep legacy name in sync if empty
        if (!user.name) user.name = fallback;
        changed = true;
      }
      if (typeof user.firstName !== 'string') { user.firstName = ''; changed = true; }
      if (typeof user.lastName !== 'string') { user.lastName = ''; changed = true; }
      if (typeof user.customName !== 'string') { user.customName = ''; changed = true; }
      if (changed) await user.save();
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  updateLocation: async (req, res, next) => {
    try {
      const { lat, lon } = req.body;
      const user = await updateLocation(req.user.id, { lat, lon });
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  nearby: async (req, res, next) => {
    try {
      const { lat, lon, radius } = req.query;
      // Enforce that invisible users cannot see others
      try {
        const { User } = await import('../models/User.js');
        const me = await User.findById(req.user.id).select('isVisible');
        if (!me) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
        if (me.isVisible === false) return res.status(403).json({ code: 'INVISIBLE', message: 'Visibility is disabled' });
      } catch (_e) { /* proceed even if check fails; service will further validate */ }
      const users = await getNearbyUsers({
        userId: req.user.id,
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        radiusMeters: radius ? parseInt(radius, 10) : 2000,
      });
      return res.json({ users });
    } catch (err) {
      next(err);
    }
  },
  getByEmail: async (req, res, next) => {
    try {
      const emails = req.query.email; // after validator, this is an array of normalized emails
      const users = await getUsersByEmails(emails);
      return res.json({ users });
    } catch (err) {
      next(err);
    }
  },
  popular: async (req, res, next) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
      const users = await getPopularUsers({ userId: req.user?.id, limit });
      return res.json({ users });
    } catch (err) {
      next(err);
    }
  },
  search: async (req, res, next) => {
    try {
      const { q, limit } = req.query;
      const users = await searchUsers({ q, limit, excludeUserId: req.user?.id });
      return res.json({ users });
    } catch (err) {
      next(err);
    }
  },
};
