import { User } from '../models/User.js';
import { sendPushUnified } from './push.service.js';

const RADIUS_METERS = 30 * 1000;
const MAX_RECIPIENTS = 5000; // cap anti-abus : évite un pic de coût push en zone dense
const RECENTLY_ACTIVE_MS = 24 * 60 * 60 * 1000;

// Diffuse une invitation "boost gratuit" à tous les utilisateurs dans un rayon
// de 30km autour du lieu, sur le modèle de la notification "reste 20 min sur
// place" déjà utilisée pour le boost individuel (premium.controller.js:activateBoost) —
// seule la portée du déclenchement change (broadcast au lieu d'un ciblage unique).
export async function broadcastUltraBoost(location) {
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
    title: `🔥 Boost gratuit chez ${location.name}`,
    body: 'Passe 20 minutes sur place pour débloquer un boost de profil gratuit !',
    data: { kind: 'ultra_boost', locationId: String(location._id) },
  });

  return { recipients: users.length };
}
