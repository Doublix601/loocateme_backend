import { User } from '../models/User.js';
import { Location } from '../models/Location.js';
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
    if (target.isVisible === false || target.emailVerified === false) return null;
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
  const oldUser = await User.findById(userId).select('currentLocation');
  const oldLocationId = oldUser?.currentLocation;

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

  let currentLocationId = null;
  if (geoNearResult.length > 0) {
    // 1. Logique d'hystérésis : si l'utilisateur était déjà dans un lieu, on vérifie s'il y est encore
    const oldLocationInList = oldLocationId ? geoNearResult.find(p => String(p._id) === String(oldLocationId)) : null;

    if (oldLocationInList && oldLocationInList.dist <= (oldLocationInList.radius || 100) * 1.1) {
      // On reste dans le lieu actuel (avec 10% de marge de sortie pour éviter les sauts)
      currentLocationId = oldLocationId;
    } else {
      // 2. Sinon, on prend le plus proche, s'il est dans son rayon de détection
      const nearest = geoNearResult[0];
      if (nearest.dist <= (nearest.radius || 100)) {
        currentLocationId = nearest._id;
      }
    }
  }

  const update = {
    location: { type: 'Point', coordinates: [lon, lat], updatedAt: new Date() },
    currentLocation: currentLocationId,
  };

  const user = await User.findByIdAndUpdate(userId, update, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  // Update popularity of affected locations
  if (currentLocationId) {
    const count = await User.countDocuments({ currentLocation: currentLocationId });
    await Location.findByIdAndUpdate(currentLocationId, { popularity: count });
  }

  if (oldLocationId && String(oldLocationId) !== String(currentLocationId)) {
    const count = await User.countDocuments({ currentLocation: oldLocationId });
    await Location.findByIdAndUpdate(oldLocationId, { popularity: count });
  }

  // Optional: cache in Redis GEOSET
  try {
    await redisClient.geoAdd('geo:users', [{ longitude: lon, latitude: lat, member: userId.toString() }]);
  } catch {}
  return user;
}

export async function getNearbyUsers({ userId, lat, lon, radiusMeters = 2000 }) {
  const freshnessMs = 6 * 60 * 60 * 1000; // 6 hours
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
      if (ids.length === 0) return [];
      const users = await User.find({
        _id: { $in: ids },
        isVisible: true,
        emailVerified: true,
        'location.updatedAt': { $gte: threshold },
      }).select('-password');
      return users;
    }
  } catch {}

  // Fallback to MongoDB geospatial query
  const users = await User.find({
    _id: { $nin: excludeIds },
    isVisible: true,
    emailVerified: true,
    'location.updatedAt': { $gte: threshold },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lon, lat] },
        $maxDistance: radiusMeters,
      },
    },
  })
    .limit(100)
    .select('-password');

  return users;
}

export async function getPopularUsers({ userId = null, limit = 10 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
  const query = { isVisible: true, emailVerified: true };
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
  const query = { isVisible: true };
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
