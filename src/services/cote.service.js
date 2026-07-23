import { User } from '../models/User.js';
import { sendPushUnified } from './push.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Nombre de jours civils (UTC) écoulés entre deux dates.
function calendarDayGap(from, to) {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((toDay - fromDay) / DAY_MS);
}

/**
 * Met à jour la Cote d'un utilisateur suite à une activité (requête authentifiée).
 * Ne fait rien s'il s'est déjà connecté aujourd'hui (même jour civil UTC).
 * Appelé en fire-and-forget depuis le middleware requireAuth.
 */
export async function recordDailyActivity(userId, lastLoginAt) {
  const now = new Date();
  const previous = lastLoginAt ? new Date(lastLoginAt) : null;
  const gap = previous ? calendarDayGap(previous, now) : 1;

  if (gap <= 0) return; // déjà actif aujourd'hui

  let update;
  if (gap === 1) {
    update = [{ $set: { cotePercent: { $min: [100, { $add: ['$cotePercent', 25] }] }, lastLoginAt: now, coteWarningSentAt: null } }];
  } else {
    // Au moins un jour civil complet sauté : la Cote tombe à 0% et n'y reste
    // qu'un jour civil (~24h) avant de pouvoir remonter à la reconnexion suivante.
    update = { $set: { cotePercent: 0, lastLoginAt: now, coteWarningSentAt: null } };
  }
  await User.updateOne({ _id: userId }, update);
}

/**
 * Décroissance quotidienne : passe à 0% tout utilisateur n'ayant pas ouvert
 * l'app depuis au moins un jour civil complet (cron nocturne).
 */
export async function decayInactiveUsers() {
  const now = new Date();
  const users = await User.find({ cotePercent: { $gt: 0 } }).select('_id lastLoginAt').lean();
  const staleIds = users
    .filter((u) => calendarDayGap(new Date(u.lastLoginAt || 0), now) >= 2)
    .map((u) => u._id);
  if (!staleIds.length) return 0;
  const res = await User.updateMany({ _id: { $in: staleIds } }, { $set: { cotePercent: 0 } });
  return res.modifiedCount || 0;
}

/**
 * Envoie une alerte push aux utilisateurs à 6h de l'expiration de leur Cote
 * (18h à 24h sans connexion), une seule fois par jour.
 */
export async function sendCoteExpiryWarnings() {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() - 18 * 60 * 60 * 1000);

  const users = await User.find({
    cotePercent: { $gt: 0 },
    lastLoginAt: { $gte: from, $lt: to },
    $or: [{ coteWarningSentAt: null }, { coteWarningSentAt: { $lt: to } }],
  })
    .select('_id cotePercent')
    .lean();

  let sent = 0;
  for (const user of users) {
    try {
      const title = 'Ta cote va expirer';
      const body =
        user.cotePercent === 100
          ? 'Ta cote de 100% va expirer, garde là en te connectant maintenant'
          : `Ta cote de ${user.cotePercent}% va expirer, ne la pers pas et fais là grimper en te connectant maintenant`;

      await sendPushUnified({
        userIds: [user._id],
        title,
        body,
        data: { kind: 'cote_expiring' },
      });
      await User.updateOne({ _id: user._id }, { $set: { coteWarningSentAt: now } });
      sent += 1;
    } catch (err) {
      console.error(`[cote] Failed to send expiry warning to user ${user._id}:`, err);
    }
  }
  return sent;
}
