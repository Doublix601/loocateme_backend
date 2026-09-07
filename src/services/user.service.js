import { User } from '../models/User.js';
import { Superlike } from '../models/Superlike.js';
import { Location } from '../models/Location.js';
import { Event } from '../models/Event.js';
import { redisClient } from '../config/redis.js';
import { sendPushUnified } from './push.service.js';
import { NotificationDedup } from '../models/NotificationDedup.js';
import { singleflightRedis } from '../utils/singleflight.js';
import { recordCrossedPaths } from './crossedPaths.service.js';
import { debugLog } from '../utils/logger.js';
import { haversineMeters } from '../utils/geo.js';
import { buildDiacriticRegex } from '../utils/text.js';
import { maybeRefreshCity } from './geocoding.service.js';
import { invalidateLocationDetailCache, invalidateLocationsListCache } from '../utils/locationCache.js';
import { STALE_PRESENCE_THRESHOLD_MS, PRESENCE_FRESHNESS_MS } from '../config/presenceWindows.js';

// Cache très court des candidats POI proches (geoNear 200m) pour le heartbeat.
// TTL volontairement court (3s, pas 10s comme /api/locations) : cette liste
// sert à détecter l'entrée/sortie d'un lieu en temps réel, la précision prime
// sur le taux de cache hit ici. Rounding à 4 décimales (~11m) reste dans le
// même ordre de grandeur que le bruit GPS (±15m) déjà toléré par la logique
// d'hystérésis plus bas (MIN_LEAD_M), donc n'introduit pas d'imprécision
// nouvelle significative — mais absorbe les rafales de heartbeats simultanés
// dans un lieu dense (ex: tout le monde dans le même bar).
const POI_CANDIDATES_CACHE_TTL_SECONDS = 3;

async function readPoiCandidatesCache(cacheKey) {
  const cached = await redisClient.get(cacheKey);
  return cached ? JSON.parse(cached) : null;
}

async function getNearbyPoiCandidates(lat, lon) {
  const cacheKey = `poi-candidates:v1:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  try {
    const cached = await readPoiCandidatesCache(cacheKey);
    if (cached) return cached;
  } catch {}

  // Cross-process (verrou Redis) : évite qu'un pic simultané dans une zone
  // dense (ex: un bar plein un samedi soir) déclenche jusqu'à 3 agrégations
  // Mongo identiques en parallèle, une par worker PM2.
  return singleflightRedis(
    cacheKey,
    async () => {
      const geoNearResult = await Location.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lon, lat] },
            distanceField: 'dist',
            maxDistance: 200,
            spherical: true,
          },
        },
        { $limit: 5 },
      ]);
      try {
        await redisClient.set(cacheKey, JSON.stringify(geoNearResult), { EX: POI_CANDIDATES_CACHE_TTL_SECONDS });
      } catch {}
      return geoNearResult;
    },
    { readCache: () => readPoiCandidatesCache(cacheKey) }
  );
}

export const MIN_STAY_MS = 5 * 60 * 1000; // 5 minutes minimum pour être comptabilisé
const ULTRA_BOOST_CLAIM_MS = 20 * 60 * 1000; // 20 minutes, cf. texte du push dans ultraBoost.service.js
const FREE_BOOST_DURATION_MS = 30 * 60 * 1000; // même durée que le boost payant (premium.controller.js)

const GEO_CACHE_TTL = 5; // seconds

// Un utilisateur banni (temporairement ou définitivement) ne doit jamais être
// visible pour les autres : ni dans la recherche, ni dans les listes "à
// proximité"/populaires, ni parmi les présences affichées sur un lieu. Le ban
// bloque déjà ses propres requêtes (cf. middlewares/auth.js) mais ça ne
// suffit pas à le cacher des autres utilisateurs.
export function applyNotBannedFilter(query, now = new Date()) {
  query['moderation.bannedPermanent'] = { $ne: true };
  const banClause = {
    $or: [
      { 'moderation.bannedUntil': { $exists: false } },
      { 'moderation.bannedUntil': null },
      { 'moderation.bannedUntil': { $lte: now } },
    ],
  };
  if (query.$or) {
    query.$and = [...(query.$and || []), { $or: query.$or }, banClause];
    delete query.$or;
  } else if (query.$and) {
    query.$and.push(banClause);
  } else {
    query.$or = banClause.$or;
  }
  return query;
}

export function isUserBanned(user) {
  if (!user) return false;
  const mod = user.moderation;
  if (!mod) return false;
  if (mod.bannedPermanent) return true;
  if (mod.bannedUntil && new Date(mod.bannedUntil).getTime() > Date.now()) return true;
  return false;
}

export async function getBlockedIds(userId) {
  if (!userId) return [];
  try {
    const [me, blockedBy] = await Promise.all([
      User.findById(userId).select('blockedUsers').lean(),
      User.find({ blockedUsers: userId }).select('_id').lean(),
    ]);
    const blocked = Array.isArray(me?.blockedUsers) ? me.blockedUsers.map((id) => id.toString()) : [];
    const blockedByIds = Array.isArray(blockedBy) ? blockedBy.map((u) => String(u._id)) : [];
    return Array.from(new Set([...blocked, ...blockedByIds]));
  } catch {
    return [];
  }
}

// A mutual connection exists once one side has superliked the other and the
// recipient has validated it (see PremiumController.acceptSuperlike). It
// overrides the normal orange/red status gating on social network visibility.
export async function computeMutualConnection(userId, otherId) {
  if (!userId || !otherId || String(userId) === String(otherId)) return false;
  const exists = await Superlike.exists({
    status: 'accepted',
    $or: [
      { sender: userId, target: otherId },
      { sender: otherId, target: userId },
    ],
  });
  return !!exists;
}

export async function getUserByIdForViewer({ userId, targetId }) {
  if (!targetId) return null;
  const target = await User.findById(targetId)
    .select('-password')
    .populate('currentLocation', 'name city')
    .lean();
  if (!target) return null;
  if (String(userId) !== String(targetId)) {
    if (target.status === 'red' || target.emailVerified === false) return null;
    if (isUserBanned(target)) return null;
    const blockedIds = await getBlockedIds(userId);
    if (blockedIds.includes(String(targetId))) return null;
    target.mutualConnection = await computeMutualConnection(userId, targetId);
    // Lieu précis (au-delà de la ville) : donnée sensible, exposée à des tiers
    // uniquement si explicitement partagée via privacyPreferences.shareCurrentLocation.
    if (!target.privacyPreferences?.shareCurrentLocation) {
      target.currentLocation = null;
      target.currentLocationSince = null;
    }
  }
  return target;
}

export async function getUserByEmail(email) {
  const user = await User.findOne({ email }).select('-password');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
}

export async function getUsersByEmails(emails) {
  const unique = Array.from(new Set(emails));
  const users = await User.find({ email: { $in: unique } }).select('-password').lean();
  return users;
}

const FORCE_CHECKIN_MAX_M = 100;

// Force le check-in de l'utilisateur sur un lieu précis, en bypassant le
// matching/hystérésis normal. Utilisé quand l'utilisateur constate que le
// lieu auto-détecté est erroné et en choisit un autre à proximité (≤ 100 m).
//
// `bypassDistance` lève la contrainte des 100 m. Ce flag n'est envoyé que par
// les builds de dev de l'app (gating fait côté client via __DEV__) — il n'y a
// pas de notion dev/prod côté serveur pour l'instant (un seul environnement).
export async function forceCheckIn(userId, { locationId, lat, lon, bypassDistance, mode }) {
  // Capturé avant tout traitement async : sert de garde d'ordre ci-dessous pour
  // qu'un double tap rapide sur deux lieux différents ne puisse jamais faire
  // "gagner" la requête la plus ancienne juste parce qu'elle termine après
  // l'autre (ex: son Location.findById est plus lent).
  const requestStartedAt = Date.now();

  const existingUser = await User.findById(userId).select('boostUntil currentLocation');
  if (existingUser?.boostUntil && existingUser.boostUntil > new Date()) {
    throw Object.assign(new Error('Boost actif : impossible de changer de lieu tant que le boost est en cours.'), {
      status: 409,
      code: 'BOOST_ACTIVE',
    });
  }

  const location = await Location.findById(locationId).select('location');
  if (!location) throw Object.assign(new Error('Location not found'), { status: 404 });

  const [locLon, locLat] = location.location.coordinates;
  const distance = haversineMeters(lat, lon, locLat, locLon);
  if (distance > FORCE_CHECKIN_MAX_M && bypassDistance !== true) {
    throw Object.assign(new Error('Trop loin du lieu sélectionné'), { status: 400 });
  }

  // findOneAndUpdate avec filtre sur lastForceCheckInRequestAt : si une requête
  // de check-in démarrée APRÈS celle-ci a déjà écrit (cas classique du double
  // tap rapide sur deux lieux), ce filtre ne matche plus rien et l'écriture est
  // silencieusement ignorée au lieu d'écraser le résultat plus récent.
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [{ lastForceCheckInRequestAt: null }, { lastForceCheckInRequestAt: { $lte: requestStartedAt } }],
    },
    {
      $set: {
        location: { type: 'Point', coordinates: [lon, lat], updatedAt: new Date() },
        currentLocation: locationId,
        currentLocationSince: new Date(),
        pendingLocation: null,
        pendingLocationSince: null,
        boostUntil: null,
        // Trace le mode du dernier check-in ('manual' si l'utilisateur a
        // explicitement choisi ce lieu, 'auto' par défaut) : sert de
        // distinction analytics/crédit de streak, sans impact sur la
        // validation de distance ci-dessus (toujours ≤ FORCE_CHECKIN_MAX_M
        // sauf bypassDistance).
        lastCheckInMode: mode === 'manual' ? 'manual' : 'auto',
        lastForceCheckInRequestAt: requestStartedAt,
      },
    },
    { new: true }
  );

  if (!user) {
    // Soit l'utilisateur n'existe pas, soit (cas normal du double tap) une
    // requête plus récente a déjà gagné : dans ce dernier cas on renvoie
    // l'état actuel (déjà correct) plutôt qu'une erreur.
    const current = await User.findById(userId);
    if (!current) throw Object.assign(new Error('User not found'), { status: 404 });
    return current;
  }

  // Sans ça, le userCount de l'ancien ET du nouveau lieu restent servis depuis
  // le cache `locations:v1:*` (TTL 60s) le temps que le client rafraîchisse,
  // donnant l'impression que l'utilisateur est resté sur l'ancien lieu.
  await invalidateLocationsListCache();
  await invalidateLocationDetailCache(existingUser?.currentLocation);
  await invalidateLocationDetailCache(locationId);

  return user;
}

// Force le check-out de l'utilisateur, sans passer par le heartbeat GPS.
// Appelé uniquement par les builds de dev de l'app (gating côté client).
export async function forceCheckOut(userId) {
  const requestStartedAt = Date.now();

  const existingUser = await User.findById(userId).select('boostUntil currentLocation');
  if (existingUser?.boostUntil && existingUser.boostUntil > new Date()) {
    throw Object.assign(new Error('Boost actif : impossible de se check-out tant que le boost est en cours.'), {
      status: 409,
      code: 'BOOST_ACTIVE',
    });
  }

  // Même garde d'ordre que forceCheckIn (cf. commentaire là-bas) : un check-out
  // ne doit pas écraser un check-in manuel démarré après lui.
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [{ lastForceCheckInRequestAt: null }, { lastForceCheckInRequestAt: { $lte: requestStartedAt } }],
    },
    {
      $set: {
        currentLocation: null,
        currentLocationSince: null,
        pendingLocation: null,
        pendingLocationSince: null,
        lastForceCheckInRequestAt: requestStartedAt,
      },
    },
    { new: true }
  );

  if (!user) {
    const current = await User.findById(userId);
    if (!current) throw Object.assign(new Error('User not found'), { status: 404 });
    return current;
  }

  await invalidateLocationsListCache();
  await invalidateLocationDetailCache(existingUser?.currentLocation);

  return user;
}

// Seuil au-delà duquel une présence est considérée "fantôme" : le heartbeat
// GPS (foreground, cf. usePresence.js) s'arrête dès que l'app quitte l'état
// 'active', et le relais censé prendre le relai en arrière-plan (5 min
// d'intervalle) peut être suspendu par l'OS lors d'un verrouillage d'écran
// prolongé — sans qu'aucun check-out explicite ne soit jamais envoyé. Sans
// filet de sécurité serveur, le check-in reste alors bloqué indéfiniment.
// Seuil fixé à 4x l'intervalle du heartbeat d'arrière-plan pour absorber les
// retards de livraison OS normaux sans faux positifs (cf.
// config/presenceWindows.js pour sa relation avec les autres fenêtres de
// fraîcheur de présence : cache liste/détail, filtre "qui est ici").

// Check-out automatique des utilisateurs dont la présence n'a plus été
// rafraîchie depuis STALE_PRESENCE_THRESHOLD_MS (cf. cron.service.js).
// Les utilisateurs avec un boost actif sont exclus : rester "présent" sans
// heartbeat pendant un boost est le comportement voulu (cf. updateLocation).
// Les utilisateurs en mode de check-in MANUEL sont exclus : par design lapp
// nenvoie plus aucun heartbeat GPS dans ce mode (cf. app usePresence.js,
// LocationService.js, BackgroundLocation.js) et lutilisateur pilote sa
// presence via les boutons Je suis la / Je ne suis plus ici. Les auto-
// checkout ici les sortaient de leur lieu apres ~20 min avec une notif
// Check-out automatique trompeuse. Filet restant : forceCheckOut() client a 6h.
export async function expireStalePresence() {
  const threshold = new Date(Date.now() - STALE_PRESENCE_THRESHOLD_MS);

  const staleUsers = await User.find({
    currentLocation: { $ne: null },
    checkInMode: { $ne: 'manual' },
    $and: [
      { $or: [{ boostUntil: null }, { boostUntil: { $lte: new Date() } }] },
      { $or: [{ 'location.updatedAt': { $lt: threshold } }, { 'location.updatedAt': { $exists: false } }] },
    ],
  }).select('_id currentLocation');

  if (!staleUsers.length) return { count: 0, userIds: [] };

  const staleLocationIds = [...new Set(staleUsers.map((u) => String(u.currentLocation)))];

  await User.updateMany(
    {
      _id: { $in: staleUsers.map((u) => u._id) },
      // Revérifie la fraîcheur au moment de l'écriture (et non seulement au
      // moment du find ci-dessus) : évite d'écraser un check-in/heartbeat
      // arrivé entre-temps pendant la fenêtre du cron.
      $or: [{ 'location.updatedAt': { $lt: threshold } }, { 'location.updatedAt': { $exists: false } }],
    },
    {
      $set: {
        currentLocation: null,
        currentLocationSince: null,
        pendingLocation: null,
        pendingLocationSince: null,
      },
    }
  );

  await invalidateLocationsListCache();
  for (const locationId of staleLocationIds) {
    await invalidateLocationDetailCache(locationId);
  }

  return { count: staleUsers.length, userIds: staleUsers.map((u) => u._id) };
}

// Fenêtre pendant laquelle un check-in manuel ('je suis là') est protégé
// contre un heartbeat GPS qui matcherait un autre lieu (typiquement : le
// heartbeat suivant arrive avant que l'utilisateur ait physiquement bougé,
// et le lieu le plus proche reste l'ancien). Sans ça, le choix explicite de
// l'utilisateur est écrasé quelques secondes après par le heartbeat normal.
const MANUAL_CHECKIN_GRACE_MS = 5 * 60 * 1000;

export async function updateLocation(userId, { lat, lon }) {
  // Même garde d'ordre que forceCheckIn/forceCheckOut (cf. commentaire là-bas) :
  // un heartbeat GPS "normal" peut être en vol pile au moment d'un check-in
  // manuel (ex: watcher usePresence qui se déclenche indépendamment). Sans
  // garde, ce heartbeat — parti avant le check-in mais dont l'agrégation
  // Mongo/geoNear prend quelques centaines de ms — peut terminer et écrire
  // APRÈS le check-in manuel, écrasant le lieu choisi par l'utilisateur en
  // quelques centaines de ms à peine.
  const requestStartedAt = Date.now();

  const userToUpdate = await User.findById(userId).select('currentLocation pendingLocation pendingLocationSince currentLocationSince location boostUntil lastCheckInMode');
  if (!userToUpdate) throw Object.assign(new Error('User not found'), { status: 404 });

  const oldLocationId = userToUpdate.currentLocation;
  const oldPendingLocationId = userToUpdate.pendingLocation;
  const oldPendingSince = userToUpdate.pendingLocationSince;
  const oldCurrentLocationSince = userToUpdate.currentLocationSince;
  const oldLocation = userToUpdate.location || { type: 'Point', coordinates: [0, 0] };
  const hasActiveBoost = userToUpdate.boostUntil && userToUpdate.boostUntil > new Date();
  const isWithinManualCheckInGrace =
    oldLocationId &&
    userToUpdate.lastCheckInMode === 'manual' &&
    oldCurrentLocationSince &&
    Date.now() - new Date(oldCurrentLocationSince).getTime() < MANUAL_CHECKIN_GRACE_MS;

  // Utilisation de l'agrégation pour obtenir les distances exactes et gérer le rayon par lieu
  const geoNearResult = await getNearbyPoiCandidates(lat, lon);

  const MAX_RADIUS = 50; // Cap global — overrides stale DB entries with larger values
  // Avantage minimal (en mètres) que le lieu le plus proche doit avoir sur le
  // second pour déclencher une nouvelle entrée. Évite les faux check-ins causés
  // par l'imprécision GPS (~±15 m) lorsque deux lieux adjacents ont des centres
  // séparés de moins de 40–50 m (ex : Nevermind vs Bakin Donuts côte à côte).
  const MIN_LEAD_M = 12;
  let matchedLocationId = null;
  let pendingLocationId = null;
  if (geoNearResult.length > 0) {
    // 1. Logique d'hystérésis : si l'utilisateur était déjà dans un lieu, on vérifie s'il y est encore
    const oldLocationInList = oldLocationId ? geoNearResult.find(p => String(p._id) === String(oldLocationId)) : null;

    if (oldLocationInList && oldLocationInList.dist <= Math.min(oldLocationInList.radius || MAX_RADIUS, MAX_RADIUS) * 1.1) {
      matchedLocationId = oldLocationId;
    } else {
      // 2. Sinon, on prend le plus proche, s'il est dans son rayon de détection.
      //    Pour éviter les confusions entre lieux adjacents, on exige que le gagnant
      //    soit au moins MIN_LEAD_M plus proche que le second candidat (sauf s'il
      //    est le seul résultat dans le rayon).
      const nearest = geoNearResult[0];
      const effectiveRadius = Math.min(nearest.radius || MAX_RADIUS, MAX_RADIUS);
      if (nearest.dist <= effectiveRadius) {
        const second = geoNearResult[1];
        const hasMinLead = !second || (second.dist - nearest.dist) >= MIN_LEAD_M;
        if (hasMinLead) {
          matchedLocationId = nearest._id;
        } else {
          // Ambiguïté GPS (deux lieux trop proches) : on ne matche pas
          // immédiatement, on attend un heartbeat de confirmation.
          if (oldPendingLocationId && String(oldPendingLocationId) === String(nearest._id)) {
            // Ambiguïté persistante (lieux trop proches, ex: deux POIs à 7 m l'un de
            // l'autre) mais ce même lieu ressort déjà comme le plus proche au heartbeat
            // précédent : ça n'est pas du bruit GPS ponctuel, on confirme l'entrée.
            // Coûte un cycle de heartbeat (quelques secondes à ~1 min), au lieu de
            // bloquer indéfiniment le check-in tant que les deux lieux restent voisins.
            matchedLocationId = nearest._id;
          } else {
            // Premier heartbeat ambigu pour ce candidat : on le mémorise sans encore
            // matcher, pour confirmer au heartbeat suivant s'il reste le plus proche.
            pendingLocationId = nearest._id;
          }
        }
      }
    }
  }

  const update = {
    location: { type: 'Point', coordinates: [lon, lat], updatedAt: new Date() },
  };

  // Privacy: If the user is already confirmed at a POI, we avoid storing/updating raw coordinates
  // to minimize location tracking history. We only update the presence status.
  const isAlreadyConfirmedAtPOI = oldLocationId && matchedLocationId && String(oldLocationId) === String(matchedLocationId);

  if (isAlreadyConfirmedAtPOI) {
    // Data Minimization: Don't update coordinates, just update the timestamp
    update.location = { ...oldLocation, updatedAt: new Date() };
  }

  // Mise à jour quasi-instantanée de la présence : dès que l'utilisateur est
  // physiquement dans le rayon d'un POI il est compté, et dès qu'il en sort il
  // est retiré. Les champs `pendingLocation` / `pendingLocationSince` ne servent
  // plus à l'ancienne hystérésis temporelle de 2 minutes : ils mémorisent
  // seulement un candidat ambigu (deux POIs trop proches) le temps d'un
  // heartbeat, pour le confirmer au suivant (cf. boucle de matching plus haut).
  update.pendingLocation = pendingLocationId;
  update.pendingLocationSince = pendingLocationId ? new Date() : null;

  if (!matchedLocationId) {
    if (oldLocationId && hasActiveBoost) {
      // L'utilisateur a quitté le POI mais un boost est en cours : on le
      // considère toujours présent tant que le boost n'est pas expiré, pour
      // ne pas couper un boost payant en plein milieu à cause d'un départ.
      // `currentLocation`/`currentLocationSince` restent donc inchangés ici ;
      // ils seront nettoyés naturellement à l'expiration du boost (prochain
      // heartbeat une fois `hasActiveBoost` redevenu false) ou si l'utilisateur
      // entre dans un autre POI (cf. branche ci-dessous, safety check anti-ghost).
    } else if (isWithinManualCheckInGrace) {
      // Check-in manuel récent et aucun POI matché par ce heartbeat (l'utilisateur
      // n'a pas encore physiquement bougé jusqu'au lieu choisi) : on ne retire pas
      // sa présence, le temps qu'il rejoigne le lieu ou que la fenêtre expire.
    } else {
      // L'utilisateur n'est dans aucun POI → retrait immédiat
      update.currentLocation = null;
      update.currentLocationSince = null;
    }
  } else if (String(matchedLocationId) === String(oldLocationId)) {
    // L'utilisateur est déjà dans ce POI, rien à changer côté présence
    // (currentLocationSince reste inchangé)
  } else if (hasActiveBoost && oldLocationId) {
    // Un boost n'est utilisable que dans un seul lieu à la fois : tant qu'il
    // tourne, on reste verrouillé sur l'ancien lieu et on ignore le nouveau
    // match (currentLocation/currentLocationSince inchangés). L'utilisateur
    // doit laisser son boost expirer avant de "changer de lieu" côté app.
  } else if (isWithinManualCheckInGrace) {
    // L'utilisateur vient de se check-in manuellement ('je suis là') et le
    // heartbeat GPS matche un autre lieu (typiquement l'ancien, s'il n'a pas
    // encore bougé) : on ignore ce re-match pendant la fenêtre de grâce pour
    // ne pas écraser son choix explicite quelques secondes après l'avoir fait.
  } else {
    // Entrée immédiate dans le POI matché (nouveau ou différent de l'ancien)
    update.currentLocation = matchedLocationId;
    update.currentLocationSince = new Date(); // début du compteur 5 min
    // Safety check: clear boostUntil to prevent being a "Ghost" in an old Bar
    // while being "Present" in a new one.
    update.boostUntil = null;
    // Sans ça, `lastCheckInMode` restait à 'manual' indéfiniment après un
    // check-in manuel : la prochaine entrée AUTOMATIQUE (heartbeat) dans un
    // autre POI hériterait alors, à tort, de la fenêtre de grâce anti-override
    // (MANUAL_CHECKIN_GRACE_MS) alors qu'elle n'a rien de manuel.
    update.lastCheckInMode = 'auto';
    console.log(`[Presence] User ${userId} entered POI ${matchedLocationId} (instant)`);
  }
  void oldPendingSince; // plus utilisé : la confirmation ne dépend que de l'identité du candidat, pas d'un délai
  update.lastForceCheckInRequestAt = requestStartedAt;

  // findOneAndUpdate avec le même filtre d'ordre que forceCheckIn/forceCheckOut :
  // si un check-in manuel (ou un autre heartbeat) démarré APRÈS celui-ci a déjà
  // écrit, ce heartbeat "en retard" n'écrase rien — on relit juste l'état
  // actuel (déjà correct) ci-dessous.
  let user = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [{ lastForceCheckInRequestAt: null }, { lastForceCheckInRequestAt: { $lte: requestStartedAt } }],
    },
    { $set: update },
    { new: true }
  );
  if (!user) {
    user = await User.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    return user;
  }

  const currentLocationId = user.currentLocation;

  // Check-in/check-out automatique (heartbeat) : sans invalidation, le lieu
  // quitté ET le lieu rejoint restent servis depuis le cache `locations:v1:*`
  // (TTL 60s) le temps qu'il expire — l'utilisateur n'apparaît/disparaît dans
  // la pile de visiteurs qu'au bout d'~1 min au lieu d'être instantané.
  if (String(currentLocationId || '') !== String(oldLocationId || '')) {
    await invalidateLocationsListCache();
    if (oldLocationId) await invalidateLocationDetailCache(oldLocationId);
    if (currentLocationId) await invalidateLocationDetailCache(currentLocationId);
  }

  // Record a location_visit only after the user has been in the POI for at least 5 minutes.
  // - On new entry: currentLocationSince is set in `update` above → skip this block.
  // - On subsequent heartbeats (same POI): check elapsed time using oldCurrentLocationSince.
  const isStayingAtSamePOI = currentLocationId && String(currentLocationId) === String(oldLocationId);
  if (isStayingAtSamePOI && oldCurrentLocationSince) {
    const elapsedMs = Date.now() - new Date(oldCurrentLocationSince).getTime();
    if (elapsedMs >= MIN_STAY_MS) {
      try {
        // De-duplicate visits: only one visit per user/location per 12 hours
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        const existingVisit = await Event.findOne({
          type: 'location_visit',
          actor: userId,
          locationId: currentLocationId,
          createdAt: { $gt: twelveHoursAgo }
        });

        if (!existingVisit) {
          await Event.create({ type: 'location_visit', actor: userId, locationId: currentLocationId });

          // Premier check-in vérifié de ce user (tous lieux confondus) : c'est le
          // déclencheur de la récompense de parrainage (cf. referral.service.js),
          // pas l'inscription. Aligne l'incitation du parrain sur la densité réelle
          // (un filleul qui sort vraiment) plutôt que sur un compte jamais utilisé.
          Event.countDocuments({ type: 'location_visit', actor: userId }).then((totalVisits) => {
            if (totalVisits === 1) {
              import('./referral.service.js')
                .then(({ validateReferralIfAny }) => validateReferralIfAny({ _id: userId }))
                .catch((e) => console.error('[referral] validation error on first check-in:', e?.message || e));
            }
          }).catch((e) => console.warn('[user.service] Failed to check first-visit status for referral:', e.message));

          // Recalcule popularity + étoiles (percentile local x global, cf. location.service.js)
          const loc = await Location.findById(currentLocationId, 'city').lean();
          // Décalé en tâche de fond : cette agrégation (tous les Events 30j d'une
          // ville) n'a aucune raison de bloquer la réponse du heartbeat qui vient
          // de la déclencher. Import dynamique (comme referral.service.js
          // ci-dessus) : construire une Queue BullMQ se connecte à Redis dès
          // l'instanciation (pas seulement au premier .add()), donc un import
          // statique de config/queue.js forcerait cette connexion dès le
          // chargement de user.service.js — y compris dans des tests qui
          // n'utilisent jamais la queue (repéré via tests/user.service.checkin.test.js,
          // qui restait bloqué indéfiniment en l'absence de Redis).
          try {
            const { cityStarsQueue } = await import('../config/queue.js');
            await cityStarsQueue.add('recalc', { city: loc?.city || null });
          } catch (e) {
            console.warn('[user.service] Failed to enqueue city stars recalc:', e.message);
          }
          console.log(`[Presence] Visit recorded for user ${userId} at POI ${currentLocationId} after ${Math.round(elapsedMs / 60000)}min`);

          // Croisements : même dédup 12h que le location_visit ci-dessus, pour
          // que "recroiser" la même personne mette juste à jour lastSeenAt/crossCount
          // au lieu de créer des doublons.
          recordCrossedPaths(userId, currentLocationId).catch((e) => {
            console.warn('[user.service] Failed to record crossed paths:', e.message);
          });
        }
      } catch (e) {
        console.warn('[user.service] Failed to record location_visit', e.message);
      }
    }

    // Récompense Ultra Boost : 20 min sur place pendant qu'une offre Ultra Boost est
    // active sur ce lieu → un boost de profil gratuit (même durée que le boost payant,
    // cf. premium.controller.js:activateBoost), une fois par activation. `claimedBy` est
    // remis à zéro à chaque nouvelle activation (businessBoost.controller.js), donc rester
    // sur place lors d'une activation ultérieure permet de réclamer à nouveau.
    if (elapsedMs >= ULTRA_BOOST_CLAIM_MS) {
      try {
        const now = new Date();
        const alreadyBoosted = user.boostUntil && user.boostUntil > now;
        if (!alreadyBoosted) {
          const loc = await Location.findOneAndUpdate(
            {
              _id: currentLocationId,
              'ultraBoost.active': true,
              'ultraBoost.until': { $gt: now },
              'ultraBoost.claimedBy': { $ne: userId },
            },
            { $addToSet: { 'ultraBoost.claimedBy': userId } }
          );
          if (loc) {
            await User.findByIdAndUpdate(userId, { $set: { boostUntil: new Date(now.getTime() + FREE_BOOST_DURATION_MS) } });
            console.log(`[UltraBoost] Free profile boost granted to user ${userId} at POI ${currentLocationId} after ${Math.round(elapsedMs / 60000)}min`);
          }
        }
      } catch (e) {
        console.warn('[user.service] Failed to grant ultra boost reward', e.message);
      }
    }
  }

  // Optional: cache in Redis GEOSET
  try {
    await redisClient.geoAdd('geo:users', [{ longitude: lon, latitude: lat, member: userId.toString() }]);
  } catch {}

  // Fire-and-forget : dérive/rafraîchit `city` via reverse geocoding (throttlé,
  // cf. geocoding.service.js). Ne doit jamais bloquer ni faire échouer la
  // réponse du check-in/heartbeat — erreurs déjà avalées côté service.
  maybeRefreshCity(userId, lat, lon).catch(() => {});

  return user;
}

export async function getNearbyUsers({ userId, lat, lon, radiusMeters = 2000 }) {
  const threshold = new Date(Date.now() - PRESENCE_FRESHNESS_MS);
  const blockedIds = await getBlockedIds(userId);
  const excludeIds = Array.from(new Set([String(userId), ...blockedIds]));
  // Try Redis first
  try {
    const members = await redisClient.geoSearch('geo:users', {
      latitude: lat,
      longitude: lon,
      radius: radiusMeters,
      unit: 'm',
      WITHDIST: true,
      COUNT: 100,
    });
    if (Array.isArray(members) && members.length > 0) {
      const requesterId = String(userId);
      const ids = members
        .map((m) => m.member)
        .filter((id) => id && !excludeIds.includes(String(id)));
      if (ids.length === 0) {
        debugLog(`[getNearbyUsers] Redis: Found ${members.length} total, but 0 after exclusion. Requester=${userId}`);
        return [];
      }
      const users = await User.find(applyNotBannedFilter({
        _id: { $in: ids },
        status: { $ne: 'red' },
        emailVerified: true,
        $or: [
          { 'location.updatedAt': { $gte: threshold } },
          { boostUntil: { $gte: new Date() } }
        ]
      }))
      .select('-password')
      .sort({ boostUntil: -1, 'streak.count': -1 })
      .lean();

      debugLog(`[getNearbyUsers] Redis audit: Found=${users.length}/${ids.length} candidates. Threshold=${threshold.toISOString()}. ExcludedIdsCount=${excludeIds.length}`);
      return users;
    }
  } catch (err) {
    console.warn('[getNearbyUsers] Redis search failed:', err.message);
  }

  // Fallback to MongoDB geospatial query
  const users = await User.find(applyNotBannedFilter({
    _id: { $nin: excludeIds },
    status: { $ne: 'red' },
    emailVerified: true,
    'location.updatedAt': { $gte: threshold },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lon, lat] },
        $maxDistance: radiusMeters,
      },
    },
  }))
    .sort({ boostUntil: -1, 'streak.count': -1 })
    .limit(100)
    .select('-password')
    .lean();

  debugLog(`[getNearbyUsers] MongoDB audit: Found=${users.length} users. Threshold=${threshold.toISOString()}. Radius=${radiusMeters}m`);
  return users;
}

export async function getPopularUsers({ userId = null, limit = 10 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
  const query = applyNotBannedFilter({ status: { $ne: 'red' }, emailVerified: true });
  if (userId) {
    const blockedIds = await getBlockedIds(userId);
    const excludeIds = Array.from(new Set([String(userId), ...blockedIds]));
    Object.assign(query, { _id: { $nin: excludeIds } });
  }
  const users = await User.find(query)
    .sort({ profileViews: -1, createdAt: -1 })
    .limit(safeLimit)
    .select('-password')
    .lean();
  return users;
}

export async function searchUsers({ q = '', limit = 10, excludeUserId = null } = {}) {
  // Enforce max 10 results regardless of client request
  const safeLimit = Math.max(1, Math.min(10, parseInt(limit, 10) || 10));
  const query = { status: { $ne: 'red' } };
  if (excludeUserId) {
    const blockedIds = await getBlockedIds(excludeUserId);
    const excludeIds = Array.from(new Set([String(excludeUserId), ...blockedIds]));
    Object.assign(query, { _id: { $nin: excludeIds } });
  }

  const s = String(q || '').trim();
  // Require at least 2 characters to avoid overloading API
  if (!s || s.length < 2) {
    return [];
  }
  // Case-insensitive and accent-insensitive partial match on multiple fields
  const re = buildDiacriticRegex(s);
  Object.assign(query, {
    $or: [
      { username: re },
      { firstName: re },
      { lastName: re },
      { customName: re },
      { name: re },
      { email: { $regex: re } },
    ],
  });
  applyNotBannedFilter(query);

  const users = await User.find(query)
    .limit(safeLimit)
    .select('-password')
    .lean();
  return users;
}

// Recherche réservée aux admins (DebugScreen / modération) : AUCUN filtre de
// visibilité, de ban ou de blocage — contrairement à searchUsers(), il faut
// pouvoir retrouver un compte en mode invisible (status 'red') ou banni pour
// le gérer. Ne jamais exposer cette fonction hors d'une route requireAdmin.
export async function adminSearchUsers({ q = '', limit = 20 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));
  const s = String(q || '').trim();
  if (!s || s.length < 2) return [];

  // Recherche exacte par id si la requête ressemble à un ObjectId.
  if (/^[a-f0-9]{24}$/i.test(s)) {
    const byId = await User.findById(s).select('-password').lean();
    return byId ? [byId] : [];
  }

  const re = buildDiacriticRegex(s);
  const users = await User.find({
    $or: [
      { username: re },
      { firstName: re },
      { lastName: re },
      { customName: re },
      { name: re },
      { email: { $regex: re } },
    ],
  })
    .limit(safeLimit)
    .select('-password')
    .lean();
  return users;
}
