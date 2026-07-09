import nodeCron from 'node-cron';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { Location } from '../models/Location.js';
import { sendPushUnified } from './push.service.js';
import { recalculateAllCityStars } from './location.service.js';
import { recomputeAllLocationAnalytics } from './businessStats.service.js';
import { processPolicyEmailJobs } from './policyNotification.service.js';

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

    // Envoi par lots des emails de mise à jour de la politique de confidentialité
    // (une tranche d'utilisateurs par minute, pour ne pas saturer le SMTP)
    nodeCron.schedule('* * * * *', async () => {
      try {
        await processPolicyEmailJobs();
      } catch (e) {
        console.error('[cron] Policy email job error:', e);
      }
    });

    // Cleanup: Toutes les nuits à 03:00
    nodeCron.schedule('0 3 * * *', async () => {
      console.log('[cron] Starting Nightly Cleanup and Stats Update...');
      try {
        const { NotificationDedup } = await import('../models/NotificationDedup.js');
        const cutoffDedup = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await NotificationDedup.deleteMany({ createdAt: { $lt: cutoffDedup } });

        // RGPD: anonymise l'historique de visite et purge les coordonnées des
        // comptes invisibles (cf. scripts/cleanupPrivacyData.js, désormais scheduled ici)
        await CronService.runPrivacyCleanup();

        // Recalculer les stats des lieux (Popularité 30j et Étoiles)
        await CronService.updateLocationStats();

        // Recalculer les stats pro dénormalisées (fréquentation, âge/genre)
        try {
          const count = await recomputeAllLocationAnalytics();
          console.log(`[cron] Business analytics recomputed for ${count} locations.`);
        } catch (e) {
          console.error('[cron] Business analytics recompute error:', e);
        }

        console.log('[cron] Cleanup and stats update finished.');
      } catch (e) {
        console.error('[cron] Cleanup/Stats error:', e);
      }
    });

    // Expiration des Stories pro (24h) : toutes les 15 minutes
    nodeCron.schedule('*/15 * * * *', async () => {
      try {
        const res = await Location.updateMany(
          { 'stories.0': { $exists: true } },
          { $pull: { stories: { expiresAt: { $lt: new Date() } } } }
        );
        if (res.modifiedCount) console.log(`[cron] Expired stories removed from ${res.modifiedCount} locations.`);
      } catch (e) {
        console.error('[cron] Story expiration error:', e);
      }
    });

    // Libération du "Pro Boost" (SponsorshipSlot) expiré : toutes les 5 minutes
    nodeCron.schedule('*/5 * * * *', async () => {
      try {
        const { SponsorshipSlot } = await import('../models/SponsorshipSlot.js');
        const now = new Date();
        const slot = await SponsorshipSlot.findOneAndUpdate(
          { _id: 'GLOBAL', until: { $lte: now } },
          { activeLocationId: null, until: null }
        );
        if (slot?.activeLocationId) {
          await Location.updateMany(
            { _id: slot.activeLocationId, 'sponsorship.until': { $lte: now } },
            { 'sponsorship.active': false }
          );
        }
      } catch (e) {
        console.error('[cron] Sponsorship slot release error:', e);
      }
    });

    // Reset Boost Balance and Grant Weekly Boost for Premium: Tous les lundis à 04:00
    nodeCron.schedule('0 4 * * 1', async () => {
      console.log('[cron] Granting weekly boost for Premium users...');
      try {
        await User.updateMany(
          { isPremium: true },
          { $inc: { boostBalance: 1 } }
        );
        console.log('[cron] Weekly boost granted.');
      } catch (e) {
        console.error('[cron] Weekly boost error:', e);
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
   * Nettoyage RGPD quotidien (portage de scripts/cleanupPrivacyData.js) :
   * anonymise les visites de lieux de plus de 30 jours et purge les
   * coordonnées des comptes en mode invisible (status: red).
   */
  runPrivacyCleanup: async () => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const eventRes = await Event.updateMany(
        { type: 'location_visit', actor: { $ne: null }, createdAt: { $lt: thirtyDaysAgo } },
        { $set: { actor: null } }
      );
      const invisibleRes = await User.updateMany(
        { status: 'red', 'location.coordinates': { $ne: [0, 0] } },
        { $set: { 'location.coordinates': [0, 0] } }
      );
      console.log(`[cron] Privacy cleanup: anonymized ${eventRes.modifiedCount} visits, wiped coordinates for ${invisibleRes.modifiedCount} invisible users.`);
    } catch (e) {
      console.error('[cron] Privacy cleanup error:', e);
    }
  },

  /**
   * Recalcule la popularité (visiteurs uniques 30j) et les étoiles de tous les lieux.
   * Les étoiles sont attribuées par tertiles relatifs à la ville du lieu.
   */
  updateLocationStats: async () => {
    try {
      console.log('[cron] Recalculating location stats (city tertiles)...');
      const count = await recalculateAllCityStars();
      console.log(`[cron] Updated stats for ${count} locations.`);
    } catch (e) {
      console.error('[cron] Update location stats error:', e);
    }
  }
};
