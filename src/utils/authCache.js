import { redisClient } from '../config/redis.js';

// requireAuth (middlewares/auth.js) fait un User.findById sur CHAQUE requête
// authentifiée (heartbeat toutes les 30-90s, liste toutes les 10-15s, etc.),
// pour vérifier le rôle/ban — le seul champ qui ait besoin d'être frais est
// justement celui qui change le moins souvent. TTL court : un ban mis en
// place pendant la fenêtre reste actif au plus AUTH_CACHE_TTL_SECONDS de
// plus, ce qui est cohérent avec le niveau de fraîcheur déjà toléré ailleurs
// (cache liste de lieux 60s, etc.) — et de toute façon invalidé explicitement
// dès qu'un modérateur bannit/débannit (cf. report.controller.js).
const AUTH_CACHE_TTL_SECONDS = 20;

function cacheKey(userId) {
  return `auth:v1:${userId}`;
}

export async function getCachedAuthUser(userId) {
  try {
    const cached = await redisClient.get(cacheKey(userId));
    if (cached) return JSON.parse(cached);
  } catch (e) {
    console.warn('[authCache] read failed:', e.message);
  }
  return null;
}

export async function setCachedAuthUser(userId, user) {
  try {
    await redisClient.set(cacheKey(userId), JSON.stringify(user), { EX: AUTH_CACHE_TTL_SECONDS });
  } catch (e) {
    console.warn('[authCache] write failed:', e.message);
  }
}

// À appeler après tout changement de rôle/statut de ban, et après que
// recordDailyActivity ait effectivement écrit un nouveau lastLoginAt (sinon
// les requêtes suivantes dans la fenêtre de TTL rejoueraient le même gap de
// jour civil et incrémenteraient le streak plusieurs fois).
export async function invalidateAuthCache(userId) {
  if (!userId) return;
  try {
    await redisClient.del(cacheKey(userId));
  } catch (e) {
    console.warn('[authCache] invalidate failed:', e.message);
  }
}
