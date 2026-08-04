import { User } from '../models/User.js';

const PERMISSION_STATUSES = ['granted', 'denied', 'undetermined'];

export const EngagementTrackingController = {
  // PUT /api/engagement/permissions - rapporte l'état courant des permissions
  // localisation/notifications côté app, utilisé pour détecter les comptes
  // "à risque" de désinstallation (cf. churnRisk.service.js).
  reportPermissions: async (req, res, next) => {
    try {
      const { locationPermissionStatus, notificationsPermissionStatus } = req.body || {};
      const update = { permissionStatusUpdatedAt: new Date() };
      if (PERMISSION_STATUSES.includes(locationPermissionStatus)) {
        update.locationPermissionStatus = locationPermissionStatus;
      }
      if (PERMISSION_STATUSES.includes(notificationsPermissionStatus)) {
        update.notificationsPermissionStatus = notificationsPermissionStatus;
      }
      await User.updateOne({ _id: req.user.id }, { $set: update });
      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/engagement/churn-survey - capte la raison au moment où l'utilisateur
  // désactive les notifications ou révoque la localisation dans l'app, pendant
  // qu'il est encore joignable (contrairement à une enquête post-désinstallation).
  submitChurnSurvey: async (req, res, next) => {
    try {
      const { reason, context } = req.body || {};
      if (!reason || typeof reason !== 'string' || reason.length > 500) {
        return res.status(400).json({ code: 'INVALID_REASON', message: 'reason requis (<= 500 caractères)' });
      }
      await User.updateOne(
        { _id: req.user.id },
        {
          $set: {
            churnSurveyReason: reason.trim(),
            churnSurveyContext: typeof context === 'string' ? context.slice(0, 100) : null,
            churnSurveyAt: new Date(),
          },
        }
      );
      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
};
