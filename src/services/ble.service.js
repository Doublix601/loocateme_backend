import crypto from 'crypto';
import { redisClient } from '../config/redis.js';
import { User } from '../models/User.js';
import { BleSighting } from '../models/BleSighting.js';

// Token éphémère annoncé par le téléphone via BLE advertising, à la place de
// l'ID utilisateur en clair (évite qu'un tiers puisse pister un utilisateur
// via un identifiant Bluetooth stable). Rotation forcée toutes les 10 min :
// le client relance /user/ble-token avant expiration.
const TOKEN_TTL_S = 10 * 60;
const SIGHTING_FRESHNESS_MS = 5 * 60 * 1000;
const SIGHTING_TTL_MS = 30 * 60 * 1000;
// Seuil RSSI approximatif correspondant à quelques mètres en environnement
// intérieur (valeur empirique, dépend du matériel — volontairement permissif
// pour ne pas manquer de vraies proximités, le tie-break GPS reste le filet
// de sécurité principal).
const MIN_RSSI = -85;
const MAX_SIGHTINGS_PER_REQUEST = 50;

function tokenKey(token) {
  return `ble:token:${token}`;
}

export async function requireBluetoothOptIn(userId) {
  const user = await User.findById(userId).select('privacyPreferences.bluetoothProximity');
  if (!user?.privacyPreferences?.bluetoothProximity) {
    throw Object.assign(new Error("Proximité Bluetooth non activée par l'utilisateur"), {
      status: 403,
      code: 'BLE_OPT_IN_REQUIRED',
    });
  }
}

// Génère (ou renouvelle) le token éphémère que l'app doit diffuser en
// advertising BLE. Le mapping token -> userId vit uniquement dans Redis avec
// TTL, jamais persisté en base.
export async function issueBleToken(userId) {
  await requireBluetoothOptIn(userId);
  const token = crypto.randomBytes(12).toString('base64url');
  await redisClient.set(tokenKey(token), String(userId), { EX: TOKEN_TTL_S });
  return { token, expiresInSeconds: TOKEN_TTL_S };
}

// Reçoit un lot de détections BLE (peer token + RSSI) capturées par le
// téléphone, y compris pendant une coupure réseau (l'app les met en file et
// les envoie dès que la connexion revient). Résout chaque token en userId
// via Redis, ignore les tokens expirés/inconnus et les auto-détections.
export async function reportBleSightings(userId, sightings) {
  await requireBluetoothOptIn(userId);
  const list = Array.isArray(sightings) ? sightings.slice(0, MAX_SIGHTINGS_PER_REQUEST) : [];
  if (!list.length) return { recorded: 0 };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SIGHTING_TTL_MS);
  let recorded = 0;

  for (const s of list) {
    const token = String(s?.token || '');
    const rssi = Number(s?.rssi);
    if (!token || !Number.isFinite(rssi) || rssi < MIN_RSSI) continue;

    const peerUserId = await redisClient.get(tokenKey(token));
    if (!peerUserId || peerUserId === String(userId)) continue;

    const seenAt = s?.seenAt ? new Date(s.seenAt) : now;
    if (Number.isNaN(seenAt.getTime())) continue;

    await BleSighting.updateOne(
      { userId, peerUserId },
      { $set: { rssi, seenAt, expiresAt }, $setOnInsert: { userId, peerUserId } },
      { upsert: true }
    );
    recorded += 1;
  }

  return { recorded };
}

async function getFreshSightingsSortedByRssi(userId) {
  const freshThreshold = new Date(Date.now() - SIGHTING_FRESHNESS_MS);
  return BleSighting.find({ userId, seenAt: { $gte: freshThreshold } })
    .select('peerUserId rssi')
    .sort({ rssi: -1 })
    .lean();
}

// Utilisé par user.service.js pour départager deux lieux candidats trop
// proches (< MIN_LEAD_M) lors d'un heartbeat GPS ambigu : si l'utilisateur a
// une détection BLE fraîche d'un pair déjà confirmé (`currentLocation`) sur
// l'un des candidats, on retient ce candidat plutôt que d'attendre un
// heartbeat de confirmation supplémentaire.
export async function resolveAmbiguousVenueViaBle(userId, candidateLocationIds) {
  if (!candidateLocationIds?.length) return null;
  const user = await User.findById(userId).select('privacyPreferences.bluetoothProximity');
  if (!user?.privacyPreferences?.bluetoothProximity) return null;

  const sightings = await getFreshSightingsSortedByRssi(userId);
  if (!sightings.length) return null;

  const peerIds = sightings.map((s) => s.peerUserId);
  const peers = await User.find({ _id: { $in: peerIds }, currentLocation: { $in: candidateLocationIds } })
    .select('currentLocation')
    .lean();
  if (!peers.length) return null;

  // Le pair avec le meilleur RSSI (le plus proche) tranche.
  const peerById = new Map(peers.map((p) => [String(p._id), p.currentLocation]));
  for (const s of sightings) {
    const loc = peerById.get(String(s.peerUserId));
    if (loc) return loc;
  }
  return null;
}

// Cas "wifi mais pas de GPS" (sous-sol avec réseau, satellites bloqués) :
// sans aucune coordonnée du tout, impossible de générer des lieux candidats
// GPS pour resolveAmbiguousVenueViaBle. On se rabat sur les seuls pairs
// détectés en BLE, sans filtrage de distance côté serveur — le filtrage
// physique est déjà fait par la portée réelle du signal BLE (quelques
// mètres). Retourne le lieu du pair au meilleur RSSI déjà confirmé quelque
// part, ou null si aucun pair fiable n'est actuellement à portée.
export async function resolveVenueFromBlePeersOnly(userId) {
  const user = await User.findById(userId).select('privacyPreferences.bluetoothProximity');
  if (!user?.privacyPreferences?.bluetoothProximity) return null;

  const sightings = await getFreshSightingsSortedByRssi(userId);
  if (!sightings.length) return null;

  const peerIds = sightings.map((s) => s.peerUserId);
  const peers = await User.find({ _id: { $in: peerIds }, currentLocation: { $ne: null } })
    .select('currentLocation')
    .lean();
  if (!peers.length) return null;

  const peerById = new Map(peers.map((p) => [String(p._id), p.currentLocation]));
  for (const s of sightings) {
    const loc = peerById.get(String(s.peerUserId));
    if (loc) return loc;
  }
  return null;
}
