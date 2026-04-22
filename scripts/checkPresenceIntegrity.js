import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../src/models/User.js';

dotenv.config({ path: './.env' });

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

async function checkIntegrity() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.\n');

    const threshold = new Date(Date.now() - 15 * 60 * 1000);
    console.log(`Threshold (15 min ago): ${threshold.toISOString()}`);

    // Find "Present" users who haven't been seen recently
    // In this app, presence seems to be indicated by `currentLocation` being set
    const orphanUsers = await User.find({
      currentLocation: { $ne: null },
      $or: [
        { 'location.updatedAt': { $lt: threshold } },
        { 'location.updatedAt': { $exists: false } }
      ]
    }).select('username email location currentLocation').lean();

    console.log(`Found ${orphanUsers.length} users with "orphan" presence (last_seen < 15min but still has currentLocation).`);

    if (orphanUsers.length > 0) {
      console.log('\n--- Orphan Users Detail ---');
      orphanUsers.forEach(u => {
        console.log(`User: ${u.username || u.email}`);
        console.log(`  Last Seen: ${u.location?.updatedAt ? u.location.updatedAt.toISOString() : 'Never'}`);
        console.log(`  Current Location ID: ${u.currentLocation}`);
        console.log('---------------------------');
      });
    }

    // Summary of all active users
    const activeCount = await User.countDocuments({
      'location.updatedAt': { $gte: threshold }
    });
    console.log(`\nSummary:`);
    console.log(`- Total users in DB: ${await User.countDocuments()}`);
    console.log(`- Active users (seen in last 15min): ${activeCount}`);
    console.log(`- Users currently in a POI: ${await User.countDocuments({ currentLocation: { $ne: null } })}`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

checkIntegrity();
