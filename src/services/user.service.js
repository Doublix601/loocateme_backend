import { User } from '../models/User.js';
import { redisClient } from '../config/redis.js';

const GEO_CACHE_TTL = 5; // seconds

export async function getUserByEmail(email) {
  const user = await User.findOne({ email }).select('-password');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
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

export async function getNearbyUsers({ userId, lat, lon, radiusMeters = 300 }) {
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
      const ids = members.map((m) => m.member);
      const users = await User.find({ _id: { $in: ids }, isVisible: true }).select('-password');
      return users;
    }
  } catch {}

  // Fallback to MongoDB geospatial query
  const users = await User.find({
    _id: { $ne: userId },
    isVisible: true,
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
