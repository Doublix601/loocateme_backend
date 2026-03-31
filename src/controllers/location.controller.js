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

      let radius = 10000; // 10km
      let locations = await Location.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lon, lat] },
            distanceField: 'distance',
            maxDistance: radius,
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
        { $sort: { popularity: -1 } },
      ]);

      if (locations.length === 0) {
        radius = 30000; // 30km
        locations = await Location.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [lon, lat] },
              distanceField: 'distance',
              maxDistance: radius,
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
          { $sort: { popularity: -1 } },
        ]);
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
