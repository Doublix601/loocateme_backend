import nodeCron from 'node-cron';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
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
      console.log('[cron] Starting Nightly Cleanup...');
      try {
        const { NotificationDedup } = await import('../models/NotificationDedup.js');
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await NotificationDedup.deleteMany({ createdAt: { $lt: cutoff } });
        console.log('[cron] Cleanup finished.');
      } catch (e) {
        console.error('[cron] Cleanup error:', e);
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
  }
};
