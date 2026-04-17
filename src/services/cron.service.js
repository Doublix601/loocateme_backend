import nodeCron from 'node-cron';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { Location } from '../models/Location.js';
import { sendPushUnified } from './push.service.js';

/**
 * Service de tâches planifiées (Cron) pour LoocateMe.
 */
export const CronService = {
  /**
   * Initialise les tâches planifiées.
   */
  init: () => {
    // Weekly Digest: Tous les lundis à 09:00
    nodeCron.schedule('0 9 * * 1', () => {
      console.log('[cron] Starting Weekly Digest...');
      CronService.sendWeeklyDigest();
    });

    // Cleanup: Toutes les nuits à 03:00
    nodeCron.schedule('0 3 * * *', async () => {
      console.log('[cron] Starting Nightly Cleanup and Stats Update...');
      try {
        const { NotificationDedup } = await import('../models/NotificationDedup.js');
        const cutoffDedup = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await NotificationDedup.deleteMany({ createdAt: { $lt: cutoffDedup } });

        // Recalculer les stats des lieux (Popularité 30j et Étoiles)
        await CronService.updateLocationStats();

        console.log('[cron] Cleanup and stats update finished.');
      } catch (e) {
        console.error('[cron] Cleanup/Stats error:', e);
      }
    });

    console.log('[cron] Scheduled tasks initialized.');
  },

  /**
   * Calcule et envoie le résumé hebdomadaire de statistiques.
   */
  sendWeeklyDigest: async () => {
    try {
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // On récupère les IDs des utilisateurs actifs cette semaine
      const activeIds = await Event.distinct('targetUser', {
        createdAt: { $gt: lastWeek },
        type: { $in: ['profile_view', 'social_click'] }
      });

      if (!activeIds.length) return;

      for (const userId of activeIds) {
        try {
          const viewsCount = await Event.countDocuments({
            targetUser: userId,
            type: 'profile_view',
            createdAt: { $gt: lastWeek }
          });

          if (viewsCount <= 0) continue;

          const user = await User.findById(userId).select('isPremium').lean();
          if (!user) continue;

          let title = 'Ta semaine sur LoocateMe 🚀';
          let body = `Ton profil a été vu ${viewsCount} fois cette semaine ! Découvre tes nouveaux admirateurs.`;

          if (viewsCount > 10) {
            body = `Semaine record ! ${viewsCount} personnes ont regardé ton profil. Es-tu prêt pour un nouveau succès ? 🔥`;
          }

          await sendPushUnified({
            userIds: [userId],
            title,
            body,
            data: {
              kind: 'weekly_digest',
              viewsCount,
              url: 'loocateme://statistics'
            }
          });
        } catch (err) {
          console.error(`[cron] Failed to send digest to user ${userId}:`, err);
        }
      }
      console.log(`[cron] Weekly digest sent to ${activeIds.length} users.`);
    } catch (e) {
      console.error('[cron] Weekly digest error:', e);
    }
  },

  /**
   * Recalcule la popularité (visiteurs uniques 30j) et les étoiles de tous les lieux.
   */
  updateLocationStats: async () => {
    try {
      console.log('[cron] Recalculating location stats...');
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Agrégation pour compter les visiteurs uniques par lieu sur 30 jours
      const stats = await Event.aggregate([
        {
          $match: {
            type: 'location_visit',
            createdAt: { $gt: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: '$locationId',
            uniqueVisitors30d: { $addToSet: '$actor' }
          }
        },
        {
          $project: {
            locationId: '$_id',
            popularity: { $size: '$uniqueVisitors30d' }
          }
        }
      ]);

      // Map pour accès rapide
      const popularityMap = new Map(stats.map(s => [String(s.locationId), s.popularity]));

      const locations = await Location.find({});
      for (const loc of locations) {
        const popularity = popularityMap.get(String(loc._id)) || 0;
        
        // Calcul des étoiles basé sur la moyenne hebdomadaire (popularité / (30/7))
        // Soit environ popularity / 4.28
        const weeklyAvg = popularity / (30 / 7);
        
        let stars = 0;
        if (weeklyAvg >= 200) stars = 3;
        else if (weeklyAvg >= 50) stars = 2;
        else if (weeklyAvg >= 1) stars = 1;

        // On conserve la règle de persistance manuelle (score 1000+) si besoin,
        // mais ici on suit strictement la nouvelle règle basée sur les visites.
        // Si on veut garder les lieux persistants à 3 étoiles :
        if (loc.popularity >= 1000) stars = 3;

        await Location.updateOne(
          { _id: loc._id },
          { $set: { popularity, stars } }
        );
      }
      console.log(`[cron] Updated stats for ${locations.length} locations.`);
    } catch (e) {
      console.error('[cron] Update location stats error:', e);
    }
  }
};
