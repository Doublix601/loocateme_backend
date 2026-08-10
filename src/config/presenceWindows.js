// Fenêtres de fraîcheur de présence utilisées à plusieurs endroits pour
// décider "qui compte comme présent quelque part" — regroupées ici pour que
// leur relation reste visible en un seul endroit plutôt que dupliquée en
// constantes locales isolées (source d'un bug de cohérence UI : un utilisateur
// pouvait disparaître des listes "qui est ici" bien avant d'être réellement
// auto-check-out par le cron, sans qu'aucune des deux fenêtres n'évoque
// explicitement l'autre).
//
// Relation voulue : LOCATION_LIST_CACHE_TTL_MS < PRESENCE_FRESHNESS_MS <
// STALE_PRESENCE_THRESHOLD_MS. Ne pas changer les valeurs sans revalider les
// trois usages (cache HTTP, filtre d'affichage "qui est ici", auto-checkout).

// TTL du cache Redis sur GET /api/locations (liste) et GET /api/locations/:id
// (détail) — cf. utils/locationCache.js, controllers/location.controller.js.
export const LOCATION_LIST_CACHE_TTL_MS = 60 * 1000;

// Au-delà de cette ancienneté de `location.updatedAt`, un utilisateur n'est
// plus compté comme "présent" dans les listes d'utilisateurs d'un lieu
// (getNearbyUsers/getLocationById), même si son `currentLocation` n'a pas
// encore été effacé côté serveur — cf. controllers/location.controller.js.
export const PRESENCE_FRESHNESS_MS = 5 * 60 * 1000;

// Au-delà de cette ancienneté, le cron d'auto-checkout (cf.
// services/cron.service.js, expireStalePresence) efface réellement
// currentLocation. Fixé à 4x PRESENCE_FRESHNESS_MS pour absorber les retards
// de livraison OS normaux du heartbeat d'arrière-plan sans faux positifs —
// cf. services/user.service.js.
export const STALE_PRESENCE_THRESHOLD_MS = 4 * PRESENCE_FRESHNESS_MS;
