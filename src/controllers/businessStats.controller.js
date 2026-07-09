import { getLocationStats } from '../services/businessStats.service.js';

export const BusinessStatsController = {
  get: async (req, res, next) => {
    try {
      const stats = await getLocationStats(req.location._id);
      return res.json(stats);
    } catch (err) {
      next(err);
    }
  },
};
