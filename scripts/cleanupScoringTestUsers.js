// Supprime EXACTEMENT ce que seedScoringTestUsers.js a créé : les comptes
// seed.scoring.*@loocateme.local et les lieux "Scoring Test - *". Ne touche à
// rien d'autre (en particulier pas aux comptes seed.demo.* de
// seedDemoUsers.js, qui ont leurs propres tags et leur propre script de
// nettoyage).
//
// Usage: node scripts/cleanupScoringTestUsers.js
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

// Doit correspondre exactement aux tags de seedScoringTestUsers.js.
const SEED_EMAIL_PREFIX = 'seed.scoring.';
const SEED_EMAIL_DOMAIN = '@loocateme.local';
const SEED_LOCATION_NAME_PREFIX = 'Scoring Test - ';

async function cleanupScoringTestUsers() {
  if (!MONGO_URI) {
    console.error("Erreur: MONGODB_URI_LOCAL ou MONGODB_URI n'est pas défini dans .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connecté à MongoDB.');

  try {
    const emailPattern = new RegExp(`^${SEED_EMAIL_PREFIX.replace('.', '\\.')}\\d+${SEED_EMAIL_DOMAIN.replace('.', '\\.')}$`);

    const users = await User.find({ email: emailPattern }).select('email');
    console.log(`Comptes de test scoring trouvés: ${users.length}`);
    users.forEach((u) => console.log(` - ${u.email}`));
    const userResult = await User.deleteMany({ email: emailPattern });
    console.log(`Supprimés: ${userResult.deletedCount} compte(s) utilisateur.`);

    const namePattern = new RegExp(`^${SEED_LOCATION_NAME_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const locations = await Location.find({ name: namePattern, type: 'TEST 🤖' }).select('name');
    console.log(`\nLieux de test scoring trouvés: ${locations.length}`);
    locations.forEach((l) => console.log(` - ${l.name}`));
    const locResult = await Location.deleteMany({ name: namePattern, type: 'TEST 🤖' });
    console.log(`Supprimés: ${locResult.deletedCount} lieu(x).`);

    console.log('\nBase remise en état: plus aucune trace des comptes/lieux de test scoring.');
  } catch (error) {
    console.error('Erreur cleanup:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

cleanupScoringTestUsers();
