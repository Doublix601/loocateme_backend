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
                    isVisible: true,
                    status: { $in: ['green', 'orange'] },
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
                    isVisible: true,
                    status: { $ne: 'red' },
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
          // On ajoute un champ de tri : prioritaire si popularité > 0 ou userCount > 0
          {
            $addFields: {
              isPriority: {
                $cond: {
                  if: { $or: [{ $gt: ['$popularity', 0] }, { $gt: ['$userCount', 0] }] },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          {
            $sort: {
              isPriority: -1,
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
      const users = await User.find({
        currentLocation: id,
        status: { $ne: 'red' },
        isVisible: true,
      }).select('-password');

      return res.json({ location, users });
    } catch (err) {
      next(err);
    }
  },
};
