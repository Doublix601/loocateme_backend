// Constantes du score composite de pertinence utilisé pour trier GET /locations
// (cf. controllers/location.controller.js). Regroupées ici pour permettre un
// tuning rapide sans replonger dans le pipeline d'agrégation Mongo.

// Décroissance exponentielle de la distance : à DISTANCE_REF_METERS, le score
// de distance vaut exp(-1) ≈ 0.37. Valeur pensée pour un usage piéton/urbain.
export const DISTANCE_REF_METERS = 800;

// Au-delà de USERCOUNT_CAP utilisateurs présents, le signal "lieu vivant" est
// déjà maximal ; un lieu à 40 personnes ne doit pas écraser le classement
// davantage qu'un lieu à 8.
export const USERCOUNT_CAP = 8;

// Poids relatifs des trois composantes du score (doivent rester cohérents
// entre le backend et le score de secours côté client, cf.
// LocationListScreen.js). Distance dominante (app de proximité), stars en
// second (signal de qualité à moyen terme), userCount en appoint (signal
// volatile temps réel).
export const WEIGHT_DISTANCE = 0.45;
export const WEIGHT_STARS = 0.35;
export const WEIGHT_USERS = 0.20;

// Feature flag de rollback : LOCATION_SCORING_ALGO=legacy restaure l'ancien
// tri lexicographique { stars: -1, distance: 1 } sans redeploiement.
export const SCORING_ALGO = process.env.LOCATION_SCORING_ALGO === 'legacy' ? 'legacy' : 'composite';
