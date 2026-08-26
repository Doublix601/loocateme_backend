import { User } from '../models/User.js';

// Priorité relative des notifications "comportementales" (nudges non
// transactionnels, déclenchés par des crons plutôt que par une action d'un
// autre utilisateur). Plus la valeur est haute, plus la notification est
// jugée actionnable/urgente pour l'utilisateur.
const NUDGE_PRIORITY = {
  streak_lost: 5,
  streak_expiring: 4,
  inactive_profile_views: 3,
  at_risk_reactivation: 2,
  weekly_digest: 2,
  night_mode_activated: 1,
};

function utcDayStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Réserve, pour un utilisateur donné, le "budget" quotidien de notifications
 * comportementales : au plus une par jour civil, sauf si une notification de
 * priorité strictement supérieure devient due le même jour (elle peut alors
 * s'ajouter à celle déjà envoyée). Empêche l'empilement de streak_expiring +
 * inactive_profile_views + at_risk_reactivation + weekly_digest +
 * night_mode_activated le même jour chez un même utilisateur.
 *
 * Écriture atomique (findOneAndUpdate) : retourne true si l'envoi est
 * autorisé (et réservé), false si le budget du jour est déjà pris par une
 * notification de priorité égale ou supérieure.
 */
export async function claimBehavioralNudgeSlot(userId, kind, now = new Date()) {
  const priority = NUDGE_PRIORITY[kind];
  if (!priority) throw new Error(`claimBehavioralNudgeSlot: unknown kind "${kind}"`);

  const todayStart = utcDayStart(now);
  const filter = {
    _id: userId,
    $or: [
      { lastBehavioralNudgeAt: null },
      { lastBehavioralNudgeAt: { $lt: todayStart } },
      { lastBehavioralNudgeAt: { $gte: todayStart }, lastBehavioralNudgePriority: { $lt: priority } },
    ],
  };

  try {
    const res = await User.updateOne(filter, {
      $set: { lastBehavioralNudgeAt: now, lastBehavioralNudgePriority: priority, lastBehavioralNudgeKind: kind },
    });
    return res.modifiedCount > 0;
  } catch (e) {
    // Erreur DB sur la réservation : on autorise l'envoi plutôt que de faire
    // échouer toute la boucle appelante pour un utilisateur (fail-open, comme
    // filterBoostCooldown côté boostNotify.service.js).
    console.error(`[notificationGovernor] claimBehavioralNudgeSlot error (user=${userId}, kind=${kind}):`, e?.message || e);
    return true;
  }
}
