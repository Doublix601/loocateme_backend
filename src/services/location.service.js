import { Location } from '../models/Location.js';
import { Event } from '../models/Event.js';
import { User } from '../models/User.js';
import {
  CITY_TIER2_PERCENTILE,
  CITY_TIER3_PERCENTILE,
  GLOBAL_TIER2_PERCENTILE,
  GLOBAL_TIER3_PERCENTILE,
} from '../config/starRatingConfig.js';
import { applyNotBannedFilter } from './user.service.js';
import { PRESENCE_FRESHNESS_MS } from '../config/presenceWindows.js';
import {
  DISTANCE_REF_METERS,
  USERCOUNT_CAP,
  WEIGHT_DISTANCE,
  WEIGHT_STARS,
  WEIGHT_USERS,
  SCORING_ALGO,
} from '../config/locationScoring.js';
import { haversineMeters } from '../utils/geo.js';

// Filtrage des lieux par vibe (jour/nuit). Séparation stricte : chaque type
// appartient à un seul mode.
const TYPES_BY_VIBE = {
  moon: new Set([
    'Bar 🍺', 'Boîte de nuit 💃', 'Loisir 🎯',
    'TEST 🤖',
  ]),
  sun: new Set([
    'Restaurant 🍴', 'Cinéma 🎬', 'Rooftop 🌆',
    'Karaoké 🎤', 'Club de jeux 🎮',
    'Café ☕', 'Coworking 🧑‍💻', 'Salle de sport 🏋️', 'Centre sportif 🏟️',
    'Parc 🌳', 'Plage 🏖️', "Parc d'attractions 🎢", 'Bibliothèque 📚',
    'Éducation 🎓', 'Glacier 🍦', 'Marché 🛒', 'Musée 🏛️', 'Brunch 🥞',
    'TEST 🤖',
  ]),
};

export function normalizeVibe(v) {
  return v === 'moon' ? 'moon' : 'sun';
}

function getAllowedTypesForVibe(vibe) {
  const v = normalizeVibe(vibe);
  // Pour le filtre $match Mongo: liste explicite des types autorisés.
  return Array.from(TYPES_BY_VIBE[v]);
}

// Types strictement réservés à la vibe opposée : ne doivent JAMAIS apparaître
// dans l'autre mode, même en fallback de remplissage. Séparation stricte :
// chaque type appartient à un seul mode, il n'y a aucun type partagé.
function getExcludedTypesForVibe(vibe) {
  const v = normalizeVibe(vibe);
  const other = v === 'sun' ? 'moon' : 'sun';
  const allowed = TYPES_BY_VIBE[v];
  return Array.from(TYPES_BY_VIBE[other]).filter((t) => !allowed.has(t));
}

// Pagination simple par "limit" (min 40, max 80). Le client demande au
// minimum 40 lieux et peut en charger plus jusqu'à 80 en faisant défiler la
// liste (cf. LocationListScreen onEndReached).
const NEARBY_MIN_LIMIT = 40;
const NEARBY_MAX_LIMIT = 80;
// 10km → 500km : on veut au minimum `limit` lieux. Si la zone proche ne
// contient pas assez de lieux pour la vibe demandée, on élargit
// progressivement le rayon de recherche jusqu'à en trouver assez, ou jusqu'à
// atteindre une recherche sans limite de distance.
const NEARBY_RADIUS_STEPS = [10000, 30000, 100000, 500000];

// Rayon de decouverte maximal selon le statut premium de l'utilisateur, applique
// a toutes les requetes $geoNear de findNearbyLocations. Gratuit : 2 km.
// Premium : 30 km. Au-dela du plafond, la liste peut contenir moins que
// NEARBY_MIN_LIMIT lieux (l'app affiche alors son empty-state / bouton
// "elargir le rayon") : c'est volontaire, le plafond premium prime sur la
// garantie de remplissage minimal.
export const FREE_DISCOVERY_RADIUS_M = 2000;
export const PREMIUM_DISCOVERY_RADIUS_M = 30000;

async function getAggregatedLocations({ lat, lon, allowedTypes, limit, maxDistance }) {
  return await Location.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lon, lat] },
        distanceField: 'distance',
        maxDistance,
        spherical: true,
        // Exclut les lieux OSM seedés sans nom (fallback historique
        // "Lieu OSM" côté osmSeedOne) : pas de vrai libellé à afficher,
        // ne doivent jamais remonter dans l'app.
        query: { type: { $in: allowedTypes }, name: { $ne: 'Lieu OSM' } },
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
            $match: applyNotBannedFilter({
              $expr: { $eq: ['$currentLocation', '$$locationId'] },
              status: { $in: ['green', 'orange'] },
              $or: [
                { 'location.updatedAt': { $gte: new Date(Date.now() - PRESENCE_FRESHNESS_MS) } },
                { boostUntil: { $gte: new Date() } }
              ]
            }),
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
            $match: applyNotBannedFilter({
              $expr: { $eq: ['$currentLocation', '$$locationId'] },
              status: { $ne: 'red' },
              $or: [
                { 'location.updatedAt': { $gte: new Date(Date.now() - PRESENCE_FRESHNESS_MS) } },
                { boostUntil: { $gte: new Date() } }
              ]
            }),
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
    // déjà calculée par percentile local x global, cf. ci-dessous dans ce
    // fichier) et présence live (userCount), plutôt qu'un tri lexicographique
    // où la distance n'intervenait qu'en tout dernier départage. Constantes
    // dans config/locationScoring.js (dupliquées côté client pour le score de
    // secours des POI OSM, cf. LocationListScreen.js).
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
}

// Recalcule activeUsers/userCount pour UN lieu donné, avec le même filtrage
// que $lookup dans getAggregatedLocations (non-bannis, statut, fraîcheur de
// présence/boost). Nécessaire pour les lieux sponsorisés injectés hors de
// l'agrégation normale (cf. findNearbyLocations) : un lieu sponsor de vibe
// nuit consulté en vibe jour ne passe jamais par $lookup, donc sans cet appel
// il resterait sans activeUsers/userCount (0 visiteur affiché à tort).
async function attachLiveUserData(location) {
  const now = new Date();
  const baseMatch = {
    currentLocation: location._id,
    $or: [
      { 'location.updatedAt': { $gte: new Date(now.getTime() - PRESENCE_FRESHNESS_MS) } },
      { boostUntil: { $gte: now } },
    ],
  };
  const [activeUsers, userCount] = await Promise.all([
    User.find(applyNotBannedFilter({ ...baseMatch, status: { $in: ['green', 'orange'] } }, now))
      .select('_id profileImageUrl status boostUntil location')
      .limit(3)
      .lean(),
    User.countDocuments(applyNotBannedFilter({ ...baseMatch, status: { $ne: 'red' } }, now)),
  ]);
  return { ...location, activeUsers, userCount };
}

/**
 * Trouve les lieux proches d'un point pour une vibe donnée (logique métier
 * pure de getLocations) : élargit progressivement le rayon de recherche,
 * complète avec l'autre vibe si la zone est trop pauvre, calcule un score
 * composite (distance/étoiles/présence live) et injecte le lieu sponsorisé
 * actif s'il y en a un. La mise en cache Redis et le filtrage des
 * utilisateurs bloqués restent au niveau du controller (concerns
 * HTTP/caching, pas métier).
 */
export async function findNearbyLocations({ lat, lon, vibe, limitParam, maxRadiusM }) {
  let limit = parseInt(limitParam, 10);
  if (!Number.isFinite(limit) || limit < NEARBY_MIN_LIMIT) limit = NEARBY_MIN_LIMIT;
  if (limit > NEARBY_MAX_LIMIT) limit = NEARBY_MAX_LIMIT;

  // Plafond de distance (premium/gratuit). Infinity = pas de plafond (appelant
  // qui ne passe pas le parametre : comportement historique preserve).
  const radiusCap = Number.isFinite(maxRadiusM) && maxRadiusM > 0 ? maxRadiusM : Infinity;

  const normalizedVibe = normalizeVibe(vibe);
  const allowedTypes = getAllowedTypesForVibe(normalizedVibe);
  const excludedTypes = getExcludedTypesForVibe(normalizedVibe);

  let locations = [];
  for (const step of NEARBY_RADIUS_STEPS) {
    const maxDistance = Math.min(step, radiusCap);
    locations = await getAggregatedLocations({ lat, lon, allowedTypes, limit, maxDistance });
    if (locations.length >= limit || maxDistance >= radiusCap) break;
  }
  // Dernier recours: aucune limite de distance (toute la collection). $geoNear
  // nécessite maxDistance optionnel; sans maxDistance on prend tous les lieux
  // triés par distance croissante. Ignoré si un plafond premium/gratuit est
  // actif : on ne doit jamais dépasser radiusCap.
  if (locations.length < limit && radiusCap === Infinity) {
    locations = await Location.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lon, lat] },
          distanceField: 'distance',
          spherical: true,
          query: { type: { $in: allowedTypes, $nin: ['Lieu 📍'] }, name: { $ne: 'Lieu OSM' } },
        },
      },
    ]);
  }

  // Garantie stricte d'un minimum de `limit` lieux pour la vibe demandée : si
  // la DB locale ne contient pas assez de lieux compatibles vibe (jour ou
  // nuit), on complète avec les lieux les plus proches de l'AUTRE vibe afin
  // d'atteindre le minimum. Mieux vaut afficher des lieux moins « in‑vibe »
  // que de présenter une liste quasi vide à l'utilisateur.
  if (locations.length < limit) {
    const existingIds = new Set(locations.map((l) => String(l._id)));
    const fillers = await Location.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lon, lat] },
          distanceField: 'distance',
          spherical: true,
          ...(radiusCap === Infinity ? {} : { maxDistance: radiusCap }),
          // On prend les plus proches, mais on EXCLUT toujours les types
          // strictement réservés à la vibe opposée (ex : un Bar ne doit
          // jamais apparaître en mode jour, même en remplissage). Les types
          // partagés (Restaurant, Café…) restent autorisés. "Lieu 📍" est
          // définitivement exclu (legacy en DB, non désiré par l'utilisateur).
          query: { type: { $nin: [...excludedTypes, 'Lieu 📍'] }, name: { $ne: 'Lieu OSM' } },
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

  // "Pro Boost" : plusieurs lieux peuvent être sponsorisés simultanément,
  // chacun via son propre solde (cf. activateProBoost, plus de verrou
  // global). Aucun ne doit être épinglé en tête de la liste normale —
  // juste marqué isSponsored pour que le client l'affiche dans sa section
  // dédiée "Mis en avant" (carousel côté app, cf. SponsoredCarousel). S'il
  // fait déjà partie du classement naturel, on ne touche pas à sa
  // position ; sinon on l'ajoute en fin de liste (jamais en tête) afin
  // qu'il reste disponible pour la section "Mis en avant" tout en restant
  // absent du haut de la liste normale. Un sponsor n'est proposé que s'il
  // est à moins de 200km de l'utilisateur : la mise en avant doit rester
  // pertinente localement.
  const sponsors = await Location.find({
    'sponsorship.active': true,
    'sponsorship.until': { $gt: new Date() },
  }).lean();
  for (const sponsor of sponsors) {
    const alreadyInList = locations.some((l) => String(l._id) === String(sponsor._id));
    if (alreadyInList) {
      locations = locations.map((l) => (String(l._id) === String(sponsor._id) ? { ...l, isSponsored: true } : l));
    } else {
      const [sLon, sLat] = sponsor.location.coordinates;
      const distance = haversineMeters(lat, lon, sLat, sLon);
      if (distance <= Math.min(200000, radiusCap)) {
        locations.push(await attachLiveUserData({ ...sponsor, distance, isSponsored: true }));
      }
    }
  }

  return locations;
}

/**
 * Construit, à partir d'une liste de lieux actifs triée par popularité
 * croissante, la map _id -> percentile au sein de cette liste.
 *
 * Percentile d'une valeur = (nombre de lieux strictement moins populaires + 1) / n.
 * Tous les lieux à égalité de popularité reçoivent EXACTEMENT le même percentile
 * (celui du premier d'entre eux dans le tri). Un simple rang par index aurait
 * réparti arbitrairement les ex-æquo entre paliers d'étoiles différents selon
 * un ordre de tri incident — exactement le genre de notation "trop facile"
 * et non-significative qu'on cherche à éliminer.
 */
function buildPercentileMap(activeSortedAsc) {
  const n = activeSortedAsc.length;
  const map = new Map();
  let firstIndexOfValue = 0;
  activeSortedAsc.forEach((loc, i) => {
    if (i === 0 || loc.popularity !== activeSortedAsc[i - 1].popularity) {
      firstIndexOfValue = i;
    }
    map.set(String(loc._id), (firstIndexOfValue + 1) / n);
  });
  return map;
}

/**
 * Attribue une note d'étoiles (1 à 3) à chaque lieu actif d'une ville, en
 * exigeant à la fois un bon percentile local (par rapport aux autres lieux
 * actifs de la même ville) ET un bon percentile global (par rapport à tous
 * les lieux actifs de l'app). Voir config/starRatingConfig.js.
 */
function assignStars(cityActiveSortedAsc, globalPercentileMap) {
  const localPercentileMap = buildPercentileMap(cityActiveSortedAsc);
  return cityActiveSortedAsc.map((loc) => {
    const localPercentile = localPercentileMap.get(String(loc._id)) || 0;
    const globalPercentile = globalPercentileMap.get(String(loc._id)) || 0;
    let stars = 1;
    if (localPercentile >= CITY_TIER3_PERCENTILE && globalPercentile >= GLOBAL_TIER3_PERCENTILE) {
      stars = 3;
    } else if (localPercentile >= CITY_TIER2_PERCENTILE && globalPercentile >= GLOBAL_TIER2_PERCENTILE) {
      stars = 2;
    }
    return { _id: loc._id, stars };
  });
}

/**
 * Recalcule la popularité (visiteurs uniques 30j) et les étoiles pour tous les lieux d'une ville.
 * L'attribution des étoiles combine un percentile local (au sein de la ville) et un percentile
 * global (au sein de tous les lieux actifs de l'app) : un lieu ne monte de palier que s'il se
 * distingue sur les deux à la fois. Voir config/starRatingConfig.js pour le détail des seuils.
 *
 * @param {string|null} city  Ville ciblée. Si null/undefined, recalcule toutes les villes.
 */
export async function recalculateCityStars(city) {
  const cityFilter = city ? { city } : {};
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Recalcule la popularité (visiteurs uniques 30j) pour les lieux concernés
  const locationIds = await Location.distinct('_id', cityFilter);
  if (!locationIds.length) return;

  const stats = await Event.aggregate([
    { $match: { type: 'location_visit', locationId: { $in: locationIds }, createdAt: { $gt: thirtyDaysAgo } } },
    { $group: { _id: '$locationId', uniqueVisitors: { $addToSet: '$actor' } } },
    { $project: { popularity: { $size: '$uniqueVisitors' } } }
  ]);
  const popularityMap = new Map(stats.map(s => [String(s._id), s.popularity]));

  // 2. Met à jour la popularité de chaque lieu
  const popularityOps = locationIds.map(id => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { popularity: popularityMap.get(String(id)) || 0 } }
    }
  }));
  if (popularityOps.length) await Location.bulkWrite(popularityOps, { ordered: false });

  // 3. Étoiles : percentile local (cette ville) x percentile global (toute l'app)
  const cityActive = locationIds
    .map(id => ({ _id: id, popularity: popularityMap.get(String(id)) || 0 }))
    .filter(l => l.popularity > 0)
    .sort((a, b) => a.popularity - b.popularity);

  const otherActive = await Location.find(
    { popularity: { $gt: 0 }, _id: { $nin: locationIds } },
    '_id popularity'
  ).lean();

  const globalActive = [...otherActive, ...cityActive].sort((a, b) => a.popularity - b.popularity);
  const globalPercentileMap = buildPercentileMap(globalActive);

  const starsOps = [];

  // Lieux inactifs → 0 étoile
  starsOps.push({ updateMany: { filter: { ...cityFilter, popularity: { $lte: 0 } }, update: { $set: { stars: 0 } } } });

  if (cityActive.length > 0) {
    assignStars(cityActive, globalPercentileMap).forEach(({ _id, stars }) => {
      starsOps.push({ updateOne: { filter: { _id }, update: { $set: { stars } } } });
    });
  }

  await Location.bulkWrite(starsOps, { ordered: false });
}

/**
 * Recalcule les étoiles pour TOUTES les villes (utilisé par le cron nocturne).
 * Le percentile global est calculé une seule fois sur l'ensemble des lieux actifs,
 * puis chaque ville est traitée séparément pour son percentile local.
 */
export async function recalculateAllCityStars() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Recalcule la popularité de tous les lieux
  const allStats = await Event.aggregate([
    { $match: { type: 'location_visit', createdAt: { $gt: thirtyDaysAgo } } },
    { $group: { _id: '$locationId', uniqueVisitors: { $addToSet: '$actor' } } },
    { $project: { popularity: { $size: '$uniqueVisitors' } } }
  ]);
  const popularityMap = new Map(allStats.map(s => [String(s._id), s.popularity]));

  const allLocations = await Location.find({}, '_id city popularity').lean();

  // Mise à jour de la popularité en bulk
  const popOps = allLocations.map(loc => ({
    updateOne: {
      filter: { _id: loc._id },
      update: { $set: { popularity: popularityMap.get(String(loc._id)) || 0 } }
    }
  }));
  if (popOps.length) await Location.bulkWrite(popOps, { ordered: false });

  // 2. Percentile global sur l'ensemble des lieux actifs de l'app
  const globalActive = allLocations
    .map(loc => ({ _id: loc._id, popularity: popularityMap.get(String(loc._id)) || 0 }))
    .filter(l => l.popularity > 0)
    .sort((a, b) => a.popularity - b.popularity);
  const globalPercentileMap = buildPercentileMap(globalActive);

  // 3. Regroupe par ville et calcule les étoiles (percentile local x global)
  const byCity = new Map();
  for (const loc of allLocations) {
    const key = loc.city || '__no_city__';
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push({ _id: loc._id, popularity: popularityMap.get(String(loc._id)) || 0 });
  }

  const starsOps = [];
  for (const [, locs] of byCity) {
    const active = locs.filter(l => l.popularity > 0).sort((a, b) => a.popularity - b.popularity);
    // Zero-popularity → 0 stars
    locs.filter(l => l.popularity <= 0).forEach(l => {
      starsOps.push({ updateOne: { filter: { _id: l._id }, update: { $set: { stars: 0 } } } });
    });
    if (active.length > 0) {
      assignStars(active, globalPercentileMap).forEach(({ _id, stars }) => {
        starsOps.push({ updateOne: { filter: { _id }, update: { $set: { stars } } } });
      });
    }
  }

  if (starsOps.length) await Location.bulkWrite(starsOps, { ordered: false });
  return allLocations.length;
}
