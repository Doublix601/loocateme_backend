import { Location } from '../models/Location.js';
import { User } from '../models/User.js';

export const LocationController = {
  getLocations: async (req, res, next) => {
    try {
      const lat = parseFloat(req.query.lat);
      const lon = parseFloat(req.query.lon);

      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ code: 'INVALID_COORDINATES', message: 'Invalid coordinates' });
      }

      // Pagination simple par "limit" (min 20, max 50).
      // Le client demande au minimum 20 lieux et peut en charger plus jusqu'à 50
      // en faisant défiler la liste (cf. LocationListScreen onEndReached).
      const MIN_LIMIT = 20;
      const MAX_LIMIT = 50;
      let limit = parseInt(req.query.limit, 10);
      if (!Number.isFinite(limit) || limit < MIN_LIMIT) limit = MIN_LIMIT;
      if (limit > MAX_LIMIT) limit = MAX_LIMIT;

      const getAggregatedLocations = async (maxDistance) => {
        return await Location.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [lon, lat] },
              distanceField: 'distance',
              maxDistance: maxDistance,
              spherical: true,
            },
          },
          {
            $lookup: {
              from: 'users',
              let: { locationId: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$currentLocation', '$$locationId'] },
                    status: { $in: ['green', 'orange'] },
                    $or: [
                      { 'location.updatedAt': { $gte: new Date(Date.now() - 5 * 60 * 1000) } },
                      { boostUntil: { $gte: new Date() } }
                    ]
                  },
                },
                { $project: { _id: 1, profileImageUrl: 1, status: 1, boostUntil: 1, location: 1 } },
                { $limit: 3 },
              ],
              as: 'activeUsers',
            },
          },
          {
            $lookup: {
              from: 'users',
              let: { locationId: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$currentLocation', '$$locationId'] },
                    status: { $ne: 'red' },
                    $or: [
                      { 'location.updatedAt': { $gte: new Date(Date.now() - 5 * 60 * 1000) } },
                      { boostUntil: { $gte: new Date() } }
                    ]
                  },
                },
                { $count: 'count' },
              ],
              as: 'userCount',
            },
          },
          {
            $addFields: {
              userCount: { $ifNull: [{ $arrayElemAt: ['$userCount.count', 0] }, 0] },
            },
          },
          // On ajoute un champ de tri : prioritaire si popularité > 0 ou userCount > 0 ou stars > 0
          {
            $addFields: {
              isPriority: {
                $cond: {
                  if: {
                    $or: [
                      { $gt: ['$popularity', 0] },
                      { $gt: ['$userCount', 0] },
                      { $gt: ['$stars', 0] },
                    ],
                  },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          {
            $sort: {
              isPriority: -1,
              userCount: -1,
              popularity: -1,
              distance: 1,
            },
          },
        ]);
      };

      let locations = await getAggregatedLocations(10000); // 10km

      // Si on a moins que la limite demandée, on élargit à 30km
      if (locations.length < limit) {
        locations = await getAggregatedLocations(30000); // 30km
      }

      // On veut au minimum `limit` lieux (20 par défaut, jusqu'à 50) triés par
      // distance/priorité. Les prioritaires (popularité, utilisateurs, étoiles)
      // sont déjà en tête grâce au $sort, on tronque simplement à `limit`.
      locations = locations.slice(0, limit);

      return res.json({ locations });
    } catch (err) {
      next(err);
    }
  },

  getLocationById: async (req, res, next) => {
    try {
      const { id } = req.params;
      const location = await Location.findById(id);
      if (!location) {
        return res.status(404).json({ code: 'LOCATION_NOT_FOUND', message: 'Location not found' });
      }

      // Fetch users checked-in at this location, excluding 'red' status and respecting GDPR
      const threshold = new Date(Date.now() - 5 * 60 * 1000);
      const now = new Date();
      const users = await User.find({
        currentLocation: id,
        status: { $ne: 'red' },
        $or: [
          { 'location.updatedAt': { $gte: threshold } },
          { boostUntil: { $gte: now } }
        ]
      })
      .select('-password')
      .sort({ boostUntil: -1, createdAt: 1 }); // Prioritize boosted users

      // Add isGhost flag for boosted users who are offline
      const usersWithGhostFlag = users.map(user => {
        const isOffline = user.location && user.location.updatedAt < threshold;
        const isBoosted = user.boostUntil && user.boostUntil >= now;
        return {
          ...user.toObject(),
          isGhost: isOffline && isBoosted
        };
      });

      return res.json({ location, users: usersWithGhostFlag });
    } catch (err) {
      next(err);
    }
  },

  syncOsmLocations: async (req, res, next) => {
    try {
      const { locations } = req.body;

      if (!Array.isArray(locations)) {
        return res.status(400).json({ code: 'INVALID_DATA', message: 'locations must be an array' });
      }

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const ops = locations.map((loc) => {
        const { osmId, name, city, type, coordinates } = loc;

        return {
          updateOne: {
            filter: {
              osmId: osmId,
              $or: [
                { lastOsmSyncAt: { $exists: false } },
                { lastOsmSyncAt: { $lt: yesterday } },
              ],
            },
            update: {
              $set: {
                osmId: osmId,
                name: name,
                city: city,
                type: type,
                location: {
                  type: 'Point',
                  coordinates: coordinates,
                },
                lastOsmSyncAt: now,
              },
            },
            upsert: true,
          },
        };
      });

      // On utilise bulkWrite mais on doit faire attention :
      // Si le filtre (lastOsmSyncAt < yesterday) ne matche pas, l'opération sera ignorée ou fera un upsert si non trouvé.
      // S'il y a un upsert, osmId sera unique.

      if (ops.length > 0) {
        // Cleanup old manual test locations (without osmId) that are not persistent (stars < 3)
        // OR locations explicitly marked for deletion (shouldDelete: true)
        // This ensures that only OSM locations and important partners remain.
        await Location.deleteMany({
          $or: [
            { osmId: { $exists: false }, stars: { $lt: 3 } },
            { shouldDelete: true }
          ]
        });

        // Note: upsert: true créera le document s'il n'existe pas du tout.
        // Si le document existe mais a été mis à jour il y a moins de 24h,
        // le filtre osmId + lastOsmSyncAt < yesterday échouera.
        // MAIS l'upsert risque de tenter de créer un NOUVEAU document avec le même osmId,
        // ce qui échouera à cause de l'index unique sur osmId.
        // C'est exactement ce qu'on veut pour ignorer silencieusement les doublons récents.

        try {
          const result = await Location.bulkWrite(ops, { ordered: false });
          return res.json({
            success: true,
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount
          });
        } catch (bulkError) {
          // ordered: false permet de continuer même si certains échouent (ex: E11000 duplicate key sur osmId)
          return res.json({
            success: true,
            message: 'Sync partially completed or some items already up to date',
            details: bulkError.message
          });
        }
      }

      return res.json({ success: true, message: 'No locations to sync' });
    } catch (err) {
      next(err);
    }
  },
};
