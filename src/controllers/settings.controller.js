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
      // Piloté par variable d'environnement (pas en base) : le produit veut pouvoir
      // activer/désactiver la vérification d'âge Didit avec un seul redémarrage API,
      // sans passer par l'admin (cf. loi "majorité numérique" pas encore promulguée).
      result.ageVerificationEnabled = process.env.DIDIT_AGE_VERIFICATION_ENABLED === 'true';
      return res.json({ flags: result });
    } catch (err) {
      next(err);
    }
  },
};
