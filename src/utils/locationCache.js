import { redisClient } from '../config/redis.js';

// Utilisé par les endpoints qui mutent un lieu (dashboard pro : events, stories,
// media, cover, logo) pour ne pas laisser le client voir une fiche périmée
// jusqu'à expiration du TTL du cache `location:v1:<id>`.
export async function invalidateLocationDetailCache(locationId) {
  if (!locationId) return;
  try {
    await redisClient.del(`location:v1:${locationId}`);
  } catch (e) {
    console.warn('[invalidateLocationDetailCache] Redis cache delete failed:', e.message);
  }
}

// Utilisé par les endpoints qui font varier le userCount d'un lieu (check-in/
// check-out manuel ou auto) : sans ça, la liste `locations:v1:*` (clé par
// zone/vibe, TTL 60s) continue de servir l'ancien userCount jusqu'à expiration,
// donnant l'impression que l'utilisateur est resté sur l'ancien lieu.
export async function invalidateLocationsListCache() {
  try {
    // SCAN plutôt que KEYS : KEYS bloque tout le serveur Redis (rate-limiting,
    // autres caches, BullMQ) le temps de parcourir tout le keyspace, ce qui
    // devient de plus en plus coûteux à mesure que Redis grossit. SCAN itère
    // par curseur sans bloquer, au prix de quelques aller-retours de plus.
    const keys = [];
    for await (const key of redisClient.scanIterator({ MATCH: 'locations:v1:*', COUNT: 100 })) {
      keys.push(key);
    }
    if (keys.length) await redisClient.del(keys);
  } catch (e) {
    console.warn('[invalidateLocationsListCache] Redis cache delete failed:', e.message);
  }
}
