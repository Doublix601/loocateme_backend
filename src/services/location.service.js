import { Location } from '../models/Location.js';
import { Event } from '../models/Event.js';
import {
  CITY_TIER2_PERCENTILE,
  CITY_TIER3_PERCENTILE,
  GLOBAL_TIER2_PERCENTILE,
  GLOBAL_TIER3_PERCENTILE,
} from '../config/starRatingConfig.js';

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
