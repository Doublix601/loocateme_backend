import { User } from '../models/User.js';
import { sendPushUnified } from './push.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Paliers de la séquence d'onboarding : le churn le plus fort se joue dans les
// premiers jours suivant l'inscription, avant que les mécaniques réactives
// (nudge d'inactivité, cote) n'aient l'occasion de s'enclencher. On pousse donc
// la valeur de l'app de façon proactive plutôt que d'attendre le décrochage.
const STEPS = [
  {
    day: 1,
    title: 'Ton profil est en ligne 👋',
    body: 'Découvre qui se trouve autour de toi en ce moment.',
    url: 'loocateme://nearby',
  },
  {
    day: 3,
    title: 'Tu n\'as pas encore tout vu 🔍',
    body: 'Ajoute tes réseaux sociaux et complète ton profil pour être plus visible.',
    url: 'loocateme://profile/edit',
  },
  {
    day: 7,
    title: 'Une semaine sur LoocateMe 🚀',
    body: 'Découvre la Cote : plus tu es actif, plus tu montes dans les classements des lieux.',
    url: 'loocateme://statistics',
  },
];

function calendarDayGap(from, to) {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((toDay - fromDay) / DAY_MS);
}

/**
 * Envoie le palier d'onboarding (J1/J3/J7) dû aujourd'hui à chaque utilisateur
 * dont le compte a l'ancienneté correspondante et qui ne l'a pas déjà reçu.
 * Idempotent : `onboardingPushDaysSent` empêche tout renvoi.
 */
export async function sendOnboardingSequence(now = new Date()) {
  let sent = 0;
  for (const step of STEPS) {
    const dayFloor = new Date(now.getTime() - (step.day + 1) * DAY_MS);
    const dayCeil = new Date(now.getTime() - (step.day - 1) * DAY_MS);

    const users = await User.find({
      createdAt: { $gte: dayFloor, $lte: dayCeil },
      onboardingPushDaysSent: { $ne: step.day },
      accountType: 'individual',
    })
      .select('_id createdAt')
      .lean();

    for (const user of users) {
      if (calendarDayGap(new Date(user.createdAt), now) !== step.day) continue;
      try {
        await sendPushUnified({
          userIds: [user._id],
          title: step.title,
          body: step.body,
          data: { kind: `onboarding_day${step.day}`, url: step.url },
        });
        await User.updateOne({ _id: user._id }, { $addToSet: { onboardingPushDaysSent: step.day } });
        sent += 1;
      } catch (err) {
        console.error(`[onboarding] Failed to send day-${step.day} push to user ${user._id}:`, err);
      }
    }
  }
  return sent;
}
