/**
 * Migration 001: Set user with username "Arnaud" (case-insensitive) as admin
 *
 * This migration is executed by the migration runner (run-migrations.js).
 * The runner handles MongoDB connection, so this file only contains the migration logic.
 */

import { User } from '../models/User.js';

export async function migrate() {
  // Find user with username "arnaud" (case-insensitive)
  const user = await User.findOne({
    username: { $regex: /^arnaud$/i }
  });

  if (!user) {
    console.log('User "Arnaud" not found. Migration skipped.');
    return;
  }

  console.log(`Found user: ${user.username} (${user.email})`);
  console.log(`Current role: ${user.role || 'user'}`);

  if (user.role === 'admin') {
    console.log('User is already admin. No changes needed.');
    return;
  }

  user.role = 'admin';
  await user.save();

  console.log(`✅ User "${user.username}" is now admin.`);
}

export default migrate;
