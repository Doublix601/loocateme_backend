import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../src/models/User.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

async function cleanupZombies() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    console.log(`Searching for users with currentLocation but no update since ${fifteenMinutesAgo.toISOString()}...`);

    // Migration logic:
    // 1. Invalidate people who haven't moved/heartbeated in 15 mins
    // 2. Ensure everyone has an updatedAt field (if missing, we set it to now for this migration or nullify their location)
    const result = await User.updateMany(
      {
        currentLocation: { $ne: null },
        $or: [
          { 'location.updatedAt': { $lt: fifteenMinutesAgo } },
          { 'location.updatedAt': { $exists: false } }
        ]
      },
      { $set: { currentLocation: null } }
    );

    console.log(`Success: Cleared currentLocation for ${result.modifiedCount} zombie users.`);

    // Ensure the index is created
    await User.createIndexes();
    console.log('Indexes ensured.');

  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

cleanupZombies();
