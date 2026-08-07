import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

// Backfill du champ "streak" pour les comptes créés avant l'introduction de la
// fonctionnalité (remplace l'ancien système `cotePercent`) : les defaults du
// schéma Mongoose ne s'appliquent qu'aux nouveaux documents, pas aux
// documents déjà en base. On démarre tout le monde à 0, sans récompense en
// attente, pour ne pas créditer artificiellement des comptes existants.
async function backfill() {
  try {
    console.log('--- Starting Streak Backfill ---');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const res = await User.updateMany(
      { streak: { $exists: false } },
      [
        {
          $set: {
            streak: {
              count: 0,
              lastCheckInDate: null,
              supervisePendingClaim: false,
              boostPendingClaim: false,
              lastClaimedAt: null,
            },
            lastLoginAt: { $ifNull: ['$updatedAt', '$createdAt', new Date()] },
          },
        },
      ]
    );
    console.log(`[Backfill] Streak field set for ${res.modifiedCount} users.`);
  } catch (e) {
    console.error('[Backfill] Error:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('--- Streak Backfill finished ---');
  }
}

backfill();
