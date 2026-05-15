import { User } from '../models/User.js';
import { Location } from '../models/Location.js';
import { Event } from '../models/Event.js';
import { redisClient } from '../config/redis.js';
import { sendPushUnified } from './push.service.js';
import { NotificationDedup } from '../models/NotificationDedup.js';

// Build a diacritic-insensitive regex by expanding common French accented letters
function buildDiacriticRegex(input) {
  const map = {
    a: '[aàáâäåæAÀÁÂÄÅÆ]',
    c: '[cçCÇ]',
    e: '[eèéêëEÈÉÊË]',
    i: '[iìíîïIÌÍÎÏ]',
    o: '[oòóôöøœOÒÓÔÖØŒ]',
    u: '[uùúûüUÙÚÛÜ]',
    y: '[yÿYŸ]',
    n: '[nñNÑ]',
  };
  const escaped = String(input || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = '';
  for (const ch of escaped) {
    const lower = ch.toLowerCase();
    if (map[lower]) pattern += map[lower];
    else pattern += ch;
  }
  return new RegExp(pattern, 'i');
}

const GEO_CACHE_TTL = 5; // seconds

export async function getBlockedIds(userId) {
  if (!userId) return [];
  try {
    const [me, blockedBy] = await Promise.all([
      User.findById(userId).select('blockedUsers').lean(),
      User.find({ blockedUsers: userId }).select('_id').lean(),
    ]);
    const blocked = Array.isArray(me?.blockedUsers) ? me.blockedUsers.map((id) => id.toString()) : [];
    const blockedByIds = Array.isArray(blockedBy) ? blockedBy.map((u) => String(u._id)) : [];
    return Array.from(new Set([...blocked, ...blockedByIds]));
  } catch {
    return [];
  }
}

export async function getUserByIdForViewer({ userId, targetId }) {
  if (!targetId) return null;
  const target = await User.findById(targetId).select('-password').lean();
  if (!target) return null;
  if (String(userId) !== String(targetId)) {
    if (target.status === 'red' || target.emailVerified === false) return null;
    const blockedIds = await getBlockedIds(userId);
    if (blockedIds.includes(String(targetId))) return null;
  }
  return target;
}

export async function getUserByEmail(email) {
  const user = await User.findOne({ email }).select('-password');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
}

export async function getUsersByEmails(emails) {
  const unique = Array.from(new Set(emails));
  const users = await User.find({ email: { $in: unique } }).select('-password');
  return users;
}

export async function updateLocation(userId, { lat, lon }) {
  const userToUpdate = await User.findById(userId).select('currentLocation pendingLocation pendingLocationSince location');
  if (!userToUpdate) throw Object.assign(new Error('User not found'), { status: 404 });

  const oldLocationId = userToUpdate.currentLocation;
  const oldPendingLocationId = userToUpdate.pendingLocation;
  const oldPendingSince = userToUpdate.pendingLocationSince;
  const oldLocation = userToUpdate.location || { type: 'Point', coordinates: [0, 0] };

  // Utilisation de l'agrégation pour obtenir les distances exactes et gérer le rayon par lieu
  const geoNearResult = await Location.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lon, lat] },
        distanceField: 'dist',
        maxDistance: 200, // On cherche un peu plus large pour l'hystérésis
        spherical: true,
      },
    },
    { $limit: 5 }
  ]);

  let matchedLocationId = null;
  if (geoNearResult.length > 0) {
    // 1. Logique d'hystérésis : si l'utilisateur était déjà dans un lieu, on vérifie s'il y est encore
    const oldLocationInList = oldLocationId ? geoNearResult.find(p => String(p._id) === String(oldLocationId)) : null;

    if (oldLocationInList && oldLocationInList.dist <= (oldLocationInList.radius || 40) * 1.2) {
      matchedLocationId = oldLocationId;
    } else {
      // 2. Sinon, on prend le plus proche, s'il est dans son rayon de détection
      const nearest = geoNearResult[0];
      if (nearest.dist <= (nearest.radius || 40)) {
        matchedLocationId = nearest._id;
      }
    }
  }

  const update = {
    location: { type: 'Point', coordinates: [lon, lat], updatedAt: new Date() },
  };

  // Privacy: If the user is already confirmed at a POI, we avoid storing/updating raw coordinates
  // to minimize location tracking history. We only update the presence status.
  const isAlreadyConfirmedAtPOI = oldLocationId && matchedLocationId && String(oldLocationId) === String(matchedLocationId);

  if (isAlreadyConfirmedAtPOI) {
    // Data Minimization: Don't update coordinates, just update the timestamp
    update.location = { ...oldLocation, updatedAt: new Date() };
  }

  // Mise à jour instantanée de la présence : dès que l'utilisateur est physiquement
  // dans le rayon d'un POI il est compté, et dès qu'il en sort il est retiré.
  // Les champs `pendingLocation` / `pendingLocationSince` (ancienne logique d'hystérésis
  // temporelle de 2 minutes) sont conservés au schéma pour rétrocompatibilité mais
  // toujours remis à null.
  update.pendingLocation = null;
  update.pendingLocationSince = null;

  if (!matchedLocationId) {
    // L'utilisateur n'est dans aucun POI → retrait immédiat
    update.currentLocation = null;
  } else if (String(matchedLocationId) === String(oldLocationId)) {
    // L'utilisateur est déjà dans ce POI, rien à changer côté présence
  } else {
    // Entrée immédiate dans le POI matché (nouveau ou différent de l'ancien)
    update.currentLocation = matchedLocationId;
    // Safety check: clear boostUntil to prevent being a "Ghost" in an old Bar
    // while being "Present" in a new one.
    update.boostUntil = null;
    console.log(`[Presence] User ${userId} entered POI ${matchedLocationId} (instant)`);
  }
  void oldPendingLocationId; void oldPendingSince; // kept for backward-compat reads

  const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true });

  const currentLocationId = user.currentLocation;

  // Record a location_visit if the user just checked into a new location
  if (currentLocationId && String(currentLocationId) !== String(oldLocationId)) {
    try {
      // De-duplicate visits: only one visit per user/location per 12 hours
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      const existingVisit = await Event.findOne({
        type: 'location_visit',
        actor: userId,
        locationId: currentLocationId,
        createdAt: { $gt: twelveHoursAgo }
      });

      if (!existingVisit) {
        await Event.create({
          type: 'location_visit',
          actor: userId,
          locationId: currentLocationId
        });
      }
    } catch (e) {
      console.warn('[user.service] Failed to record location_visit', e.message);
    }
  }

  // Optional: cache in Redis GEOSET
  try {
    await redisClient.geoAdd('geo:users', [{ longitude: lon, latitude: lat, member: userId.toString() }]);
  } catch {}
  return user;
}

export async function getNearbyUsers({ userId, lat, lon, radiusMeters = 2000 }) {
  const freshnessMs = 5 * 60 * 1000; // Heartbeat: 5 minutes TTL for visibility
  const threshold = new Date(Date.now() - freshnessMs);
  const blockedIds = await getBlockedIds(userId);
  const excludeIds = Array.from(new Set([String(userId), ...blockedIds]));
  // Try Redis first
  try {
    const members = await redisClient.geoSearch('geo:users', {
      latitude: lat,
      longitude: lon,
      radius: radiusMeters,
      unit: 'm',
      WITHDIST: true,
      COUNT: 100,
    });
    if (Array.isArray(members) && members.length > 0) {
      const requesterId = String(userId);
      const ids = members
        .map((m) => m.member)
        .filter((id) => id && !excludeIds.includes(String(id)));
      if (ids.length === 0) {
        console.log(`[getNearbyUsers] Redis: Found ${members.length} total, but 0 after exclusion. Requester=${userId}`);
        return [];
      }
      const users = await User.find({
        _id: { $in: ids },
        status: { $ne: 'red' },
        emailVerified: true,
        $or: [
          { 'location.updatedAt': { $gte: threshold } },
          { boostUntil: { $gte: new Date() } }
        ]
      })
      .select('-password')
      .sort({ boostUntil: -1 });

      console.log(`[getNearbyUsers] Redis audit: Found=${users.length}/${ids.length} candidates. Threshold=${threshold.toISOString()}. ExcludedIdsCount=${excludeIds.length}`);
      return users;
    }
  } catch (err) {
    console.warn('[getNearbyUsers] Redis search failed:', err.message);
  }

  // Fallback to MongoDB geospatial query
  const users = await User.find({
    _id: { $nin: excludeIds },
    status: { $ne: 'red' },
    emailVerified: true,
    'location.updatedAt': { $gte: threshold },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lon, lat] },
        $maxDistance: radiusMeters,
      },
    },
  })
    .sort({ boostUntil: -1 })
    .limit(100)
    .select('-password');

  console.log(`[getNearbyUsers] MongoDB audit: Found=${users.length} users. Threshold=${threshold.toISOString()}. Radius=${radiusMeters}m`);
  return users;
}

export async function getPopularUsers({ userId = null, limit = 10 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
  const query = { status: { $ne: 'red' }, emailVerified: true };
  if (userId) {
    const blockedIds = await getBlockedIds(userId);
    const excludeIds = Array.from(new Set([String(userId), ...blockedIds]));
    Object.assign(query, { _id: { $nin: excludeIds } });
  }
  const users = await User.find(query)
    .sort({ profileViews: -1, createdAt: -1 })
    .limit(safeLimit)
    .select('-password');
  return users;
}

export async function searchUsers({ q = '', limit = 10, excludeUserId = null } = {}) {
  // Enforce max 10 results regardless of client request
  const safeLimit = Math.max(1, Math.min(10, parseInt(limit, 10) || 10));
  const query = { status: { $ne: 'red' } };
  if (excludeUserId) {
    const blockedIds = await getBlockedIds(excludeUserId);
    const excludeIds = Array.from(new Set([String(excludeUserId), ...blockedIds]));
    Object.assign(query, { _id: { $nin: excludeIds } });
  }

  const s = String(q || '').trim();
  // Require at least 2 characters to avoid overloading API
  if (!s || s.length < 2) {
    return [];
  }
  // Case-insensitive and accent-insensitive partial match on multiple fields
  const re = buildDiacriticRegex(s);
  Object.assign(query, {
    $or: [
      { username: re },
      { firstName: re },
      { lastName: re },
      { customName: re },
      { name: re },
      { email: { $regex: re } },
    ],
  });

  const users = await User.find(query)
    .limit(safeLimit)
    .select('-password')
    .lean();
  return users;
}
