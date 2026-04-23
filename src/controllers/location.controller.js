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
                    'location.updatedAt': { $gte: new Date(Date.now() - 5 * 60 * 1000) }, // Heartbeat: 5 minutes TTL
                  },
                },
                { $project: { _id: 1, profileImageUrl: 1, status: 1 } },
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
                    'location.updatedAt': { $gte: new Date(Date.now() - 5 * 60 * 1000) }, // Heartbeat: 5 minutes TTL
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

      // Si on a moins de 10 lieux au total (populaires ou non), on passe à 30km
      if (locations.length < 10) {
        locations = await getAggregatedLocations(30000); // 30km
      }

      // Si on a toujours moins de 10 lieux (très peu probable à 30km, mais sait-on jamais)
      // On retourne ce qu'on a. Sinon on limite les non-populaires pour ne pas en avoir trop?
      // L'énoncé dit "afficher des lieux moins populaires [...] afin qu'il y en ait 10 dans la liste"
      // Ça suggère qu'on veut exactement 10 si on doit compléter.
      // Mais si on a déjà 15 lieux populaires, on garde les 15.

      const priorityLocations = locations.filter(l => l.isPriority === 1);
      if (priorityLocations.length < 10) {
        // On prend tous les prioritaires + assez de non-prioritaires pour arriver à 10
        const nonPriorityLocations = locations.filter(l => l.isPriority === 0);
        const needed = 10 - priorityLocations.length;
        locations = [...priorityLocations, ...nonPriorityLocations.slice(0, needed)];
      } else {
        // On a déjà assez de prioritaires, on ne garde que ceux-là
        locations = priorityLocations;
      }

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
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const users = await User.find({
        currentLocation: id,
        status: { $ne: 'red' },
        'location.updatedAt': { $gte: fiveMinutesAgo },
      })
      .select('-password')
      .sort({ boostUntil: -1, createdAt: 1 }); // Prioritize boosted users

      return res.json({ location, users });
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
