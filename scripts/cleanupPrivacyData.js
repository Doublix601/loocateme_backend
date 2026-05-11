import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Event } from '../src/models/Event.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

async function cleanup() {
  try {
    console.log('--- Starting Privacy Cleanup Task ---');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // 1. Clear "Zombie" Presences
    // If a user hasn't sent a heartbeat for more than 5 minutes, they are no longer "Present"
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const zombieRes = await User.updateMany(
      {
        currentLocation: { $ne: null },
        'location.updatedAt': { $lt: fiveMinutesAgo }
      },
      {
        $set: {
          currentLocation: null,
          pendingLocation: null,
          pendingLocationSince: null
        }
      }
    );
    console.log(`[Cleanup] Cleared ${zombieRes.modifiedCount} zombie presences (inactive > 5m).`);

    // 2. Anonymize Old Visit Events
    // GDPR: We shouldn't keep identifiable visit history indefinitely.
    // After 30 days, we remove the "actor" link but keep the event for aggregate stats.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const eventRes = await Event.updateMany(
      {
        type: 'location_visit',
        actor: { $ne: null },
        createdAt: { $lt: thirtyDaysAgo }
      },
      {
        $set: { actor: null }
      }
    );
    console.log(`[Cleanup] Anonymized ${eventRes.modifiedCount} historical visits (> 30 days).`);

    // 3. Optional: Clear coordinates for users with 'red' (invisible) status
    // To ensure "Invisible" really means no location trace in DB.
    const invisibleRes = await User.updateMany(
      { status: 'red', 'location.coordinates': { $ne: [0, 0] } },
      { $set: { 'location.coordinates': [0, 0] } }
    );
    console.log(`[Cleanup] Wiped coordinates for ${invisibleRes.modifiedCount} invisible (Red) users.`);

    console.log('--- Privacy Cleanup Task Finished ---');
    process.exit(0);
  } catch (err) {
    console.error('Cleanup failed:', err);
    process.exit(1);
  }
}

cleanup();
