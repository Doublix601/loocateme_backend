import { FeatureFlag } from '../models/FeatureFlag.js';

export const SettingsController = {
  // GET /api/settings/flags - Returns all feature flags (public endpoint)
  getFlags: async (req, res, next) => {
    try {
      const flags = await FeatureFlag.find({}).lean();
      const result = {};
      for (const f of flags) {
        result[f.key] = f.enabled;
      }
      return res.json({ flags: result });
    } catch (err) {
      next(err);
    }
  },
};
