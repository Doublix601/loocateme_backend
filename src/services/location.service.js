import { Location } from '../models/Location.js';
import { Event } from '../models/Event.js';

/**
 * Recalcule la popularité (visiteurs uniques 30j) et les étoiles pour tous les lieux d'une ville.
 * L'attribution des étoiles est relative à la ville : les lieux actifs (popularité ≥ 1)
 * sont divisés en 3 tertiles égaux → 1/3 = 1 étoile, 1/3 = 2 étoiles, 1/3 = 3 étoiles.
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

  // 3. Calcule les étoiles par tertiles pour cette ville
  const active = locationIds
    .map(id => ({ _id: id, popularity: popularityMap.get(String(id)) || 0 }))
    .filter(l => l.popularity > 0)
    .sort((a, b) => a.popularity - b.popularity);

  const n = active.length;
  const starsOps = [];

  // Lieux inactifs → 0 étoile
  starsOps.push({ updateMany: { filter: { ...cityFilter, popularity: { $lte: 0 } }, update: { $set: { stars: 0 } } } });

  if (n > 0) {
    const t1 = Math.ceil(n / 3);
    const t2 = Math.ceil((2 * n) / 3);
    active.forEach((loc, i) => {
      const stars = i < t1 ? 1 : i < t2 ? 2 : 3;
      starsOps.push({ updateOne: { filter: { _id: loc._id }, update: { $set: { stars } } } });
    });
  }

  await Location.bulkWrite(starsOps, { ordered: false });
}

/**
 * Recalcule les étoiles pour TOUTES les villes (utilisé par le cron nocturne).
 * Traite chaque ville séparément pour respecter la logique par tertiles.
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

  // 2. Regroupe par ville et calcule les tertiles
  const byCity = new Map();
  for (const loc of allLocations) {
    const key = loc.city || '__no_city__';
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push({ _id: loc._id, popularity: popularityMap.get(String(loc._id)) || 0 });
  }

  const starsOps = [];
  for (const [, locs] of byCity) {
    const active = locs.filter(l => l.popularity > 0).sort((a, b) => a.popularity - b.popularity);
    const n = active.length;
    // Zero-popularity → 0 stars
    locs.filter(l => l.popularity <= 0).forEach(l => {
      starsOps.push({ updateOne: { filter: { _id: l._id }, update: { $set: { stars: 0 } } } });
    });
    if (n > 0) {
      const t1 = Math.ceil(n / 3);
      const t2 = Math.ceil((2 * n) / 3);
      active.forEach((loc, i) => {
        const stars = i < t1 ? 1 : i < t2 ? 2 : 3;
        starsOps.push({ updateOne: { filter: { _id: loc._id }, update: { $set: { stars } } } });
      });
    }
  }

  if (starsOps.length) await Location.bulkWrite(starsOps, { ordered: false });
  return allLocations.length;
}
