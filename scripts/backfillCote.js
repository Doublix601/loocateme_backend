import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

// Backfill des champs "Cote" (cotePercent/lastLoginAt) pour les comptes créés
// avant l'introduction de la fonctionnalité : les defaults du schéma Mongoose
// ne s'appliquent qu'aux nouveaux documents, pas aux documents déjà en base.
// On démarre tout le monde à 100% pour ne pas pénaliser les comptes existants.
async function backfill() {
  try {
    console.log('--- Starting Cote Backfill ---');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const res = await User.updateMany(
      { cotePercent: { $exists: false } },
      [
        {
          $set: {
            cotePercent: 100,
            lastLoginAt: { $ifNull: ['$updatedAt', '$createdAt', new Date()] },
            coteWarningSentAt: null,
          },
        },
      ]
    );
    console.log(`[Backfill] Cote fields set for ${res.modifiedCount} users.`);
  } catch (e) {
    console.error('[Backfill] Error:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('--- Cote Backfill finished ---');
  }
}

backfill();
