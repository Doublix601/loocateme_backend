import { Location } from '../models/Location.js';
import { User } from '../models/User.js';
import { applyNotBannedFilter, getBlockedIds, isUserBanned } from '../services/user.service.js';
import { findNearbyLocations, normalizeVibe } from '../services/location.service.js';
import { CrossedPath } from '../models/CrossedPath.js';
import { redisClient } from '../config/redis.js';
import { singleflight, singleflightRedis } from '../utils/singleflight.js';
import { PRESENCE_FRESHNESS_MS } from '../config/presenceWindows.js';

// Cache de la liste des lieux à proximité : la position d'un utilisateur ne
// change pas de zone assez souvent pour justifier une agrégation Mongo
// ($geoNear + 2x $lookup) à chaque appel. Le client ne refetch de toute façon
// que lors d'un déplacement de ~111m (arrondi à 3 décimales), donc un TTL
// court est invisible pour l'utilisateur mais absorbe les appels simultanés
// de plusieurs utilisateurs dans la même zone.
const LOCATIONS_CACHE_TTL_SECONDS = 60;
// Fiche lieu : TTL plus court que la liste car un utilisateur regarde souvent
// une fiche juste après y être entré (précision perçue plus importante).
const LOCATION_DETAIL_CACHE_TTL_SECONDS = 60;

// Utilisé par les endpoints qui mutent un lieu (dashboard pro : events, stories,
// media, cover, logo) pour ne pas laisser le client voir une fiche périmée
// jusqu'à expiration du TTL ci-dessus.
export { invalidateLocationDetailCache, invalidateLocationsListCache } from '../utils/locationCache.js';

// Les champs premium restent en base jusqu'à 7 jours après la perte de
// l'abonnement (cf. premiumDataPurgeAt sur Location / businessBilling.controller.js),
// pour permettre une restauration automatique en cas de réabonnement rapide. Mais
// ni l'app ni le site web ne filtrent leur affichage par businessTier : c'est donc
// ici, à la sérialisation des réponses publiques, qu'un lieu en tier 'none' doit
// apparaître comme n'importe quel lieu gratuit (pas de banner/logo/stories/PDF),
// que ces champs soient déjà vidés ou encore en attente de purge définitive.
export function sanitizePublicLocation(location) {
  const obj = typeof location.toObject === 'function' ? location.toObject() : { ...location };
  if (obj.businessTier === 'none') {
    obj.bannerUrl = '';
    obj.bannerThumbUrl = '';
    obj.logoUrl = '';
    obj.logoThumbUrl = '';
    obj.stories = [];
    obj.media = [];
  }
  // Ces réponses sont publiques (n'importe quel utilisateur authentifié de
  // l'app), contrairement au dashboard pro (endpoint séparé, propriétaire
  // uniquement) : les identifiants Stripe et les documents KYC (KBIS/ID en
  // attente de vérification) ne doivent jamais y apparaître, quel que soit le
  // businessTier — pas seulement 'none'.
  delete obj.subscription;
  delete obj.documents;
  return obj;
}

// La liste des lieux et la fiche détail sont mises en cache Redis partagé
// entre tous les viewers (par position/lieu, pas par utilisateur), donc le
// filtrage des utilisateurs bloqués (relation propre à chaque viewer) ne peut
// pas se faire dans la requête Mongo mise en cache : on le fait ici, après
// lecture (cache ou frais), juste avant l'envoi de la réponse.
function stripBlockedFromLocations(locations, blockedIds) {
  if (!blockedIds || blockedIds.length === 0) return locations;
  const blockedSet = new Set(blockedIds.map(String));
  return locations.map((loc) => {
    if (!Array.isArray(loc.activeUsers) || loc.activeUsers.length === 0) return loc;
    const activeUsers = loc.activeUsers.filter((u) => !blockedSet.has(String(u._id)));
    if (activeUsers.length === loc.activeUsers.length) return loc;
    return { ...loc, activeUsers };
  });
}

function stripBlockedFromUsers(users, blockedIds) {
  if (!blockedIds || blockedIds.length === 0) return users;
  const blockedSet = new Set(blockedIds.map(String));
  return users.filter((u) => !blockedSet.has(String(u._id)));
}

// Support des identifiants OSM côté client (`osm:<osmId>`), même résolution
// que getLocationById.
async function resolveLocation(id) {
  if (typeof id === 'string' && id.startsWith('osm:')) {
    const osmId = Number(id.slice(4));
    if (!Number.isFinite(osmId)) return null;
    return Location.findOne({ osmId });
  }
  return Location.findById(id);
}

export const LocationController = {
  getLocations: async (req, res, next) => {
    try {
      if (req.user?.invisibleMode) {
        return res.status(403).json({ error: 'INVISIBLE_MODE_ACTIVE' });
      }
      const lat = parseFloat(req.query.lat);
      const lon = parseFloat(req.query.lon);

      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ code: 'INVALID_COORDINATES', message: 'Invalid coordinates' });
      }

      const vibeParam = normalizeVibe(req.query.vibe);
      const cacheKey = `locations:v1:${lat.toFixed(3)}:${lon.toFixed(3)}:${vibeParam}:${req.query.limit || ''}`;
      const blockedIds = await getBlockedIds(req.user?.id);
      // Un refresh manuel (pull-to-refresh) doit renvoyer une donnée réellement
      // fraîche : le cache (TTL 60s) n'est invalidé que sur un changement de
      // currentLocation, donc un utilisateur qui reste au même lieu ou se
      // déplace sans franchir la maille ~111m de cacheKey peut sinon se voir
      // resservir indéfiniment le même snapshot. On saute uniquement la
      // LECTURE du cache ; l'écriture ci-dessous a toujours lieu, donc les
      // appels silencieux/automatiques qui suivent en bénéficient normalement.
      const forceFresh = req.query.fresh === '1';
      if (!forceFresh) {
        try {
          const cached = await redisClient.get(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            return res.json({ ...parsed, locations: stripBlockedFromLocations(parsed.locations, blockedIds) });
          }
        } catch (e) {
          console.warn('[getLocations] Redis cache read failed:', e.message);
        }
      }

      // Coalescence des requêtes concurrentes sur la même clé de cache : sans
      // ça, quand le TTL expire pendant qu'une centaine d'utilisateurs de la
      // même zone arrivent en même temps, chacun déclenche sa propre
      // agrégation Mongo en parallèle au lieu qu'une seule serve tout le monde.
      // singleflightRedis (verrou cross-process) plutôt que le singleflight
      // process-local : sur un cluster PM2 à plusieurs workers, une zone dense
      // (samedi soir) peut sinon voir chaque worker relancer sa propre
      // agrégation en parallèle pour la même clé — déjà corrigé ainsi pour
      // getNearbyPoiCandidates, incohérent de ne pas le faire ici aussi.
      const payload = await singleflightRedis(
        cacheKey,
        async () => {
          const locations = await findNearbyLocations({ lat, lon, vibe: vibeParam, limitParam: req.query.limit });
          const result = { locations: locations.map(sanitizePublicLocation) };
          try {
            await redisClient.set(cacheKey, JSON.stringify(result), { EX: LOCATIONS_CACHE_TTL_SECONDS });
          } catch (e) {
            console.warn('[getLocations] Redis cache write failed:', e.message);
          }
          return result;
        },
        {
          readCache: async () => {
            const cached = await redisClient.get(cacheKey);
            return cached ? JSON.parse(cached) : null;
          },
        }
      );

      return res.json({ ...payload, locations: stripBlockedFromLocations(payload.locations, blockedIds) });
    } catch (err) {
      next(err);
    }
  },

  // Recherche publique par nom/ville, utilisée par le flux de candidature pro
  // (le professionnel recherche son établissement avant de le revendiquer).
  // Exclut les lieux déjà revendiqués (isPro:true).
  searchByName: async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q || q.length < 2) return res.json({ locations: [] });
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const locations = await Location.find({
        isPro: { $ne: true },
        $or: [{ name: re }, { city: re }],
      })
        .select('name city type location')
        .limit(limit)
        .lean();
      return res.json({ locations });
    } catch (err) {
      next(err);
    }
  },

  getLocationById: async (req, res, next) => {
    try {
      const { id } = req.params;

      // Cache court : protège les lieux à forte affluence (ex: plusieurs
      // dizaines d'utilisateurs qui ouvrent la même fiche en quelques secondes
      // un samedi soir) sans décaler perceptiblement la liste de présences.
      const cacheKey = `location:v1:${id}`;
      const blockedIds = await getBlockedIds(req.user?.id);
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          return res.json({ ...parsed, users: stripBlockedFromUsers(parsed.users, blockedIds) });
        }
      } catch (e) {
        console.warn('[getLocationById] Redis cache read failed:', e.message);
      }

      const result = await singleflight(cacheKey, async () => {
        // Support des identifiants OSM côté client (`osm:<osmId>`). Ces lieux sont
        // synchronisés en base via `/locations/sync-osm` et indexés par `osmId`.
        // On résout vers le document Mongo correspondant pour éviter un cast
        // ObjectId qui ferait planter la requête.
        let location = null;
        if (typeof id === 'string' && id.startsWith('osm:')) {
          const osmId = Number(id.slice(4));
          if (Number.isFinite(osmId)) {
            location = await Location.findOne({ osmId });
          }
        } else {
          location = await Location.findById(id);
        }
        if (!location) {
          return { notFound: true };
        }

        // Fetch users checked-in at this location, excluding 'red' status and respecting GDPR
        const threshold = new Date(Date.now() - PRESENCE_FRESHNESS_MS);
        const now = new Date();
        const users = await User.find(applyNotBannedFilter({
          currentLocation: location._id,
          status: { $ne: 'red' },
          $or: [
            { 'location.updatedAt': { $gte: threshold } },
            { boostUntil: { $gte: now } }
          ]
        }))
        .select('-password')
        .sort({ boostUntil: -1, 'streak.count': -1, createdAt: 1 }) // Prioritize boosted, then streak, users
        // Plafond dur : un lieu très fréquenté (gros bar/festival un samedi
        // soir) ne doit pas pouvoir renvoyer une liste illimitée d'utilisateurs
        // dans une seule réponse. Boostés/meilleur streak restent prioritaires
        // grâce au tri ci-dessus.
        .limit(200)
        .lean();

        // Add isGhost flag for boosted users who are offline
        const usersWithGhostFlag = users.map(user => {
          const isOffline = user.location && user.location.updatedAt < threshold;
          const isBoosted = user.boostUntil && user.boostUntil >= now;
          return {
            ...user,
            isGhost: isOffline && isBoosted
          };
        });

        const payload = {
          location: sanitizePublicLocation(location),
          users: usersWithGhostFlag,
          monthlyUsers: location.popularity || 0,
        };
        try {
          await redisClient.set(cacheKey, JSON.stringify(payload), { EX: LOCATION_DETAIL_CACHE_TTL_SECONDS });
        } catch (e) {
          console.warn('[getLocationById] Redis cache write failed:', e.message);
        }
        return payload;
      });

      if (result.notFound) {
        return res.status(404).json({ code: 'LOCATION_NOT_FOUND', message: 'Location not found' });
      }
      return res.json({ ...result, users: stripBlockedFromUsers(result.users, blockedIds) });
    } catch (err) {
      next(err);
    }
  },

  // Utilisateurs croisés à ce lieu (présence passée, pas forcément live) :
  // fenêtre 24h en gratuit, 7 jours en Premium. Réponse spécifique au viewer,
  // donc pas de cache Redis partagé ici (contrairement à getLocationById).
  getCrossedPaths: async (req, res, next) => {
    try {
      const { id } = req.params;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const skip = (page - 1) * limit;

      const location = await resolveLocation(id);
      if (!location) {
        return res.status(404).json({ code: 'LOCATION_NOT_FOUND', message: 'Location not found' });
      }

      const now = new Date();
      const me = await User.findById(req.user.id).select('isPremium premiumTrialEnd').lean();
      const isPremium = !!me?.isPremium || (me?.premiumTrialEnd && me.premiumTrialEnd > now);
      const windowDays = isPremium ? 7 : 1;
      const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

      const blockedIds = await getBlockedIds(req.user.id);
      const query = {
        userId: req.user.id,
        locationId: location._id,
        lastSeenAt: { $gte: since },
        otherUserId: { $nin: blockedIds },
      };

      const [total, rows] = await Promise.all([
        CrossedPath.countDocuments(query),
        CrossedPath.find(query)
          .sort({ lastSeenAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('otherUserId', '-password')
          .lean(),
      ]);

      // Le statut de ban vit sur User.moderation.*, pas sur CrossedPath : on
      // filtre après le populate (peut légèrement réduire items vs total,
      // acceptable pour cette v1).
      const items = rows
        .filter((r) => r.otherUserId && !isUserBanned(r.otherUserId))
        .map((r) => ({ user: r.otherUserId, lastSeenAt: r.lastSeenAt, crossCount: r.crossCount }));

      return res.json({ page, limit, total, items, isPremium });
    } catch (err) {
      next(err);
    }
  },

  // Seed unitaire d'un POI Overpass déjà observé côté client. Permet d'enregistrer
  // immédiatement un lieu OSM affiché dans la liste (et donc d'éviter un 404 si
  // l'utilisateur ouvre l'écran de détail avant que la sync globale ne le couvre).
  osmSeedOne: async (req, res, next) => {
    try {
      const { osmId, name, type, lat, lon } = req.body || {};
      const osmIdNum = Number(osmId);
      if (!Number.isFinite(osmIdNum)) {
        return res.status(400).json({ code: 'INVALID_DATA', message: 'osmId must be a number' });
      }
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        return res.status(400).json({ code: 'INVALID_DATA', message: 'lat/lon must be numbers' });
      }
      // Un lieu OSM sans nom exploitable ne doit jamais être seedé : c'est
      // l'origine du placeholder "Lieu OSM" qui pouvait apparaître dans l'app
      // (cf. exclusion `name !== 'Lieu OSM'` dans getLocations pour les
      // enregistrements déjà en DB). Mieux vaut un 404 côté détail que
      // créer un lieu inutilisable.
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ code: 'INVALID_DATA', message: 'name is required' });
      }

      // Mapping clé OSM brute → libellé backend (Location.type enum).
      // Doit rester aligné avec LocationSyncService côté client.
      const OSM_TO_BACKEND = {
        bar: 'Bar 🍺', pub: 'Bar 🍺', nightclub: 'Boîte de nuit 💃',
        restaurant: 'Restaurant 🍴', cafe: 'Café ☕',
        gym: 'Salle de sport 🏋️', fitness_centre: 'Salle de sport 🏋️',
        beach_resort: 'Plage 🏖️', theme_park: "Parc d'attractions 🎢",
        library: 'Bibliothèque 📚',
        sports_centre: 'Centre sportif 🏟️', stadium: 'Centre sportif 🏟️', pitch: 'Centre sportif 🏟️',
        university: 'Éducation 🎓', college: 'Éducation 🎓',
        coworking_space: 'Coworking 🧑‍💻',
        cinema: 'Cinéma 🎬',
        ice_cream: 'Glacier 🍦',
        marketplace: 'Marché 🛒', museum: 'Musée 🏛️', park: 'Parc 🌳',
        // Loisir 🎯 : bowling, karting, escape game, laser game, arcade — mode nuit exclusivement.
        bowling_alley: 'Loisir 🎯', escape_game: 'Loisir 🎯', laser_tag: 'Loisir 🎯',
        adult_gaming_centre: 'Loisir 🎯', karting: 'Loisir 🎯',
      };
      const mappedType = OSM_TO_BACKEND[type] || null;
      if (!mappedType) {
        return res.status(400).json({ code: 'UNSUPPORTED_TYPE', message: `Unsupported OSM type: ${type}` });
      }

      const location = await Location.findOneAndUpdate(
        { osmId: osmIdNum },
        {
          $set: {
            osmId: osmIdNum,
            name: name.trim(),
            type: mappedType,
            location: { type: 'Point', coordinates: [lon, lat] },
            lastOsmSyncAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return res.json({ success: true, location });
    } catch (err) {
      // Si conflit d'index (ex: deux clients qui seedent en parallèle), on tente
      // simplement de re-lire le doc plutôt que de remonter une 500.
      if (err && (err.code === 11000)) {
        try {
          const existing = await Location.findOne({ osmId: Number(req.body?.osmId) });
          if (existing) return res.json({ success: true, location: existing });
        } catch (_) { /* fall through */ }
      }
      next(err);
    }
  },

  syncOsmLocations: async (req, res, next) => {
    try {
      const { locations, activeOsmIds, lat, lon, radius } = req.body;

      if (!Array.isArray(locations)) {
        return res.status(400).json({ code: 'INVALID_DATA', message: 'locations must be an array' });
      }

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const ops = locations.map((loc) => {
        const { osmId, name, city, type, coordinates } = loc;

        return {
          updateOne: {
            filter: {
              osmId: osmId,
              $or: [
                { lastOsmSyncAt: { $exists: false } },
                { lastOsmSyncAt: { $lt: yesterday } },
              ],
            },
            update: {
              $set: {
                osmId: osmId,
                name: name,
                city: city,
                type: type,
                location: {
                  type: 'Point',
                  coordinates: coordinates,
                },
                lastOsmSyncAt: now,
              },
            },
            upsert: true,
          },
        };
      });

      // On utilise bulkWrite mais on doit faire attention :
      // Si le filtre (lastOsmSyncAt < yesterday) ne matche pas, l'opération sera ignorée ou fera un upsert si non trouvé.
      // S'il y a un upsert, osmId sera unique.

      if (ops.length > 0) {
        // Upsert d'abord, puis nettoyage : on évite ainsi de laisser la DB vide
        // si le process crashe entre les deux opérations.
        try {
          const result = await Location.bulkWrite(ops, { ordered: false });

          // Cleanup old manual test locations (without osmId) that are not persistent (stars < 3)
          // OR locations explicitly marked for deletion (shouldDelete: true)
          await Location.deleteMany({
            $or: [
              { osmId: { $exists: false }, stars: { $lt: 3 } },
              { shouldDelete: true }
            ]
          }).catch(e => console.warn('[syncOsmLocations] deleteMany failed:', e.message));

          // Purge des lieux OSM disparus d'Overpass : appelé uniquement quand le
          // client fournit la zone couverte par la sync (activeOsmIds = tous les
          // osmId retournés par Overpass pour ce rayon, pas seulement ce chunk) et
          // la position/rayon interrogés. On scope la suppression géographiquement
          // au rayon syncé pour ne jamais toucher les lieux OSM situés ailleurs, et
          // on exclut les lieux revendiqués par un pro (isPro) pour ne pas faire
          // disparaître silencieusement une fiche business à cause d'un tag OSM
          // retiré/déplacé côté OpenStreetMap.
          let deletedStaleCount = 0;
          if (
            Array.isArray(activeOsmIds) &&
            typeof lat === 'number' &&
            typeof lon === 'number' &&
            typeof radius === 'number' &&
            radius > 0
          ) {
            const EARTH_RADIUS_M = 6378100;
            const staleResult = await Location.deleteMany({
              osmId: { $exists: true, $nin: activeOsmIds },
              isPro: false,
              location: {
                $geoWithin: {
                  $centerSphere: [[lon, lat], radius / EARTH_RADIUS_M],
                },
              },
            }).catch((e) => {
              console.warn('[syncOsmLocations] stale deleteMany failed:', e.message);
              return null;
            });
            deletedStaleCount = staleResult?.deletedCount || 0;
          }

          return res.json({
            success: true,
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
            deletedStaleCount
          });
        } catch (bulkError) {
          // ordered: false permet de continuer même si certains échouent (ex: E11000 duplicate key sur osmId)
          return res.json({
            success: true,
            message: 'Sync partially completed or some items already up to date',
            details: bulkError.message
          });
        }
      }

      return res.json({ success: true, message: 'No locations to sync' });
    } catch (err) {
      next(err);
    }
  },
};
