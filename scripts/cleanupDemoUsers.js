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

// Must match the tags used in seedDemoUsers.js exactly.
const SEED_EMAIL_PREFIX = 'seed.demo.';
const SEED_EMAIL_DOMAIN = '@loocateme.local';
const SEED_LOCATION_NAME = 'Demo Screenshots Spot';

async function cleanupDemoUsers() {
  if (!MONGO_URI) {
    console.error("Erreur: MONGODB_URI_LOCAL ou MONGODB_URI n'est pas défini dans .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connecté à MongoDB.');

  try {
    const emailPattern = new RegExp(`^${SEED_EMAIL_PREFIX.replace('.', '\\.')}\\d+${SEED_EMAIL_DOMAIN.replace('.', '\\.')}$`);

    const users = await User.find({ email: emailPattern }).select('email');
    console.log(`Comptes de démo trouvés: ${users.length}`);
    users.forEach((u) => console.log(` - ${u.email}`));

    const userResult = await User.deleteMany({ email: emailPattern });
    console.log(`Supprimés: ${userResult.deletedCount} compte(s) utilisateur.`);

    const locResult = await Location.deleteOne({ name: SEED_LOCATION_NAME, type: 'TEST 🤖' });
    console.log(`Lieu de démo supprimé: ${locResult.deletedCount}`);

    console.log('\nBase remise en état: plus aucune trace des comptes de démo.');
  } catch (error) {
    console.error('Erreur cleanup:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

cleanupDemoUsers();
