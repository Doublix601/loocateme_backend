import { User } from '../models/User.js';
import { Location } from '../models/Location.js';
import { sendPushUnified } from './push.service.js';
import { filterBoostCooldown } from './boostNotify.service.js';
import { boostNotifyQueue } from '../config/queue.js';

const RADIUS_METERS = 30 * 1000;
const RECENTLY_ACTIVE_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

function nearbyActiveUsersFilter(location) {
  return {
    location: { $near: { $geometry: location.location, $maxDistance: RADIUS_METERS } },
    status: { $ne: 'red' },
    'location.updatedAt': { $gte: new Date(Date.now() - RECENTLY_ACTIVE_MS) },
  };
}

// Estimation rapide (comptage seul, sans résolution de tokens) utilisée pour
// répondre immédiatement à activateUltraBoost — le fan-out réel est fait de
// façon asynchrone par processUltraBoostBroadcast (cf. worker boost-notify).
export async function estimateUltraBoostRecipients(location) {
  return User.countDocuments(nearbyActiveUsersFilter(location));
}

export async function enqueueUltraBoostBroadcast(location) {
  await boostNotifyQueue.add('ultra_boost', {
    type: 'ultra_boost',
    locationId: String(location._id),
  });
}

// Exécuté par le worker BullMQ (hors cycle requête/réponse) : diffuse
// l'invitation "boost gratuit" à tous les utilisateurs dans un rayon de 30km
// autour du lieu, sans plafond de destinataires. Traité par lots (curseur
// Mongo) pour rester borné en mémoire même en zone très dense.
export async function processUltraBoostBroadcast({ locationId }) {
  const location = await Location.findById(locationId).select('location name').lean();
  if (!location) return { recipients: 0 };

  const cursor = User.find(nearbyActiveUsersFilter(location)).select('_id').lean().cursor();

  let batch = [];
  let totalSent = 0;
  const flush = async () => {
    if (!batch.length) return;
    const ids = batch;
    batch = [];
    const eligible = await filterBoostCooldown(ids, locationId);
    if (!eligible.length) return;
    await sendPushUnified({
      userIds: eligible,
      title: `🔥 Boost gratuit chez ${location.name}`,
      body: 'Passe 20 minutes sur place pour débloquer un boost de profil gratuit !',
      data: { kind: 'ultra_boost', locationId: String(location._id) },
    });
    totalSent += eligible.length;
  };

  for await (const doc of cursor) {
    batch.push(doc._id);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  return { recipients: totalSent };
}
