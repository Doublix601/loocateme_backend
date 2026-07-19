import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { FcmToken } from '../models/FcmToken.js';
import { sendPushUnified } from './push.service.js';

/**
 * Relance "X profils t'ont vu récemment" : envoyée aux utilisateurs inactifs
 * depuis 4h à 48h (fenêtre d'éligibilité, pour ne pas relancer indéfiniment
 * les comptes dormants) qui ont reçu au moins une vue de profil pendant leur
 * absence. Au plus un envoi par 24h par utilisateur.
 */
export async function sendInactiveProfileViewsNudge() {
  const now = new Date();
  const from = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const to = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const dedupThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const users = await User.find({
    lastLoginAt: { $gte: from, $lt: to },
    $or: [{ profileViewsNudgeSentAt: null }, { profileViewsNudgeSentAt: { $lt: dedupThreshold } }],
  })
    .select('_id lastLoginAt')
    .lean();

  let sent = 0;
  for (const user of users) {
    try {
      const viewsCount = await Event.countDocuments({
        targetUser: user._id,
        type: 'profile_view',
        createdAt: { $gt: user.lastLoginAt },
      });
      if (viewsCount <= 0) continue;

      const title = viewsCount > 1
        ? `${viewsCount} profils t'ont vu récemment`
        : `${viewsCount} profil t'a vu récemment`;
      const body = 'Reviens vite découvrir qui s\'intéresse à toi.';

      await sendPushUnified({
        userIds: [user._id],
        title,
        body,
        data: { kind: 'inactive_profile_views', viewsCount, url: 'loocateme://statistics' },
      });
      await User.updateOne({ _id: user._id }, { $set: { profileViewsNudgeSentAt: now } });
      sent += 1;
    } catch (err) {
      console.error(`[engagement] Failed to send profile-views nudge to user ${user._id}:`, err);
    }
  }
  return sent;
}

/**
 * Notification "mode nuit activé" : envoyée en broadcast à tous les
 * utilisateurs disposant d'un token push, uniquement le vendredi et le
 * samedi à 19h (cf. cron.service.js), synchronisée avec le basculement
 * jour/nuit côté app (VibeContext.getAutoVibe(), 19h-7h).
 */
export async function sendNightModeActivatedNotification() {
  const userIds = await FcmToken.distinct('user');
  if (!userIds.length) return 0;

  const chunkSize = 500;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    try {
      await sendPushUnified({
        userIds: chunk,
        title: 'Le mode nuit s\'est activé 🌙',
        body: 'Planifie ta soirée maintenant',
        data: { kind: 'night_mode_activated', url: 'loocateme://nearby' },
      });
    } catch (err) {
      console.error('[engagement] Night mode notification batch error:', err);
    }
  }
  return userIds.length;
}
