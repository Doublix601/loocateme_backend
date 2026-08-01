import { User } from '../models/User.js';
import { CrossedPath } from '../models/CrossedPath.js';
import { applyNotBannedFilter, MIN_STAY_MS } from './user.service.js';

// Même fenêtre de fraîcheur que le threshold utilisé par getLocationById pour
// décider qui est "actuellement présent" à un lieu.
const FRESHNESS_MS = 5 * 60 * 1000;

// Enregistre un croisement entre `userId` et tous les autres utilisateurs
// actuellement présents (heartbeat frais + leurs propres 5 min de présence
// validées) au même lieu. Appelé en fire-and-forget depuis le heartbeat
// (updateLocation), une fois par (user, lieu) toutes les 12h — cf. le gate
// `existingVisit` qui entoure cet appel.
export async function recordCrossedPaths(userId, locationId) {
  if (!userId || !locationId) return;
  const now = new Date();
  const freshThreshold = new Date(now.getTime() - FRESHNESS_MS);
  const minStayThreshold = new Date(now.getTime() - MIN_STAY_MS);

  const others = await User.find(
    applyNotBannedFilter({
      _id: { $ne: userId },
      currentLocation: locationId,
      accountType: { $ne: 'business' },
      'location.updatedAt': { $gte: freshThreshold },
      currentLocationSince: { $lte: minStayThreshold },
    })
  )
    .select('_id')
    .lean();

  if (!others.length) return;

  const ops = [];
  for (const other of others) {
    for (const [a, b] of [
      [userId, other._id],
      [other._id, userId],
    ]) {
      ops.push({
        updateOne: {
          filter: { userId: a, otherUserId: b, locationId },
          update: {
            $set: { lastSeenAt: now },
            $inc: { crossCount: 1 },
            $setOnInsert: { userId: a, otherUserId: b, locationId },
          },
          upsert: true,
        },
      });
    }
  }
  await CrossedPath.bulkWrite(ops, { ordered: false });
}
