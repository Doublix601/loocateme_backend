import { redisClient } from '../config/redis.js';

// Coalesce les appels concurrents portant sur la même clé : si un premier
// appel est déjà en vol, les suivants attendent son résultat au lieu de
// relancer le même travail (agrégation Mongo coûteuse, typiquement) en
// parallèle. Protège contre le "cache stampede" — quand un TTL Redis expire
// pendant qu'une centaine d'utilisateurs de la même zone arrivent en même
// temps, sans ça chacun déclenche sa propre agrégation au lieu d'une seule
// pour tous.
//
// Portée : par process. En cluster PM2 (3 workers), chaque worker a son
// propre in-flight map — la coalescence n'est donc pas parfaite entre workers,
// mais elle absorbe déjà l'essentiel du stampede (les requêtes simultanées
// sur une même clé finissent presque toujours sur le même worker via le
// round-robin nginx/PM2 sur une fenêtre de quelques centaines de ms).

const inFlight = new Map();

export function singleflight(key, fn) {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

// Variante cross-process de singleflight(), pour les clés à fort risque de
// stampede sur des zones denses (ex: getNearbyPoiCandidates un samedi soir
// dans un bar bondé) où le stampede par-process ne suffit pas car les 3
// workers PM2 peuvent chacun lancer la même agrégation Mongo en parallèle.
//
// Verrou Redis (SET NX PX) : le premier worker à l'obtenir exécute `fn` (qui
// est censé écrire son résultat en cache, comme le fait déjà
// getNearbyPoiCandidates) puis relâche le verrou. Les autres pollent le cache
// en attendant le résultat plutôt que de relancer `fn`.
//
// Fail-open : si le verrou n'est pas obtenu et qu'aucun résultat n'apparaît
// en cache dans le délai imparti (Redis lent/indisponible, worker détenteur
// mort avant d'écrire), on exécute `fn` localement plutôt que de bloquer
// indéfiniment ou d'échouer — la dispo du endpoint heartbeat prime sur la
// déduplication parfaite.
const LOCK_TTL_MS = 2000;
const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function singleflightRedis(key, fn, { readCache } = {}) {
  // Coalescence locale d'abord (gratuite, gère le cas où plusieurs requêtes
  // arrivent sur le même worker pendant la fenêtre du verrou distribué).
  return singleflight(key, async () => {
    const lockKey = `lock:${key}`;
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let acquired = false;
    try {
      const result = await redisClient.set(lockKey, token, { NX: true, PX: LOCK_TTL_MS });
      acquired = result === 'OK';
    } catch {
      // Redis indisponible pour le verrou : on tombe en fail-open direct.
      return fn();
    }

    if (acquired) {
      try {
        return await fn();
      } finally {
        try {
          // Ne supprime le verrou que si on en est toujours le détenteur
          // (évite de supprimer le verrou d'un autre worker si le TTL a
          // expiré entre-temps sous forte charge).
          const current = await redisClient.get(lockKey);
          if (current === token) await redisClient.del(lockKey);
        } catch {}
      }
    }

    // Verrou pris par un autre worker : on attend son résultat en cache.
    if (typeof readCache === 'function') {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        try {
          const cached = await readCache();
          if (cached) return cached;
        } catch {}
      }
    }

    // Fail-open : pas de résultat en cache dans le délai imparti.
    return fn();
  });
}
