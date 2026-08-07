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
 * Met à jour le streak d'un utilisateur suite à une activité (requête
 * authentifiée). Ne fait rien s'il s'est déjà connecté aujourd'hui (même
 * jour civil UTC). Appelé en fire-and-forget depuis le middleware requireAuth.
 *
 * - Gap === 1 jour civil (consécutif) : incrémente `streak.count` de 1,
 *   plafonné à 14. Passe `supervisePendingClaim` à true au palier 7, et
 *   `boostPendingClaim` à true au palier 14. Ne délivre jamais la récompense
 *   automatiquement : seuls les endpoints de claim le font.
 * - Gap > 1 jour civil (au moins un jour complet manqué) : réinitialise
 *   `streak.count` à 0 et efface les deux flags de claim en attente.
 */
export async function recordDailyActivity(userId, lastLoginAt) {
  const now = new Date();
  const previous = lastLoginAt ? new Date(lastLoginAt) : null;
  const gap = previous ? calendarDayGap(previous, now) : 1;

  if (gap <= 0) return; // déjà actif aujourd'hui

  if (gap === 1) {
    const user = await User.findById(userId).select('streak').lean();
    const currentCount = user?.streak?.count || 0;
    const nextCount = Math.min(14, currentCount + 1);
    const update = {
      $set: {
        'streak.count': nextCount,
        'streak.lastCheckInDate': now,
        lastLoginAt: now,
      },
    };
    if (nextCount === 7) update.$set['streak.supervisePendingClaim'] = true;
    if (nextCount === 14) update.$set['streak.boostPendingClaim'] = true;
    await User.updateOne({ _id: userId }, update);
  } else {
    // Au moins un jour civil complet sauté : le streak retombe à 0 et les
    // récompenses en attente non réclamées sont perdues.
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          'streak.count': 0,
          'streak.lastCheckInDate': now,
          'streak.supervisePendingClaim': false,
          'streak.boostPendingClaim': false,
          lastLoginAt: now,
        },
      }
    );
  }
}

/**
 * Réclame la récompense "superviselike" débloquée au palier de streak 7.
 * Rejette si aucune récompense n'est en attente.
 */
export async function claimSupervise(userId) {
  const user = await User.findById(userId).select('streak');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (!user.streak?.supervisePendingClaim) {
    throw Object.assign(new Error('Aucune récompense superviselike à réclamer'), {
      status: 409,
      code: 'NO_SUPERVISE_REWARD_PENDING',
    });
  }
  const now = new Date();
  const updated = await User.findByIdAndUpdate(
    userId,
    {
      $inc: { superlikeBalance: 1 },
      $set: { 'streak.supervisePendingClaim': false, 'streak.lastClaimedAt': now },
    },
    { new: true }
  );
  return updated;
}

/**
 * Réclame la récompense "boost" débloquée au palier de streak 14. Un cycle
 * complet est terminé : le streak repart de 0.
 */
export async function claimBoost(userId) {
  const user = await User.findById(userId).select('streak');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (!user.streak?.boostPendingClaim) {
    throw Object.assign(new Error('Aucune récompense boost à réclamer'), {
      status: 409,
      code: 'NO_BOOST_REWARD_PENDING',
    });
  }
  const now = new Date();
  const updated = await User.findByIdAndUpdate(
    userId,
    {
      $inc: { boostBalance: 1 },
      $set: {
        'streak.boostPendingClaim': false,
        'streak.lastClaimedAt': now,
        'streak.count': 0,
      },
    },
    { new: true }
  );
  return updated;
}

/**
 * Décroissance quotidienne : remet à 0 le streak de tout utilisateur n'ayant
 * pas ouvert l'app depuis au moins un jour civil complet (cron nocturne), et
 * efface les récompenses en attente non réclamées.
 */
export async function decayInactiveUsers() {
  const now = new Date();
  const users = await User.find({ 'streak.count': { $gt: 0 } }).select('_id lastLoginAt').lean();
  const staleIds = users
    .filter((u) => calendarDayGap(new Date(u.lastLoginAt || 0), now) >= 2)
    .map((u) => u._id);
  if (!staleIds.length) return 0;
  const res = await User.updateMany(
    { _id: { $in: staleIds } },
    {
      $set: {
        'streak.count': 0,
        'streak.supervisePendingClaim': false,
        'streak.boostPendingClaim': false,
      },
    }
  );
  return res.modifiedCount || 0;
}

/**
 * Instant exact où le streak d'un utilisateur retombera à 0 s'il ne se
 * reconnecte pas : minuit UTC, deux jours civils après le jour de
 * `lastLoginAt`. Reflète exactement la condition utilisée par
 * `decayInactiveUsers` (gap >= 2 jours civils).
 */
function getDecayDeadline(lastLoginAt) {
  const d = new Date(lastLoginAt);
  const loginDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(loginDay + 2 * DAY_MS);
}

/**
 * Envoie une alerte push aux utilisateurs dont le streak va expirer dans les
 * 6 prochaines heures. Une seule alerte par cycle de connexion.
 */
export async function sendStreakExpiryWarnings(now = new Date()) {
  const WARNING_WINDOW_MS = (6 * DAY_MS) / 24; // 6h
  const lastLoginFloor = new Date(now.getTime() - 2 * DAY_MS);

  const users = await User.find({
    'streak.count': { $gt: 0 },
    lastLoginAt: { $gte: lastLoginFloor, $lte: now },
  })
    .select('_id streak lastLoginAt')
    .lean();

  let sent = 0;
  for (const user of users) {
    const deadline = getDecayDeadline(user.lastLoginAt);
    const msLeft = deadline.getTime() - now.getTime();
    const withinWarningWindow = msLeft > 0 && msLeft <= WARNING_WINDOW_MS;
    const lastClaimedAt = user.streak?.lastClaimedAt;
    const alreadyWarnedThisCycle =
      lastClaimedAt && new Date(lastClaimedAt) >= new Date(user.lastLoginAt);

    if (!withinWarningWindow || alreadyWarnedThisCycle) continue;

    try {
      const count = user.streak?.count || 0;
      const title = 'Ton streak va bientôt expirer';
      const body = `Il te reste 6h avant que ton streak de ${count} jour${count > 1 ? 's' : ''} ne retombe à 0, connecte-toi maintenant pour le garder`;

      await sendPushUnified({
        userIds: [user._id],
        title,
        body,
        data: { kind: 'streak_expiring' },
      });
      sent += 1;
    } catch (err) {
      console.error(`[streak] Failed to send expiry warning to user ${user._id}:`, err);
    }
  }
  return sent;
}
