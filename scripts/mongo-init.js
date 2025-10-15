// scripts/mongo-init.js
// This script is executed by the official MongoDB Docker image on first container init.
// It creates an application user with readWrite on the "loocateme" database, using the
// root credentials provided via MONGO_INITDB_ROOT_USERNAME/PASSWORD.

// The environment variables are not directly available in this JS runtime, but the
// entrypoint runs this with a connection already established as the root user, with
// the default database selected to MONGO_INITDB_DATABASE.

// Create app user if it does not exist
(function() {
  const dbName = process.env.MONGO_INITDB_DATABASE || 'loocateme';
  const appUser = 'appuser';
  const appPass = process.env.MONGO_APP_PASSWORD || 'change-me-app-pass';

  // Switch to admin to ensure we can query and create users db-wide
  const admin = db.getSiblingDB('admin');
  const target = db.getSiblingDB(dbName);

  try {
    const users = admin.getUsers();
    const exists = users && users.some(u => u.user === appUser);
    if (!exists) {
      print(`[mongo-init] Creating application user "${appUser}" for db "${dbName}"`);
      admin.createUser({
        user: appUser,
        pwd: appPass,
        roles: [
          { role: 'readWrite', db: dbName },
        ],
      });
    } else {
      print(`[mongo-init] Application user "${appUser}" already exists, skipping.`);
    }
  } catch (e) {
    print(`[mongo-init] Error while creating application user: ${e}`);
  }

  // Ensure required collections and indexes exist (optional but handy)
  try {
    target.createCollection('users');
    target.users.createIndex({ location: '2dsphere' }, { name: 'location_2dsphere' });
    target.users.createIndex({ email: 1 }, { name: 'email_1', unique: true });
    print('[mongo-init] Ensured indexes on users collection');
  } catch (e2) {
    print(`[mongo-init] Index ensure error: ${e2}`);
  }
})();
