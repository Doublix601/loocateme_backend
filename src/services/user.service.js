import { User } from '../models/User.js';
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
  const update = {
    location: { type: 'Point', coordinates: [lon, lat], updatedAt: new Date() },
  };
  const user = await User.findByIdAndUpdate(userId, update, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  
  // Logic: Notify if a new active neighbor is detected (within 500m)
  try {
    const nearby = await User.find({
      _id: { $ne: userId },
      isVisible: true,
      emailVerified: true,
      'location.updatedAt': { $gte: new Date(Date.now() - 30 * 60 * 1000) }, // Active in last 30 mins
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lon, lat] },
          $maxDistance: 500,
        },
      },
    }).limit(3);

    for (const neighbor of nearby) {
      // Dedup per neighbor-pair to avoid spam (once per 12h)
      const dedupKey = `neighbor:${userId}:${neighbor._id}`;
      try {
        const alreadyNotified = await NotificationDedup.findOne({ targetUser: userId, viewerUser: neighbor._id, eventType: 'new_neighbor' });
        if (!alreadyNotified) {
          await NotificationDedup.create({ targetUser: userId, viewerUser: neighbor._id, eventType: 'new_neighbor' });
          
          const name = (neighbor.customName || neighbor.firstName || neighbor.username || 'Quelqu’un').trim();
          await sendPushUnified({
            userIds: [userId],
            title: 'Nouveau voisin !',
            body: `${name} est juste à côté de toi. Fais-lui signe ! 👋`,
            data: { kind: 'new_neighbor', neighborId: String(neighbor._id) }
          });
        }
      } catch (_) {}
    }
  } catch (e) {
    console.warn('[user.service] neighbor notification failed', e.message);
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
        .filter((id) => id && id !== requesterId);
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
    _id: { $ne: userId },
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
  if (userId) Object.assign(query, { _id: { $ne: userId } });
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
  if (excludeUserId) Object.assign(query, { _id: { $ne: excludeUserId } });

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
