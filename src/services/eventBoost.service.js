import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { sendPushUnified } from './push.service.js';

const RADIUS_METERS = 30 * 1000;
const MAX_RECIPIENTS = 5000; // cap anti-abus : évite un pic de coût push en zone dense
const RECENTLY_ACTIVE_MS = 24 * 60 * 60 * 1000;

// Diffuse l'annonce d'un événement existant (cf. Location.events, créé
// indépendamment via businessProfile.controller.js#addEvent) à tous les
// utilisateurs dans un rayon de 30km autour du lieu, sur le même ciblage géo
// que broadcastUltraBoost (ultraBoost.service.js). Réservé au palier pro3,
// 1 crédit inclus/mois + achat à l'unité (cf. businessBoost.controller.js /
// constants/boosts.js). L'Event Boost ne fait qu'envoyer la notification :
// il ne crée ni ne modifie le contenu de l'événement.
// Pas de filtre sur privacyPreferences.marketing : il s'agit d'une notification
// de proximité géographique, pas d'une publicité ciblée par centre d'intérêt.
export async function broadcastEventBoost(location, event) {
  const users = await User.find({
    location: { $near: { $geometry: location.location, $maxDistance: RADIUS_METERS } },
    status: { $ne: 'red' },
    'location.updatedAt': { $gte: new Date(Date.now() - RECENTLY_ACTIVE_MS) },
  })
    .select('_id')
    .limit(MAX_RECIPIENTS)
    .lean();

  if (!users.length) return { recipients: 0 };

  await sendPushUnified({
    userIds: users.map((u) => u._id),
    title: `📅 ${event.title} — ${location.name}`,
    body: event.body,
    data: {
      kind: 'event_boost',
      locationId: String(location._id),
      eventId: String(event._id),
      eventDate: event.eventDate || null,
    },
  });

  await Event.create({
    type: 'event_boost_sent',
    locationId: location._id,
    meta: { eventId: String(event._id), title: event.title, recipientCount: users.length, eventDate: event.eventDate || null },
  });

  return { recipients: users.length };
}
