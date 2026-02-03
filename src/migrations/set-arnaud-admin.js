/**
 * Migration: Set user with username "Arnaud" (case-insensitive) as admin
 * 
 * Run with: node src/migrations/set-arnaud-admin.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.js';

async function migrate() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/loocateme';
  
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected.');

  // Find user with username "arnaud" (case-insensitive)
  const user = await User.findOne({ 
    username: { $regex: /^arnaud$/i } 
  });

  if (!user) {
    console.log('User "Arnaud" not found. Migration skipped.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Found user: ${user.username} (${user.email})`);
  console.log(`Current role: ${user.role || 'user'}`);

  if (user.role === 'admin') {
    console.log('User is already admin. No changes needed.');
    await mongoose.disconnect();
    process.exit(0);
  }

  user.role = 'admin';
  await user.save();

  console.log(`✅ User "${user.username}" is now admin.`);

  await mongoose.disconnect();
  console.log('Migration complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
