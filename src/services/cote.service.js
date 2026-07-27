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
 * Instant exact où la Cote d'un utilisateur tombera à 0% s'il ne se
 * reconnecte pas : minuit UTC, deux jours civils après le jour de
 * `lastLoginAt`. Reflète exactement la condition utilisée par
 * `decayInactiveUsers` (gap >= 2 jours civils), contrairement à un simple
 * "+24h" qui ne correspond pas à l'instant réel de la décroissance.
 */
function getDecayDeadline(lastLoginAt) {
  const d = new Date(lastLoginAt);
  const loginDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(loginDay + 2 * DAY_MS);
}

/**
 * Envoie une alerte push aux utilisateurs dont la Cote va expirer dans les
 * 6 prochaines heures. Le seuil est calculé à partir de l'instant réel de
 * décroissance (minuit UTC, cf. getDecayDeadline) plutôt que d'un délai fixe
 * depuis la dernière connexion : selon l'heure de connexion, l'ancienne
 * fenêtre "18h-24h depuis lastLoginAt" pouvait se déclencher bien trop tôt ou
 * complètement rater la vraie échéance (celle-ci peut survenir entre ~24h et
 * ~48h après la connexion). Une seule alerte par cycle de connexion.
 */
export async function sendCoteExpiryWarnings(now = new Date()) {
  const WARNING_WINDOW_MS = 6 * DAY_MS / 24; // 6h
  // Bornes larges pour rester indexable : toute connexion des ~2 derniers
  // jours peut potentiellement arriver à échéance dans les 6h à venir.
  const lastLoginFloor = new Date(now.getTime() - 2 * DAY_MS);

  const users = await User.find({
    cotePercent: { $gt: 0 },
    lastLoginAt: { $gte: lastLoginFloor, $lte: now },
  })
    .select('_id cotePercent lastLoginAt coteWarningSentAt')
    .lean();

  let sent = 0;
  for (const user of users) {
    const deadline = getDecayDeadline(user.lastLoginAt);
    const msLeft = deadline.getTime() - now.getTime();
    const withinWarningWindow = msLeft > 0 && msLeft <= WARNING_WINDOW_MS;
    const alreadyWarnedThisCycle =
      user.coteWarningSentAt && new Date(user.coteWarningSentAt) >= new Date(user.lastLoginAt);

    if (!withinWarningWindow || alreadyWarnedThisCycle) continue;

    try {
      const title = 'Ta cote va bientôt expirer';
      const body =
        user.cotePercent === 100
          ? 'Il te reste 6h avant que ta cote de 100% ne retombe à 0%, connecte-toi maintenant pour la garder'
          : `Il te reste 6h avant que ta cote de ${user.cotePercent}% ne retombe à 0%, connecte-toi maintenant pour la faire grimper`;

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
