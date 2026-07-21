import mongoose from 'mongoose';

let attemptedAppUserCreate = false;

function parseMongoFromUri(uri) {
  try {
    const u = new URL(uri);
    const host = u.host || 'mongo:27017';
    let dbName = (u.pathname || '/').replace(/^\/+/, '').trim();
    if (!dbName) dbName = process.env.MONGO_INITDB_DATABASE || 'loocateme';
    // Remove query string artifacts from pathname if any
    dbName = dbName.split('?')[0] || dbName;
    return { host, dbName };
  } catch (_e) {
    return { host: 'mongo:27017', dbName: process.env.MONGO_INITDB_DATABASE || 'loocateme' };
  }
}

async function ensureAppUserViaRoot(uri) {
  const rootPwd = process.env.MONGO_ROOT_PASSWORD;
  const appPwd = process.env.MONGO_APP_PASSWORD || 'change-me-app';
  if (!rootPwd) return false;
  const { host, dbName } = parseMongoFromUri(uri);
  const rootUri = `mongodb://admin:${encodeURIComponent(rootPwd)}@${host}/admin?authSource=admin`;
  let conn;
  try {
    conn = mongoose.createConnection(rootUri, { serverSelectionTimeoutMS: 5000 });
    await conn.asPromise();
    const client = conn.getClient();
    const target = client.db(dbName);
    try {
      await target.command({
        createUser: 'appuser',
        pwd: String(appPwd),
        roles: [{ role: 'readWrite', db: dbName }],
      });
      console.log(`[mongo] Created application user "appuser" on db "${dbName}"`);
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('already exists') || e?.code === 51003 || e?.codeName === 'DuplicateKey') {
        console.log('[mongo] Application user already exists; continuing.');
      } else {
        console.warn('[mongo] Failed to create application user via root:', msg);
      }
    }
    return true;
  } catch (e) {
    console.warn('[mongo] Admin connection failed; cannot auto-create app user:', e?.message || e);
    return false;
  } finally {
    try { await conn?.close(); } catch (_e2) {}
  }
}

export async function connectMongo() {
  const uri = (process.env.DOCKER_CONTAINER === 'true' || process.env.NODE_ENV === 'production')
    ? (process.env.MONGODB_URI || 'mongodb://mongo:27017/loocateme')
    : (process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/loocateme');
  mongoose.set('strictQuery', true);

  const maxDelay = 30000; // 30s cap
  let attempt = 0;

  while (true) {
    try {
      attempt += 1;
      await mongoose.connect(uri, {
        autoIndex: true,
        dbName: undefined,
        serverSelectionTimeoutMS: 5000,
        // 50 était dimensionné pour un seul process. En cluster PM2 (4 workers),
        // ça donnait jusqu'à 200 connexions simultanées vers un mongod unique
        // (confirmé en test de charge : sous contention CPU, un pool aussi large
        // fait plus de mal que de bien — Mongo passe son temps à faire du context
        // switching entre centaines d'opérations en attente au lieu d'avancer).
        // 15 par worker (60 au total) laisse une file d'attente plus courte et
        // plus gérable pour un mongod mono-instance.
        maxPoolSize: 15,
      });
      console.log('MongoDB connected');
      // Slow query log : sans ça, on ne sait jamais quelle requête devient le
      // prochain goulot d'étranglement avant qu'elle ne fasse mal en prod.
      // Non-bloquant : appuser peut ne pas avoir le rôle nécessaire (dbAdmin),
      // auquel cas on log un warning et on continue sans casser le démarrage.
      try {
        await mongoose.connection.db.command({ profile: 1, slowms: 100 });
        console.log('[mongo] Slow query profiling enabled (>100ms -> system.profile)');
      } catch (e) {
        console.warn('[mongo] Could not enable slow query profiling (non-fatal):', e?.message || e);
      }
      return;
    } catch (err) {
      // One-time attempt to auto-create the application user if auth fails and root creds are available
      const msg = err?.message || '';
      if (!attemptedAppUserCreate && process.env.MONGO_ROOT_PASSWORD) {
        attemptedAppUserCreate = true;
        await ensureAppUserViaRoot(uri).catch(() => {});
      }
      const delay = Math.min(1000 * Math.pow(2, Math.min(attempt, 5)), maxDelay);
      console.error(`MongoDB connection error (attempt ${attempt}): ${msg}. Retrying in ${Math.round(delay/1000)}s...`);
      // Do not crash the process; wait and retry
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
