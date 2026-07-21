// Coalesce les appels concurrents portant sur la même clé : si un premier
// appel est déjà en vol, les suivants attendent son résultat au lieu de
// relancer le même travail (agrégation Mongo coûteuse, typiquement) en
// parallèle. Protège contre le "cache stampede" — quand un TTL Redis expire
// pendant qu'une centaine d'utilisateurs de la même zone arrivent en même
// temps, sans ça chacun déclenche sa propre agrégation au lieu d'une seule
// pour tous.
//
// Portée : par process. En cluster PM2 (4 workers), chaque worker a son
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
