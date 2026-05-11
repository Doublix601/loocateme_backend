/**
 * Migration 002: Set user with email "arnaud.theret" (or starts with) as admin
 *
 * Specifically targets arnaud.theret as requested.
 */

import { User } from '../models/User.js';

export async function migrate() {
  // Find user with email matching arnaud.theret (case-insensitive)
  // We check for email because arnaud.theret looks like a partial email or username
  const user = await User.findOne({
    $or: [
      { email: { $regex: /^arnaud\.theret/i } },
      { username: { $regex: /^arnaud\.theret/i } }
    ]
  });

  if (!user) {
    console.log('User "arnaud.theret" not found. Migration skipped.');
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

  console.log(`✅ User "${user.username}" (${user.email}) is now admin.`);
}

export default migrate;
