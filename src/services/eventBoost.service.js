import { User } from '../models/User.js';
import { Location } from '../models/Location.js';
import { Event } from '../models/Event.js';
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
// répondre immédiatement à activateEventBoost — le fan-out réel est fait de
// façon asynchrone par processEventBoostBroadcast (cf. worker boost-notify).
export async function estimateEventBoostRecipients(location) {
  return User.countDocuments(nearbyActiveUsersFilter(location));
}

export async function enqueueEventBoostBroadcast(location, event) {
  await boostNotifyQueue.add('event_boost', {
    type: 'event_boost',
    locationId: String(location._id),
    eventId: String(event._id),
  });
}

// Exécuté par le worker BullMQ (hors cycle requête/réponse) : diffuse
// l'annonce d'un événement existant (cf. Location.events, créé indépendamment
// via businessProfile.controller.js#addEvent) à tous les utilisateurs dans un
// rayon de 30km autour du lieu, sans plafond de destinataires. Réservé au
// palier pro3 (vérifié en amont dans businessBoost.controller.js). Traité par
// lots (curseur Mongo) pour rester borné en mémoire même en zone très dense.
// Pas de filtre sur privacyPreferences.marketing : il s'agit d'une
// notification de proximité géographique, pas d'une publicité ciblée par
// centre d'intérêt.
export async function processEventBoostBroadcast({ locationId, eventId }) {
  const location = await Location.findById(locationId).select('location name events').lean();
  if (!location) return { recipients: 0 };
  const event = (location.events || []).find((e) => String(e._id) === String(eventId));
  if (!event) return { recipients: 0 };

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
      title: `📅 ${event.title} — ${location.name}`,
      body: event.body,
      data: {
        kind: 'event_boost',
        locationId: String(location._id),
        eventId: String(event._id),
        eventDate: event.eventDate || null,
      },
    });
    totalSent += eligible.length;
  };

  for await (const doc of cursor) {
    batch.push(doc._id);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  await Event.create({
    type: 'event_boost_sent',
    locationId: location._id,
    meta: { eventId: String(event._id), title: event.title, recipientCount: totalSent, eventDate: event.eventDate || null },
  });

  return { recipients: totalSent };
}
