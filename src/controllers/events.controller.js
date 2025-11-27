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

      // Retention: keep only last 30 days of profile_view events
      try {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        // Global cleanup for all profile_view events older than 30 days
        Event.deleteMany({ type: 'profile_view', createdAt: { $lt: cutoff } }).catch(() => {});
      } catch (_) { /* ignore cleanup errors */ }

      // Increment simple counter for quick reads (optional)
      try { await User.updateOne({ _id: targetUserId }, { $inc: { profileViews: 1 } }); } catch {}

      // Send push notification to target user (if tokens exist)
      try {
        const tokens = await FcmToken.find({ user: targetUserId }).distinct('token');
        if (tokens.length > 0) {
          // Compose message per plan:
          // - Free: "Quelqu'un regarde ton profil...👀"
          // - Premium: "{Prénom ou Nom personnalisé} regarde ton profil 👀"
          let title = 'Visite de profil';
          let body = "Quelqu'un regarde ton profil...👀";
          if (target.isPremium) {
            if (actorId) {
              const actor = await User.findById(actorId).lean();
              const name = (actor?.customName && String(actor.customName).trim())
                || (actor?.firstName && String(actor.firstName).trim())
                || (actor?.username && String(actor.username).trim())
                || "Quelqu'un";
              body = `${name} regarde ton profil 👀`;
            } else {
              body = "Quelqu'un regarde ton profil 👀";
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
      // Normaliser le nom du réseau social côté backend pour cohérence des stats
      let net = String(socialNetwork || '').trim().toLowerCase();
      // Si un URL complet a été transmis par erreur, extraire le host pour déduire la plateforme
      try {
        if (/^https?:\/\//.test(net)) {
          const u = new URL(net);
          const host = (u.hostname || '').toLowerCase();
          if (host.includes('instagram')) net = 'instagram';
          else if (host.includes('tiktok')) net = 'tiktok';
          else if (host.includes('snap')) net = 'snapchat';
          else if (host.includes('facebook')) net = 'facebook';
          else if (host.includes('linkedin')) net = 'linkedin';
          else if (host.includes('youtu')) net = 'youtube';
          else if (host.includes('x.com') || host.includes('twitter')) net = 'x';
        }
      } catch (_) {}
      // Mapper d'alias → clé canonique
      if (net === 'twitter' || net === 'twitter.com' || net === 'x' || net === 'x.com') net = 'x';
      if (net === 'yt' || net === 'youtu.be' || net === 'youtube.com' || net === 'youtube') net = 'youtube';
      if (net === 'fb' || net === 'facebook.com' || net === 'facebook') net = 'facebook';
      if (net === 'ig' || net === 'insta' || net === 'instagram.com' || net === 'instagram') net = 'instagram';
      if (net === 'tt' || net === 'tiktok.com' || net === 'tiktok') net = 'tiktok';
      if (net === 'snap' || net === 'snapchat.com' || net === 'snapchat') net = 'snapchat';
      if (net === 'linkedin.com' || net === 'linkedIn' || net === 'linkedin') net = 'linkedin';

      // Au final, ne conserver que les clés supportées
      const allowed = new Set(['instagram', 'facebook', 'x', 'snapchat', 'tiktok', 'linkedin', 'youtube']);
      if (!allowed.has(net)) {
        // éviter une erreur de validation mongoose
        return res.status(400).json({ code: 'PLATFORM_UNSUPPORTED', message: 'Réseau social non supporté' });
      }
      const ev = await Event.create({ type: 'social_click', actor: actorId, targetUser: targetUserId, socialNetwork: net });
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
