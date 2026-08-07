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

// Tag used everywhere so cleanupDemoUsers.js can find and remove EXACTLY
// what this script creates, and nothing else. Do not reuse this prefix
// for real accounts.
const SEED_EMAIL_PREFIX = 'seed.demo.';
const SEED_EMAIL_DOMAIN = '@loocateme.local';
const SEED_LOCATION_NAME = 'Demo Screenshots Spot';
const ANCHOR_EMAIL = 'arnaud.doublix@gmail.com';

function getRandomPointAtDistance(centerLon, centerLat, distanceInKm) {
  const R = 6371;
  const angle = Math.random() * 2 * Math.PI;
  const dLat = (distanceInKm / R) * (180 / Math.PI);
  const dLon = (distanceInKm / (R * Math.cos((Math.PI * centerLat) / 180))) * (180 / Math.PI);
  const lat = centerLat + dLat * Math.sin(angle);
  const lon = centerLon + dLon * Math.cos(angle);
  return [parseFloat(lon.toFixed(6)), parseFloat(lat.toFixed(6))];
}

// Illustrated / generated avatars only — never real people's photos.
// DiceBear renders a deterministic cartoon-style avatar from a seed string.
function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

const DEMO_PROFILES = [
  {
    firstName: 'Léa',
    lastName: 'M.',
    bio: 'Fan de café et de bonnes rencontres ☕️',
    gender: 'female',
    socialNetworks: [{ type: 'instagram', handle: 'lea.demo.seed' }],
  },
  {
    firstName: 'Thomas',
    lastName: 'B.',
    bio: 'Sport, musique, et découvertes du coin 🎧',
    gender: 'male',
    socialNetworks: [{ type: 'instagram', handle: 'thomas.demo.seed' }],
  },
  {
    firstName: 'Chloé',
    lastName: 'R.',
    bio: 'Toujours partante pour un verre 🍹',
    gender: 'female',
    socialNetworks: [{ type: 'tiktok', handle: 'chloe.demo.seed' }],
  },
  {
    firstName: 'Hugo',
    lastName: 'L.',
    bio: 'Photographe amateur 📸',
    gender: 'male',
    socialNetworks: [{ type: 'instagram', handle: 'hugo.demo.seed' }],
  },
  {
    firstName: 'Emma',
    lastName: 'D.',
    bio: 'Nouvelle dans le coin, hâte de rencontrer du monde !',
    gender: 'female',
    socialNetworks: [{ type: 'snapchat', handle: 'emma.demo.seed' }],
  },
  {
    firstName: 'Nathan',
    lastName: 'P.',
    bio: 'Bière artisanale et bonne humeur 🍺',
    gender: 'male',
    socialNetworks: [{ type: 'instagram', handle: 'nathan.demo.seed' }],
  },
];

async function seedDemoUsers() {
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
    console.log(`Position ancre: [${anchorLon}, ${anchorLat}]`);

    // Demo place right next to the anchor user, clearly tagged as test.
    let demoLocation = await Location.findOne({ name: SEED_LOCATION_NAME });
    if (!demoLocation) {
      demoLocation = await Location.create({
        name: SEED_LOCATION_NAME,
        type: 'TEST 🤖',
        radius: 150,
        location: { type: 'Point', coordinates: [anchorLon, anchorLat] },
        popularity: 20,
      });
      console.log(`Lieu de démo créé: ${demoLocation._id}`);
    } else {
      demoLocation.location = { type: 'Point', coordinates: [anchorLon, anchorLat] };
      await demoLocation.save();
      console.log(`Lieu de démo réutilisé: ${demoLocation._id}`);
    }

    const now = new Date();
    let created = 0;

    for (let i = 0; i < DEMO_PROFILES.length; i++) {
      const profile = DEMO_PROFILES[i];
      const email = `${SEED_EMAIL_PREFIX}${i + 1}${SEED_EMAIL_DOMAIN}`;
      const coords = getRandomPointAtDistance(anchorLon, anchorLat, 0.05 + Math.random() * 0.15);

      const existing = await User.findOne({ email });
      if (existing) {
        console.log(`Déjà présent, ignoré: ${email}`);
        continue;
      }

      await User.create({
        email,
        password: `SeedDemo_${Math.random().toString(36).slice(2)}!`,
        firstName: profile.firstName,
        lastName: profile.lastName,
        customName: `${profile.firstName} ${profile.lastName}`,
        bio: profile.bio,
        gender: profile.gender,
        birthdate: new Date(1996, 0, 1),
        profileImageUrl: avatarUrl(email),
        socialNetworks: profile.socialNetworks,
        status: 'green',
        emailVerified: true,
        consent: { accepted: true, version: 'seed-demo', consentAt: now },
        location: { type: 'Point', coordinates: coords, updatedAt: now },
        currentLocation: demoLocation._id,
        currentLocationSince: now,
        streak: { count: 14 },
      });
      created++;
      console.log(`Créé: ${email} (${profile.firstName})`);
    }

    console.log(`\nTerminé. ${created} compte(s) de démo créé(s) autour de ${ANCHOR_EMAIL}.`);
    console.log(`Pour tout supprimer ensuite: node scripts/cleanupDemoUsers.js`);
  } catch (error) {
    console.error('Erreur seed:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

seedDemoUsers();
