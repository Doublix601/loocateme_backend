// Constantes du calcul des étoiles (0-3) attribuées aux lieux, cf.
// services/location.service.js. Un lieu ne monte de palier que s'il se
// distingue à la fois localement (dans sa ville) ET à l'échelle de toute
// l'app — ce double filtre évite qu'un lieu quasi vide décroche 3 étoiles
// simplement parce que le reste de sa ville est encore plus vide.
//
// Volontairement exprimées en percentiles (proportions 0-1) et non en
// nombre brut de visiteurs : un seuil en nombre absolu de visiteurs
// deviendrait vite obsolète à mesure que le trafic de l'app grandit et
// demanderait un recalibrage manuel permanent. Un percentile, lui,
// s'ajuste tout seul à l'échelle réelle du moment.

function envFloat(name, fallback) {
  const raw = process.env[name];
  const parsed = raw !== undefined ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Palier local : position du lieu parmi les lieux actifs de sa propre ville.
export const CITY_TIER2_PERCENTILE = envFloat('STAR_CITY_TIER2_PERCENTILE', 0.55);
export const CITY_TIER3_PERCENTILE = envFloat('STAR_CITY_TIER3_PERCENTILE', 0.85);

// Palier global : position du lieu parmi tous les lieux actifs de l'app,
// toutes villes confondues. C'est ce qui empêche l'inflation dans les
// villes peu actives.
export const GLOBAL_TIER2_PERCENTILE = envFloat('STAR_GLOBAL_TIER2_PERCENTILE', 0.50);
export const GLOBAL_TIER3_PERCENTILE = envFloat('STAR_GLOBAL_TIER3_PERCENTILE', 0.85);

// Garde-fou en nombre ABSOLU, complément aux percentiles ci-dessus : tant qu'un
// lieu n'a pas atteint ce nombre de visiteurs uniques sur 30 jours, il reste
// plafonné à 1 étoile — "gagner" un percentile dans un échantillon minuscule
// (ville ou app encore peu active) n'est pas significatif. Volontairement bas.
export const STAR_MIN_VISITORS_FOR_MULTI = Math.max(1, Math.round(envFloat('STAR_MIN_VISITORS_FOR_MULTI', 5)));
// Nombre minimal de lieux actifs dans TOUTE l'app pour qu'un palier 3 étoiles
// ait un sens (empêche la saturation quand n global est tout petit).
export const STAR_MIN_ACTIVE_SET = Math.max(1, Math.round(envFloat('STAR_MIN_ACTIVE_SET', 8)));
