import { User } from '../models/User.js';
import { sendPushUnified } from './push.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Relance ciblée des comptes "à risque" : permission localisation ou
 * notifications refusée (l'app perd une grande partie de sa valeur sans
 * localisation) ET inactifs depuis 3 à 14 jours. Distincte du nudge
 * générique d'inactivité (engagement.service.js) car le message et le
 * problème à résoudre sont différents : ici, il s'agit de faire revenir
 * l'utilisateur vers les réglages plutôt que vers le contenu.
 * Au plus un envoi par 7 jours par utilisateur.
 */
export async function sendAtRiskReactivationNudge(now = new Date()) {
  const from = new Date(now.getTime() - 14 * DAY_MS);
  const to = new Date(now.getTime() - 3 * DAY_MS);
  const dedupThreshold = new Date(now.getTime() - 7 * DAY_MS);

  const users = await User.find({
    lastLoginAt: { $gte: from, $lt: to },
    accountType: 'individual',
    $or: [{ locationPermissionStatus: 'denied' }, { notificationsPermissionStatus: 'denied' }],
    $and: [
      { $or: [{ atRiskNudgeSentAt: null }, { atRiskNudgeSentAt: { $lt: dedupThreshold } }] },
    ],
  })
    .select('_id locationPermissionStatus notificationsPermissionStatus')
    .lean();

  let sent = 0;
  for (const user of users) {
    try {
      const isLocationIssue = user.locationPermissionStatus === 'denied';
      const title = isLocationIssue ? 'On dirait qu\'il manque quelque chose 📍' : 'Tu vas rater des choses 🔔';
      const body = isLocationIssue
        ? 'Réactive ta localisation pour retrouver qui est autour de toi.'
        : 'Réactive les notifications pour ne plus rater les vues de profil et les nouveautés.';

      // Notifications refusées : injoignable par push, uniquement par email/in-app au
      // prochain lancement. On envoie quand même via sendPushUnified qui gère l'absence
      // de token sans erreur (skip silencieux), pour rester valide si l'utilisateur a
      // en fait un token d'un autre device où la permission est active.
      await sendPushUnified({
        userIds: [user._id],
        title,
        body,
        data: { kind: 'at_risk_reactivation', url: 'loocateme://settings/permissions' },
      });
      await User.updateOne({ _id: user._id }, { $set: { atRiskNudgeSentAt: now } });
      sent += 1;
    } catch (err) {
      console.error(`[churnRisk] Failed to send at-risk nudge to user ${user._id}:`, err);
    }
  }
  return sent;
}

/**
 * Rapport de corrélation "type de notification -> désinstallation", sur les
 * `windowDays` derniers jours. `uninstalledAt`/`lastNotificationKindBeforeUninstall`
 * sont posés best-effort par push.service.js à réception d'un ticket Expo
 * "DeviceNotRegistered". Sert à calibrer le plafond hebdomadaire de nudges
 * (PremiumNudgeService côté app) avec de la donnée plutôt qu'une estimation.
 */
export async function getUninstallCorrelationReport(windowDays = 30) {
  const since = new Date(Date.now() - windowDays * DAY_MS);
  const rows = await User.aggregate([
    { $match: { uninstalledAt: { $gte: since } } },
    {
      $group: {
        _id: '$lastNotificationKindBeforeUninstall',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);
  return rows.map((r) => ({ notificationKind: r._id || 'unknown', uninstallCount: r.count }));
}
