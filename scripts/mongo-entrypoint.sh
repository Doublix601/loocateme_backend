#!/usr/bin/env bash
# mongo-entrypoint.sh
# Self-healing Mongo entrypoint: if admin user doesn't exist (pre-initialized data dir),
# bootstrap admin and app users without auth, then restart with --auth.
# Env: MONGO_INITDB_ROOT_USERNAME, MONGO_INITDB_ROOT_PASSWORD, MONGO_INITDB_DATABASE, MONGO_APP_PASSWORD
set -euo pipefail

ROOT_USER="${MONGO_INITDB_ROOT_USERNAME:-admin}"
ROOT_PWD="${MONGO_INITDB_ROOT_PASSWORD:-}"
APP_DB="${MONGO_INITDB_DATABASE:-loocateme}"
APP_PWD="${MONGO_APP_PASSWORD:-change-me-app}"

# Function to wait until mongod accepts connections
wait_for_mongo() {
  local retries=60
  while (( retries > 0 )); do
    if mongosh --quiet --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
    retries=$((retries-1))
  done
  return 1
}

# Check if admin user exists (works if no auth is enforced yet)
admin_exists=false
if mongosh --quiet --eval "db.getSiblingDB('admin').getUser('${ROOT_USER}')" > /dev/null 2>&1; then
  admin_exists=true
fi

if [ "${admin_exists}" != "true" ]; then
  echo "[mongo-entrypoint] Admin user not found. Bootstrapping without auth..."
  # Start mongod without auth in background
  mongod --bind_ip_all --fork --logpath /var/log/mongodb.log
  wait_for_mongo || { echo "[mongo-entrypoint] mongod failed to start"; exit 1; }

  if [ -n "${ROOT_PWD}" ]; then
    echo "[mongo-entrypoint] Creating admin user '${ROOT_USER}' and app user 'appuser'..."
    mongosh --quiet <<EOF
const admin = db.getSiblingDB('admin');
try {
  admin.createUser({ user: '${ROOT_USER}', pwd: '${ROOT_PWD}', roles: [{ role: 'root', db: 'admin' }] });
  print('[mongo-entrypoint] Admin user created.');
} catch (e) { print('[mongo-entrypoint] Admin create error: ' + e); }

const appdb = db.getSiblingDB('${APP_DB}');
try {
  appdb.createUser({ user: 'appuser', pwd: '${APP_PWD}', roles: [{ role: 'readWrite', db: '${APP_DB}' }] });
  print('[mongo-entrypoint] App user created.');
} catch (e) { print('[mongo-entrypoint] App user create error: ' + e); }

try { appdb.createCollection('users'); } catch (e) {}
try { appdb.users.createIndex({ location: '2dsphere' }, { name: 'location_2dsphere' }); } catch (e) {}
try { appdb.users.createIndex({ email: 1 }, { name: 'email_1', unique: true }); } catch (e) {}
EOF
  else
    echo "[mongo-entrypoint] WARNING: MONGO_INITDB_ROOT_PASSWORD not set; skipping admin creation."
  fi

  echo "[mongo-entrypoint] Shutting down no-auth mongod..."
  mongosh --quiet --eval "db.getSiblingDB('admin').shutdownServer()" || true
  # Give it a moment to stop
  sleep 2
fi

# Finally, exec mongod with auth enabled (PID 1)
echo "[mongo-entrypoint] Starting mongod with --auth"
exec mongod --bind_ip_all --auth
