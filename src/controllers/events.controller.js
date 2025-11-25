import { Event } from '../models/Event.js';
import { User } from '../models/User.js';
import { FcmToken } from '../models/FcmToken.js';
import { sendPushToTokens } from '../services/fcm.service.js';

export const EventsController = {
  profileView: async (req, res, next) => {
    try {
      const actorId = req.user?.id || null;
      const { targetUserId } = req.body;
      if (!targetUserId) return res.status(400).json({ code: 'TARGET_REQUIRED', message: 'targetUserId requis' });

      const target = await User.findById(targetUserId).lean();
      if (!target) return res.status(404).json({ code: 'TARGET_NOT_FOUND', message: 'Utilisateur cible introuvable' });

      // Record event
      const ev = await Event.create({ type: 'profile_view', actor: actorId, targetUser: targetUserId });

      // Increment simple counter for quick reads (optional)
      try { await User.updateOne({ _id: targetUserId }, { $inc: { profileViews: 1 } }); } catch {}

      // Send push notification to target user (if tokens exist)
      try {
        const tokens = await FcmToken.find({ user: targetUserId }).distinct('token');
        if (tokens.length > 0) {
          let title = 'Nouvelle visite';
          let body = 'Votre profil a reçu une nouvelle visite';
          if (target.isPremium) {
            // If premium, include actor details when available
            if (actorId) {
              const actor = await User.findById(actorId).lean();
              const name = actor?.username || actor?.customName || actor?.firstName || 'Quelqu\'un';
              const ts = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              body = `${name} a visité votre profil à ${ts}`;
            } else {
              body = `Une visite a été enregistrée`;
            }
          }
          await sendPushToTokens(tokens, { title, body }, { kind: 'profile_view', targetUserId: String(targetUserId) });
        }
      } catch (e) {
        console.warn('[events] push send failed', e?.message || e);
      }

      return res.status(201).json({ success: true, eventId: ev._id });
    } catch (err) {
      next(err);
    }
  },
  socialClick: async (req, res, next) => {
    try {
      const actorId = req.user?.id || null;
      const { targetUserId, socialNetwork } = req.body;
      if (!targetUserId || !socialNetwork) return res.status(400).json({ code: 'PARAMS_REQUIRED', message: 'targetUserId et socialNetwork requis' });
      const ev = await Event.create({ type: 'social_click', actor: actorId, targetUser: targetUserId, socialNetwork });
      return res.status(201).json({ success: true, eventId: ev._id });
    } catch (err) {
      next(err);
    }
  },
  userSearch: async (req, res, next) => {
    try {
      const actorId = req.user?.id || null;
      const { query } = req.body;
      const ev = await Event.create({ type: 'user_search', actor: actorId, query: String(query || '') });
      return res.status(201).json({ success: true, eventId: ev._id });
    } catch (err) {
      next(err);
    }
  },
};
