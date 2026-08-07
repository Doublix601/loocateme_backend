import { getNearbyUsers, updateLocation, forceCheckIn, forceCheckOut, getUsersByEmails, getPopularUsers, searchUsers, getUserByIdForViewer } from '../services/user.service.js';
import { requestEmailChange, confirmEmailChange } from '../services/auth.service.js';

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
  forceCheckIn: async (req, res, next) => {
    try {
      const { locationId, lat, lon, bypassDistance, mode } = req.body;
      const user = await forceCheckIn(req.user.id, { locationId, lat, lon, bypassDistance, mode });
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  forceCheckOut: async (req, res, next) => {
    try {
      const user = await forceCheckOut(req.user.id);
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  heartbeat: async (req, res, next) => {
    try {
      const { lat, lon } = req.body;
      console.log(`[heartbeat] Received from user=${req.user.id} at lat=${lat}, lon=${lon}`);

      const user = await updateLocation(req.user.id, { lat, lon });

      console.log(`[heartbeat] User updated: id=${user._id}, lastSeen=${user.location?.updatedAt}, loc=${user.currentLocation || 'none'}`);

      return res.json({ status: 'ok', user });
    } catch (err) {
      console.error(`[heartbeat] Error for user=${req.user?.id}:`, err.message);
      next(err);
    }
  },
  nearby: async (req, res, next) => {
    try {
      const { lat, lon, radius } = req.query;
      const { User } = await import('../models/User.js');
      const me = await User.findById(req.user.id).select('status isPremium');
      if (!me) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      if (me.status === 'red') return res.status(403).json({ code: 'INVISIBLE', message: 'Visibility is disabled' });
      const maxRadius = me.isPremium ? 2000 : 500;
      const radiusMeters = radius ? Math.min(parseInt(radius, 10), maxRadius) : maxRadius;
      const users = await getNearbyUsers({
        userId: req.user.id,
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        radiusMeters,
      });
      return res.json({ users, maxRadius });
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
  // Étape 1 du changement d'email : demande + envoi de l'email de
  // confirmation vers la nouvelle adresse (cf. auth.service.js/requestEmailChange).
  requestEmailChange: async (req, res, next) => {
    try {
      const { newEmail, currentPassword } = req.body;
      const result = await requestEmailChange(req.user.id, { newEmail, currentPassword });
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },
  // Étape 2 : confirmation via le token reçu par email sur la nouvelle adresse.
  confirmEmailChange: async (req, res, next) => {
    try {
      const token = String(req.body.token || req.query.token || '');
      if (!token) return res.status(400).json({ code: 'TOKEN_REQUIRED', message: 'Token requis' });
      const user = await confirmEmailChange(token);
      return res.json({ success: true, user });
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
  // Mode invisible (RGPD) : masque l'utilisateur des listes/cartes de lieux
  // sans toucher au champ `status`. Pas de gating premium.
  updateInvisibleMode: async (req, res, next) => {
    try {
      const { invisibleMode } = req.body || {};
      if (typeof invisibleMode !== 'boolean') {
        return res.status(400).json({ code: 'INVALID_INVISIBLE_MODE', message: 'invisibleMode must be a boolean' });
      }
      const { User } = await import('../models/User.js');
      const { sanitize } = await import('../services/auth.service.js');
      const user = await User.findByIdAndUpdate(req.user.id, { $set: { invisibleMode } }, { new: true }).select('-password');
      if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      return res.json({ user: sanitize(user) });
    } catch (err) {
      next(err);
    }
  },
  // Préférences de notifications par "kind" (clé libre). Remplace/ajoute une
  // entrée dans la Map plutôt que de remplacer la map entière.
  updateNotificationPreferences: async (req, res, next) => {
    try {
      const { kind, enabled } = req.body || {};
      if (typeof kind !== 'string' || !kind.trim() || typeof enabled !== 'boolean') {
        return res.status(400).json({ code: 'INVALID_NOTIFICATION_PREFERENCE', message: 'kind (string) and enabled (boolean) are required' });
      }
      const { User } = await import('../models/User.js');
      const { sanitize } = await import('../services/auth.service.js');
      const user = await User.findByIdAndUpdate(
        req.user.id,
        { $set: { [`notificationPreferences.${kind.trim()}`]: enabled } },
        { new: true }
      ).select('-password');
      if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      return res.json({ user: sanitize(user) });
    } catch (err) {
      next(err);
    }
  },
  // Mode de check-in : 'auto' (détection GPS/heartbeat) ou 'manual'
  // (l'utilisateur force systématiquement son check-in).
  updateCheckInMode: async (req, res, next) => {
    try {
      const { checkInMode } = req.body || {};
      if (!['auto', 'manual'].includes(checkInMode)) {
        return res.status(400).json({ code: 'INVALID_CHECK_IN_MODE', message: 'checkInMode must be "auto" or "manual"' });
      }
      const { User } = await import('../models/User.js');
      const { sanitize } = await import('../services/auth.service.js');
      const user = await User.findByIdAndUpdate(req.user.id, { $set: { checkInMode } }, { new: true }).select('-password');
      if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      return res.json({ user: sanitize(user) });
    } catch (err) {
      next(err);
    }
  },
  claimSupervise: async (req, res, next) => {
    try {
      const { claimSupervise } = await import('../services/streak.service.js');
      const { sanitize } = await import('../services/auth.service.js');
      const user = await claimSupervise(req.user.id);
      return res.json({ user: sanitize(user) });
    } catch (err) {
      next(err);
    }
  },
  claimBoost: async (req, res, next) => {
    try {
      const { claimBoost } = await import('../services/streak.service.js');
      const { sanitize } = await import('../services/auth.service.js');
      const user = await claimBoost(req.user.id);
      return res.json({ user: sanitize(user) });
    } catch (err) {
      next(err);
    }
  },
};
