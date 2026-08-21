import { Location } from '../models/Location.js';
import { verifyUnsubscribeToken } from '../services/businessDigest.service.js';

export const BusinessDigestController = {
  // Public (pas de requireAuth) : cliqué depuis un client mail, sans session pro
  // active. Le token porte sa propre preuve d'autorisation (cf. businessDigest.service.js).
  // Toujours une redirection navigateur, jamais un JSON brut.
  unsubscribe: async (req, res) => {
    const siteUrl = process.env.BUSINESS_SITE_PUBLIC_URL || 'http://localhost:3000';
    try {
      const locationId = verifyUnsubscribeToken(req.query.token);
      if (!locationId) {
        return res.redirect(`${siteUrl}/dashboard/settings?digest=error`);
      }
      const result = await Location.updateOne(
        { _id: locationId },
        { 'notificationPreferences.weeklyDigestEmail': false }
      );
      if (result.matchedCount === 0) {
        return res.redirect(`${siteUrl}/dashboard/settings?digest=error`);
      }
      return res.redirect(`${siteUrl}/dashboard/settings?digest=unsubscribed`);
    } catch (e) {
      console.error('[businessDigest] Unsubscribe failed:', e?.message || e);
      return res.redirect(`${siteUrl}/dashboard/settings?digest=error`);
    }
  },
};
