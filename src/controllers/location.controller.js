import { Location } from '../models/Location.js';
import { User } from '../models/User.js';
import { redisClient } from '../config/redis.js';
import { singleflight } from '../utils/singleflight.js';
import {
  DISTANCE_REF_METERS,
  USERCOUNT_CAP,
  WEIGHT_DISTANCE,
  WEIGHT_STARS,
  WEIGHT_USERS,
  SCORING_ALGO,
} from '../config/locationScoring.js';

// Cache de la liste des lieux à proximité : la position d'un utilisateur ne
// change pas de zone assez souvent pour justifier une agrégation Mongo
// ($geoNear + 2x $lookup) à chaque appel. Le client ne refetch de toute façon
// que lors d'un déplacement de ~111m (arrondi à 3 décimales), donc un TTL
// court est invisible pour l'utilisateur mais absorbe les appels simultanés
// de plusieurs utilisateurs dans la même zone.
const LOCATIONS_CACHE_TTL_SECONDS = 10;
// Fiche lieu : TTL plus court que la liste car un utilisateur regarde souvent
// une fiche juste après y être entré (précision perçue plus importante).
const LOCATION_DETAIL_CACHE_TTL_SECONDS = 8;

// Filtrage des lieux par vibe (jour/nuit). Séparation stricte : chaque type
// appartient à un seul mode.
const TYPES_BY_VIBE = {
  moon: new Set([
    'Bar 🍺', 'Boîte de nuit 💃', 'Restaurant 🍴', 'Cinéma 🎬',
    'Fast food 🍔', 'Bowling 🎳', 'Rooftop 🌆', 'Karaoké 🎤', 'Club de jeux 🎮',
    'TEST 🤖',
  ]),
  sun: new Set([
    'Café ☕', 'Coworking 🧑‍💻', 'Salle de sport 🏋️', 'Centre sportif 🏟️',
    'Parc 🌳', 'Plage 🏖️', "Parc d'attractions 🎢", 'Bibliothèque 📚',
    'Éducation 🎓', 'Glacier 🍦', 'Marché 🛒', 'Musée 🏛️', 'Brunch 🥞',
    'TEST 🤖',
  ]),
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Les champs premium restent en base jusqu'à 7 jours après la perte de
// l'abonnement (cf. premiumDataPurgeAt sur Location / businessBilling.controller.js),
// pour permettre une restauration automatique en cas de réabonnement rapide. Mais
// ni l'app ni le site web ne filtrent leur affichage par businessTier : c'est donc
// ici, à la sérialisation des réponses publiques, qu'un lieu en tier 'none' doit
// apparaître comme n'importe quel lieu gratuit (pas de banner/logo/stories/PDF),
// que ces champs soient déjà vidés ou encore en attente de purge définitive.
function sanitizePublicLocation(location) {
  const obj = typeof location.toObject === 'function' ? location.toObject() : { ...location };
  if (obj.businessTier === 'none') {
    obj.bannerUrl = '';
    obj.bannerThumbUrl = '';
    obj.logoUrl = '';
    obj.logoThumbUrl = '';
    obj.stories = [];
    obj.media = [];
  }
  return obj;
}

function normalizeVibe(v) {
  return v === 'moon' ? 'moon' : 'sun';
}

function getAllowedTypesForVibe(vibe) {
  const v = normalizeVibe(vibe);
  // Pour le filtre $match Mongo: liste explicite des types autorisés.
  return Array.from(TYPES_BY_VIBE[v]);
}

// Types strictement réservés à la vibe opposée : ne doivent JAMAIS apparaître
// dans l'autre mode, même en fallback de remplissage. Un type est exclusif à
// une vibe s'il appartient à son ensemble mais pas à l'ensemble de l'autre
// vibe (donc hors types partagés comme Restaurant, Café, Cinéma…).
function getExcludedTypesForVibe(vibe) {
  const v = normalizeVibe(vibe);
  const other = v === 'sun' ? 'moon' : 'sun';
  const allowed = TYPES_BY_VIBE[v];
  return Array.from(TYPES_BY_VIBE[other]).filter((t) => !allowed.has(t));
}

export const LocationController = {
  getLocations: async (req, res, next) => {
    try {
      const lat = parseFloat(req.query.lat);
      const lon = parseFloat(req.query.lon);

      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ code: 'INVALID_COORDINATES', message: 'Invalid coordinates' });
      }

      const vibeParam = normalizeVibe(req.query.vibe);
      const cacheKey = `locations:v1:${lat.toFixed(3)}:${lon.toFixed(3)}:${vibeParam}:${req.query.limit || ''}`;
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
      } catch (e) {
        console.warn('[getLocations] Redis cache read failed:', e.message);
      }

      // Coalescence des requêtes concurrentes sur la même clé de cache : sans
      // ça, quand le TTL expire pendant qu'une centaine d'utilisateurs de la
      // même zone arrivent en même temps, chacun déclenche sa propre
      // agrégation Mongo en parallèle au lieu qu'une seule serve tout le monde.
      const payload = await singleflight(cacheKey, async () => {
      // Pagination simple par "limit" (min 40, max 80).
      // Le client demande au minimum 40 lieux et peut en charger plus jusqu'à 80
      // en faisant défiler la liste (cf. LocationListScreen onEndReached).
      const MIN_LIMIT = 40;
      const MAX_LIMIT = 80;
      let limit = parseInt(req.query.limit, 10);
      if (!Number.isFinite(limit) || limit < MIN_LIMIT) limit = MIN_LIMIT;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;

      // Filtre par vibe : on garantit au moins `limit` lieux pertinents pour
      // le mode jour/nuit en élargissant la recherche si nécessaire.
      const vibe = normalizeVibe(req.query.vibe);
      const allowedTypes = getAllowedTypesForVibe(vibe);
      const excludedTypes = getExcludedTypesForVibe(vibe);

      const getAggregatedLocations = async (maxDistance) => {
        return await Location.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [lon, lat] },
              distanceField: 'distance',
              maxDistance: maxDistance,
              spherical: true,
              query: { type: { $in: allowedTypes } },
            },
          },
          // Cap early so the two $lookup stages below only join the closest candidates.
          // Without this, a dense DB (1000+ locations within 10 km) would run
          // user-joins on every document before sorting — very expensive.
          { $limit: limit * 3 },
          {
            $lookup: {
              from: 'users',
              let: { locationId: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$currentLocation', '$$locationId'] },
                    status: { $in: ['green', 'orange'] },
                    $or: [
                      { 'location.updatedAt': { $gte: new Date(Date.now() - 5 * 60 * 1000) } },
                      { boostUntil: { $gte: new Date() } }
                    ]
                  },
                },
                { $project: { _id: 1, profileImageUrl: 1, status: 1, boostUntil: 1, location: 1 } },
                { $limit: 3 },
              ],
              as: 'activeUsers',
            },
          },
          {
            $lookup: {
              from: 'users',
              let: { locationId: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$currentLocation', '$$locationId'] },
                    status: { $ne: 'red' },
                    $or: [
                      { 'location.updatedAt': { $gte: new Date(Date.now() - 5 * 60 * 1000) } },
                      { boostUntil: { $gte: new Date() } }
                    ]
                  },
                },
                { $count: 'count' },
              ],
              as: 'userCount',
            },
          },
          {
            $addFields: {
              userCount: { $ifNull: [{ $arrayElemAt: ['$userCount.count', 0] }, 0] },
            },
          },
          // Score composite de pertinence : mêle distance, popularité (stars,
          // déjà calculée par tertiles/ville, cf. location.service.js) et
          // présence live (userCount), plutôt qu'un tri lexicographique où la
          // distance n'intervenait qu'en tout dernier départage. Constantes
          // dans config/locationScoring.js (dupliquées côté client pour le
          // score de secours des POI OSM, cf. LocationListScreen.js).
          {
            $addFields: {
              score: {
                $add: [
                  { $multiply: [WEIGHT_DISTANCE, { $exp: { $multiply: [-1, { $divide: ['$distance', DISTANCE_REF_METERS] }] } }] },
                  { $multiply: [WEIGHT_STARS, { $divide: [{ $ifNull: ['$stars', 0] }, 3] }] },
                  { $multiply: [WEIGHT_USERS, { $divide: [{ $min: ['$userCount', USERCOUNT_CAP] }, USERCOUNT_CAP] }] },
                ],
              },
            },
          },
          {
            $sort:
              SCORING_ALGO === 'legacy'
                ? { stars: -1, distance: 1 }
                : { score: -1 },
          },
        ]);
      };

      // On veut au minimum `limit` lieux (20 par défaut, jusqu'à 50). Si la zone
      // proche ne contient pas assez de lieux pour la vibe demandée, on élargit
      // progressivement le rayon de recherche jusqu'à trouver assez de lieux,
      // ou jusqu'à atteindre une recherche sans limite de distance.
      const RADIUS_STEPS = [10000, 30000, 100000, 500000]; // 10km → 500km
      let locations = [];
      for (const r of RADIUS_STEPS) {
        locations = await getAggregatedLocations(r);
        if (locations.length >= limit) break;
      }
      // Dernier recours: aucune limite de distance (toute la collection)
      if (locations.length < limit) {
        // $geoNear nécessite maxDistance optionnel; sans maxDistance on prend
        // tous les lieux triés par distance croissante.
        locations = await Location.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [lon, lat] },
              distanceField: 'distance',
              spherical: true,
              query: { type: { $in: allowedTypes, $nin: ['Lieu 📍'] } },
            },
          },
        ]);
      }

      // Garantie stricte d'un minimum de `limit` lieux pour la vibe demandée :
      // si la DB locale ne contient pas assez de lieux compatibles vibe (jour ou
      // nuit), on complète avec les lieux les plus proches de l'AUTRE vibe afin
      // d'atteindre le minimum. Mieux vaut afficher des lieux moins « in‑vibe »
      // que de présenter une liste quasi vide à l'utilisateur.
      if (locations.length < limit) {
        const existingIds = new Set(locations.map(l => String(l._id)));
        const fillers = await Location.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [lon, lat] },
              distanceField: 'distance',
              spherical: true,
              // On prend les plus proches, mais on EXCLUT toujours les types
              // strictement réservés à la vibe opposée (ex : un Bar ne doit
              // jamais apparaître en mode jour, même en remplissage). Les
              // types partagés (Restaurant, Café…) restent autorisés.
              // "Lieu 📍" est définitivement exclu (legacy en DB, non désiré par l'utilisateur).
              query: { type: { $nin: [...excludedTypes, 'Lieu 📍'] } },
            },
          },
          { $limit: limit * 3 },
        ]);
        for (const loc of fillers) {
          if (locations.length >= limit) break;
          if (existingIds.has(String(loc._id))) continue;
          locations.push(loc);
          existingIds.add(String(loc._id));
        }
      }

      // Les prioritaires (popularité, utilisateurs, étoiles) sont déjà en tête
      // grâce au $sort de l'agrégation (sauf pour le fallback sans maxDistance,
      // mais celui-ci est trié par distance pour rester pertinent).
      locations = locations.slice(0, limit);

      // "Pro Boost" : un seul lieu sponsorisé globalement, épinglé en tête de
      // liste avec le flag isSponsored, si l'utilisateur est dans un rayon
      // raisonnable (200km) — évite d'afficher un lieu sponsorisé à l'autre
      // bout du pays.
      const sponsor = await Location.findOne({
        'sponsorship.active': true,
        'sponsorship.until': { $gt: new Date() },
      }).lean();
      if (sponsor && String(sponsor._id) !== String(locations[0]?._id)) {
        const [sLon, sLat] = sponsor.location.coordinates;
        const distance = haversineMeters(lat, lon, sLat, sLon);
        if (distance <= 200000) {
          locations = locations.filter((l) => String(l._id) !== String(sponsor._id));
          locations.unshift({ ...sponsor, distance, isSponsored: true });
          locations = locations.slice(0, limit);
        }
      } else if (sponsor) {
        locations = locations.map((l) => (String(l._id) === String(sponsor._id) ? { ...l, isSponsored: true } : l));
      }

        const result = { locations: locations.map(sanitizePublicLocation) };
        try {
          await redisClient.set(cacheKey, JSON.stringify(result), { EX: LOCATIONS_CACHE_TTL_SECONDS });
        } catch (e) {
          console.warn('[getLocations] Redis cache write failed:', e.message);
        }
        return result;
      });

      return res.json(payload);
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
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
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
        const threshold = new Date(Date.now() - 5 * 60 * 1000);
        const now = new Date();
        const users = await User.find({
          currentLocation: location._id,
          status: { $ne: 'red' },
          $or: [
            { 'location.updatedAt': { $gte: threshold } },
            { boostUntil: { $gte: now } }
          ]
        })
        .select('-password')
        .sort({ boostUntil: -1, cotePercent: -1, createdAt: 1 }); // Prioritize boosted, then Cote, users

        // Add isGhost flag for boosted users who are offline
        const usersWithGhostFlag = users.map(user => {
          const isOffline = user.location && user.location.updatedAt < threshold;
          const isBoosted = user.boostUntil && user.boostUntil >= now;
          return {
            ...user.toObject(),
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
      return res.json(result);
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

      // Mapping clé OSM brute → libellé backend (Location.type enum).
      // Doit rester aligné avec LocationSyncService côté client.
      const OSM_TO_BACKEND = {
        bar: 'Bar 🍺', pub: 'Bar 🍺', nightclub: 'Boîte de nuit 💃',
        restaurant: 'Restaurant 🍴', cafe: 'Café ☕',
        fast_food: 'Fast food 🍔', food_court: 'Fast food 🍔',
        gym: 'Salle de sport 🏋️', fitness_centre: 'Salle de sport 🏋️',
        beach_resort: 'Plage 🏖️', theme_park: "Parc d'attractions 🎢",
        library: 'Bibliothèque 📚',
        sports_centre: 'Centre sportif 🏟️', stadium: 'Centre sportif 🏟️', pitch: 'Centre sportif 🏟️',
        bowling_alley: 'Bowling 🎳',
        university: 'Éducation 🎓', college: 'Éducation 🎓', school: 'Éducation 🎓',
        coworking_space: 'Coworking 🧑‍💻',
        cinema: 'Cinéma 🎬',
        ice_cream: 'Glacier 🍦',
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
            name: name || 'Lieu OSM',
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
      const { locations } = req.body;

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

          return res.json({
            success: true,
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount
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
