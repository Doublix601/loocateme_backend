// Crée des lieux + utilisateurs de test autour du compte ancre pour exercer
// les différentes composantes du score composite de GET /locations
// (distance / stars / userCount, cf. src/config/locationScoring.js et
// src/controllers/location.controller.js).
//
// Chaque lieu isole une combinaison distance/stars/userCount représentative
// pour pouvoir vérifier à l'œil, dans l'app ou via l'API, que le classement
// obtenu correspond à l'intuition produit (cf. plan de vérification de
// l'algo de scoring).
//
// Usage:
//   node scripts/seedScoringTestUsers.js
// Nettoyage:
//   node scripts/cleanupScoringTestUsers.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../src/models/User.js';
import { Location } from '../src/models/Location.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI;

// Tags dédiés à CE script, distincts de seed.demo.* (seedDemoUsers.js), pour
// que cleanupScoringTestUsers.js ne supprime que ce qu'il a lui-même créé.
const SEED_EMAIL_PREFIX = 'seed.scoring.';
const SEED_EMAIL_DOMAIN = '@loocateme.local';
const SEED_LOCATION_NAME_PREFIX = 'Scoring Test - ';
const ANCHOR_EMAIL = 'arnaud.doublix@gmail.com';

function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

// Déplace un point de `distanceMeters` mètres depuis (centerLat, centerLon),
// dans une direction fixe par scénario (pas aléatoire) pour que les lieux ne
// se chevauchent jamais entre eux.
function offsetPoint(centerLon, centerLat, distanceMeters, bearingDeg) {
  const R = 6371000;
  const bearing = (bearingDeg * Math.PI) / 180;
  const dByR = distanceMeters / R;
  const lat1 = (centerLat * Math.PI) / 180;
  const lon1 = (centerLon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dByR) + Math.cos(lat1) * Math.sin(dByR) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(dByR) * Math.cos(lat1),
    Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [parseFloat(((lon2 * 180) / Math.PI).toFixed(6)), parseFloat(((lat2 * 180) / Math.PI).toFixed(6))];
}

// Scénarios couvrant les cas discutés lors de la conception du score composite
// (score = 0.45·distanceScore + 0.35·starsScore + 0.20·userScore) :
// distanceScore = exp(-distance/800), starsScore = stars/3, userScore = min(userCount,8)/8.
//
// Toutes les distances sont volontairement resserrées sous ~500m : le
// pipeline d'agrégation (`location.controller.js`) cape le pool de candidats
// aux N plus proches (`$limit: limit*3`, étape de perf) AVANT de calculer le
// score, pour ne pas faire exploser le coût des $lookup dans une zone dense.
// Dans un secteur avec beaucoup de vrais lieux à proximité, des scénarios de
// test trop loin (ex. 5km/10km) peuvent donc être coupés avant même d'être
// scorés — indépendamment de leur note. Rester sous 500m garantit qu'ils
// survivent à ce filtre quelle que soit la densité locale.
const SCENARIOS = [
  {
    label: 'P1 - Tout proche, 0 étoile, personne (lieu neuf)',
    distanceMeters: 30,
    bearingDeg: 0,
    stars: 0,
    userCount: 0,
    // Attendu ≈ 0.43 : cold start, ni exclu ni catapulté en tête malgré la proximité extrême.
  },
  {
    label: 'P2 - Proche, 1 étoile, un peu de monde',
    distanceMeters: 100,
    bearingDeg: 60,
    stars: 1,
    userCount: 2,
    // Attendu ≈ 0.64.
  },
  {
    label: 'P3 - Proche, 2 étoiles, fréquenté',
    distanceMeters: 200,
    bearingDeg: 120,
    stars: 2,
    userCount: 5,
    // Attendu ≈ 0.71 : doit dépasser P2 malgré une distance un peu plus grande —
    // stars+userCount compensent. C'est le cœur de ce que le score composite
    // corrige par rapport à l'ancien tri lexicographique {stars, distance}.
  },
  {
    label: 'P4 - Distance moyenne, 0 étoile, personne (référence distance pure)',
    distanceMeters: 300,
    bearingDeg: 180,
    stars: 0,
    userCount: 0,
    // Attendu ≈ 0.31 : le plus bas de tous, sert de repère "distance seule, aucun signal qualité".
  },
  {
    label: 'P5 - Assez proche, 3 étoiles, blindé de monde',
    distanceMeters: 400,
    bearingDeg: 240,
    stars: 3,
    userCount: 30,
    // Attendu ≈ 0.82 : le meilleur score du lot (userCount plafonné à 8 malgré
    // les 30 comptes réels, donc pas de sur-domination du signal live).
  },
  {
    label: 'P6 - Plus loin du lot mais 3 étoiles, personne',
    distanceMeters: 500,
    bearingDeg: 300,
    stars: 3,
    userCount: 0,
    // Attendu ≈ 0.59 : au-dessus de P1 (0★, 30m) malgré une distance bien plus
    // grande — les étoiles compensent partiellement, sans totalement écraser la distance.
  },
];

async function seedScoringTestUsers() {
  if (!MONGO_URI) {
    console.error("Erreur: MONGODB_URI_LOCAL ou MONGODB_URI n'est pas défini dans .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connecté à MongoDB.');

  try {
    const anchor = await User.findOne({ email: ANCHOR_EMAIL.toLowerCase() });
    if (!anchor) {
      throw new Error(`Compte ancre introuvable: ${ANCHOR_EMAIL}. Connecte-toi une fois dans l'app avec ce compte pour qu'il existe en base.`);
    }
    const [anchorLon, anchorLat] = anchor.location?.coordinates || [];
    if (!anchorLon || !anchorLat) {
      throw new Error(`Le compte ${ANCHOR_EMAIL} n'a pas encore de position GPS enregistrée. Ouvre l'app et autorise la localisation d'abord.`);
    }
    console.log(`Position ancre: [${anchorLon}, ${anchorLat}]\n`);

    const now = new Date();
    let userIndex = 0;
    let createdLocations = 0;
    let createdUsers = 0;

    for (const scenario of SCENARIOS) {
      const locName = `${SEED_LOCATION_NAME_PREFIX}${scenario.label}`;
      const coords = offsetPoint(anchorLon, anchorLat, scenario.distanceMeters, scenario.bearingDeg);

      let location = await Location.findOne({ name: locName });
      if (!location) {
        location = await Location.create({
          name: locName,
          type: 'TEST 🤖',
          radius: 50,
          location: { type: 'Point', coordinates: coords },
          popularity: scenario.stars > 0 ? scenario.stars * 500 : 0,
          stars: scenario.stars,
        });
        createdLocations++;
        console.log(`Lieu créé: "${locName}" (${scenario.distanceMeters}m, ${scenario.stars}★) → ${location._id}`);
      } else {
        location.location = { type: 'Point', coordinates: coords };
        location.stars = scenario.stars;
        await location.save();
        console.log(`Lieu réutilisé: "${locName}"`);
      }

      for (let i = 0; i < scenario.userCount; i++) {
        userIndex++;
        const email = `${SEED_EMAIL_PREFIX}${userIndex}${SEED_EMAIL_DOMAIN}`;
        const existing = await User.findOne({ email });
        if (existing) {
          existing.currentLocation = location._id;
          existing.currentLocationSince = now;
          existing.location = { type: 'Point', coordinates: coords, updatedAt: now };
          existing.status = 'green';
          await existing.save();
          continue;
        }
        await User.create({
          email,
          password: `SeedScoring_${Math.random().toString(36).slice(2)}!`,
          firstName: 'Test',
          lastName: `Scoring${userIndex}`,
          customName: `Test Scoring ${userIndex}`,
          bio: `Compte de test scoring — scénario "${scenario.label}"`,
          gender: 'other',
          birthdate: new Date(1996, 0, 1),
          profileImageUrl: avatarUrl(email),
          status: 'green',
          emailVerified: true,
          consent: { accepted: true, version: 'seed-scoring', consentAt: now },
          location: { type: 'Point', coordinates: coords, updatedAt: now },
          currentLocation: location._id,
          currentLocationSince: now,
          streak: { count: 14 },
        });
        createdUsers++;
      }
      console.log(`  → ${scenario.userCount} utilisateur(s) présent(s) attendu(s).\n`);
    }

    console.log(`Terminé. ${createdLocations} lieu(x) créé(s), ${createdUsers} nouveau(x) compte(s) de test.`);
    console.log(`Les lieux "${SEED_LOCATION_NAME_PREFIX}*" doivent maintenant apparaître dans la liste autour de ${ANCHOR_EMAIL}.`);
    console.log(`Pour tout supprimer ensuite: node scripts/cleanupScoringTestUsers.js`);
  } catch (error) {
    console.error('Erreur seed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedScoringTestUsers();
