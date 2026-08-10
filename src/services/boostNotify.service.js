import { redisClient } from '../config/redis.js';
import { processUltraBoostBroadcast } from './ultraBoost.service.js';
import { processEventBoostBroadcast } from './eventBoost.service.js';

const BOOST_COOLDOWN_SECONDS = 4 * 60 * 60;

// Anti-spam : un même utilisateur ne reçoit pas plus d'un push d'un même lieu
// (ultra_boost ou event_boost confondus) sur cette fenêtre, même si le lieu
// relance plusieurs boosts dans la journée. SETNX Redis plutôt que le modèle
// NotificationDedup (Mongo, utilisé pour social_click/profile_view) : ici la
// cible est un lieu et non un autre utilisateur, ce qui ne correspond pas au
// schéma (targetUser, viewerUser) de ce modèle.
export async function filterBoostCooldown(userIds, locationId) {
  const results = await Promise.all(
    userIds.map(async (userId) => {
      const key = `boost_notify:${locationId}:${userId}`;
      try {
        const ok = await redisClient.set(key, '1', { NX: true, EX: BOOST_COOLDOWN_SECONDS });
        return ok ? userId : null;
      } catch (e) {
        // Redis indisponible : on notifie plutôt que de bloquer tout le fan-out silencieusement.
        return userId;
      }
    })
  );
  return results.filter(Boolean);
}

// Point d'entrée du worker BullMQ (queue 'boost-notify', cf. config/queue.js
// et server.js#startBoostNotifyWorker) : sort le fan-out push des boosts pro
// du cycle requête/réponse HTTP de businessBoost.controller.js.
export async function processBoostNotifyJob(data) {
  if (data?.type === 'event_boost') return processEventBoostBroadcast(data);
  return processUltraBoostBroadcast(data);
}
