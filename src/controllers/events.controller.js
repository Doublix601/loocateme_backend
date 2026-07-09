import { Event } from '../models/Event.js';
import { User } from '../models/User.js';
import { NotificationDedup } from '../models/NotificationDedup.js';
import { FeatureFlag } from '../models/FeatureFlag.js';
import { sendPushUnified } from '../services/push.service.js';

async function isPremiumEnabled() {
  try {
    const flag = await FeatureFlag.findOne({ key: 'premiumEnabled' }).lean();
    return !!flag?.enabled;
  } catch (_) {
    return false;
  }
}

function hasPremiumAccess(user) {
  if (!user) return false;
  const now = new Date();
  const trialActive = user.premiumTrialEnd && user.premiumTrialEnd > now;
  return !!user.isPremium || !!trialActive;
}

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

      // Send push notification to target user (premium-aware copy)
      try {
        // - Free: « Quelqu'un regarde ton profil ! Découvre qui c'est. »
        // - Premium: « {Prénom} regarde ton profil ! »
        let title = 'Visite de profil';
        let body = "Quelqu'un regarde ton profil ! Découvre qui c'est.";

        // Logique de visiteur récurrent (détection si l'acteur a visité la cible > 2 fois en 24h)
        let isRecurring = false;
        if (actorId) {
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const recentViews = await Event.countDocuments({
            type: 'profile_view',
            actor: actorId,
            targetUser: targetUserId,
            createdAt: { $gt: yesterday }
          });
          if (recentViews >= 2) isRecurring = true;
        }

        const premiumEnabled = await isPremiumEnabled();
        const allowPremiumCopy = !premiumEnabled || hasPremiumAccess(target);
        if (allowPremiumCopy) {
          if (actorId) {
            const actor = await User.findById(actorId).lean();
            const name = (actor?.customName && String(actor.customName).trim())
              || (actor?.firstName && String(actor.firstName).trim())
              || (actor?.username && String(actor.username).trim())
              || "Quelqu'un";

            if (isRecurring) {
              body = `${name} est un admirateur secret... Il/Elle a encore regardé ton profil ! 😉`;
            } else {
              body = `${name} regarde ton profil !`;
            }
          }
        } else if (isRecurring) {
          body = "Tu as un admirateur secret... Quelqu'un a regardé ton profil plusieurs fois aujourd'hui ! 👀";
        }

        await sendPushUnified({
          userIds: [targetUserId],
          title,
          body,
          data: {
            kind: 'profile_view',
            targetUserId: String(targetUserId),
            actorId: actorId ? String(actorId) : undefined,
            isRecurring
          }
        });
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

      // Dedup for 24h per (target, viewer, eventType)
      let dedupKeyCreated = false;
      try {
        if (actorId) {
          await NotificationDedup.create({ targetUser: targetUserId, viewerUser: actorId, eventType: 'social_click' });
          dedupKeyCreated = true;
        }
      } catch (e) {
        // Duplicate key -> already notified in last 24h
        if (String(e?.code) === '11000') dedupKeyCreated = false; else dedupKeyCreated = true; // default to send on other errors
      }

      // Send push only if not already sent in last 24h for this viewer
      if (dedupKeyCreated) {
        try {
          const target = await User.findById(targetUserId).lean();
          let title = 'Activité sur tes réseaux';
          let body = 'Quelqu’un consulte tes réseaux — découvre qui te stalke 🔍';
          const premiumEnabled = await isPremiumEnabled();
          const allowPremiumCopy = !premiumEnabled || hasPremiumAccess(target);
          if (allowPremiumCopy) {
            // Premium: {Prénom} consulte tes réseaux 🔗
            let name = 'Quelqu’un';
            if (actorId) {
              const actor = await User.findById(actorId).lean();
              name = (actor?.customName && String(actor.customName).trim())
                || (actor?.firstName && String(actor.firstName).trim())
                || (actor?.username && String(actor.username).trim())
                || 'Quelqu’un';
            }
            body = `${name} consulte ton ${net} 🔗`;
          } else {
            // Pousse vers le premium pour le gratuit en étant plus spécifique sur le réseau
            body = `Quelqu’un consulte ton ${net} — découvre qui te stalke 🔍`;
          }
          await sendPushUnified({ userIds: [targetUserId], title, body, data: { kind: 'social_click', net, targetUserId: String(targetUserId) } });
        } catch (e) {
          console.warn('[events] social_click push failed', e?.message || e);
        }
      }

      return res.status(201).json({ success: true, eventId: ev._id, notified: !!dedupKeyCreated });
    } catch (err) {
      next(err);
    }
  },
  locationView: async (req, res, next) => {
    try {
      const actorId = req.user?.id || null;
      const { locationId } = req.body;
      const ev = await Event.create({ type: 'location_view', actor: actorId, locationId });

      // Rétention 30 jours, comme les autres events (cf. cleanup RGPD dans cron.service.js)
      try {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        Event.deleteMany({ type: 'location_view', createdAt: { $lt: cutoff } }).catch(() => {});
      } catch (_) { /* ignore cleanup errors */ }

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
