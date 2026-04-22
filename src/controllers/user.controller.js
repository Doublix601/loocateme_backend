import { getNearbyUsers, updateLocation, getUsersByEmails, getPopularUsers, searchUsers, getUserByIdForViewer } from '../services/user.service.js';

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
      const mod = user.moderation || {};
      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - 3);
      const rawHistory = Array.isArray(mod.warningsHistory) ? mod.warningsHistory : [];
      const cleanedHistory = rawHistory
        .map((entry) => ({
          at: entry?.at ? new Date(entry.at) : null,
          type: entry?.type ? String(entry.type) : '',
          reason: entry?.reason ? String(entry.reason) : '',
        }))
        .filter((entry) => entry.at && !isNaN(entry.at.getTime()) && entry.at.getTime() >= cutoff.getTime());

      if (cleanedHistory.length > 0) {
        const last = cleanedHistory[cleanedHistory.length - 1];
        user.moderation = user.moderation || {};
        user.moderation.warningsHistory = cleanedHistory;
        user.moderation.warningsCount = cleanedHistory.length;
        user.moderation.lastWarningAt = last.at;
        user.moderation.lastWarningReason = last.reason || user.moderation.lastWarningReason || '';
        user.moderation.lastWarningType = last.type || user.moderation.lastWarningType || '';
        changed = true;
      } else if (mod.lastWarningAt) {
        const last = new Date(mod.lastWarningAt);
        if (!isNaN(last.getTime()) && last.getTime() < cutoff.getTime()) {
          user.moderation = user.moderation || {};
          user.moderation.warningsCount = 0;
          user.moderation.lastWarningAt = null;
          user.moderation.lastWarningReason = '';
          user.moderation.lastWarningType = '';
          user.moderation.warningsHistory = [];
          changed = true;
        } else if (mod.warningsCount > 0) {
          user.moderation = user.moderation || {};
          user.moderation.warningsHistory = [
            { at: last, type: mod.lastWarningType || 'Avertissement', reason: mod.lastWarningReason || 'Avertissement' },
          ];
          changed = true;
        }
      }
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
  heartbeat: async (req, res, next) => {
    try {
      const { lat, lon } = req.body;
      // Heartbeat can just be a wrapper around updateLocation
      // It ensures the user is marked as active/seen
      const user = await updateLocation(req.user.id, { lat, lon });
      return res.json({ status: 'ok', user });
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
      const { q, limit, lat, lon, includeUsers, includeLocations } = req.query;

      const excludeUserId = req.user?.id;
      const s = String(q || '').trim();
      const safeLimit = Math.max(1, Math.min(10, parseInt(limit, 10) || 10));

      if (!s || s.length < 2) {
        return res.json({ users: [], locations: [] });
      }

      const results = { users: [], locations: [] };

      // Users search
      if (String(includeUsers) !== 'false') {
        results.users = await searchUsers({ q: s, limit: safeLimit, excludeUserId });
      }

      // Locations search
      if (String(includeLocations) !== 'false') {
        const { Location } = await import('../models/Location.js');
        const query = { name: { $regex: s, $options: 'i' } };

        if (lat && lon) {
          const latitude = parseFloat(lat);
          const longitude = parseFloat(lon);
          results.locations = await Location.aggregate([
            {
              $geoNear: {
                near: { type: 'Point', coordinates: [longitude, latitude] },
                distanceField: 'distance',
                query: query,
                spherical: true,
              },
            },
            { $limit: safeLimit },
          ]);
        } else {
          results.locations = await Location.find(query).limit(safeLimit).lean();
        }
      }

      return res.json(results);
    } catch (err) {
      next(err);
    }
  },
  getById: async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      const user = await getUserByIdForViewer({ userId: req.user?.id, targetId: id });
      if (!user) return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
};
