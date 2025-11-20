import { User } from '../models/User.js';
import { redisClient } from '../config/redis.js';

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
  // Optional: cache in Redis GEOSET
  try {
    await redisClient.geoAdd('geo:users', [{ longitude: lon, latitude: lat, member: userId.toString() }]);
  } catch {}
  return user;
}

export async function getNearbyUsers({ userId, lat, lon, radiusMeters = 2000 }) {
  const freshnessMs = 60 * 60 * 1000; // 1 hour
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
      const users = await User.find({ _id: { $in: ids }, isVisible: true, 'location.updatedAt': { $gte: threshold } }).select('-password');
      return users;
    }
  } catch {}

  // Fallback to MongoDB geospatial query
  const users = await User.find({
    _id: { $ne: userId },
    isVisible: true,
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
  const query = { isVisible: true };
  if (userId) Object.assign(query, { _id: { $ne: userId } });
  const users = await User.find(query)
    .sort({ profileViews: -1, createdAt: -1 })
    .limit(safeLimit)
    .select('-password');
  return users;
}

export async function searchUsers({ q = '', limit = 20, excludeUserId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));
  const query = { isVisible: true };
  if (excludeUserId) Object.assign(query, { _id: { $ne: excludeUserId } });

  const s = String(q || '').trim();
  if (!s) {
    return [];
  }
  // Case-insensitive partial match on multiple fields
  const safe = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(safe, 'i');
  Object.assign(query, {
    $or: [
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
