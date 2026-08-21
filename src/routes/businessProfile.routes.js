import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { requireLocationOwner, requireBusinessTier } from '../middlewares/businessTier.js';
import { uploadBusinessMedia } from '../services/storage.service.js';
import { BusinessProfileController } from '../controllers/businessProfile.controller.js';
import { BusinessStatsController } from '../controllers/businessStats.controller.js';

const router = Router();

router.get('/my-location', requireAuth, BusinessProfileController.getMyLocation);

router.get('/locations/:locationId', requireAuth, requireLocationOwner, BusinessProfileController.getById);

// Changement OSM en attente (bannière dashboard) : vérification par le gérant
// avant application, pour éviter qu'une modification malveillante sur OSM ne
// change les informations d'un lieu revendiqué sans son accord.
router.get('/locations/:locationId/pending-change', requireAuth, requireLocationOwner, BusinessProfileController.getPendingChange);
router.post('/locations/:locationId/pending-change/:changeRequestId/approve', requireAuth, requireLocationOwner, BusinessProfileController.approveChange);
router.post('/locations/:locationId/pending-change/:changeRequestId/reject', requireAuth, requireLocationOwner, BusinessProfileController.rejectChange);

// Outil d'acquisition, pas un avantage premium : aucun requireBusinessTier ici.
router.get('/locations/:locationId/checkin-qr', requireAuth, requireLocationOwner, BusinessProfileController.getCheckinQr);

// Préférence de notification, indépendante du palier (cf. contrôleur).
router.put(
  '/locations/:locationId/notification-preferences',
  requireAuth,
  requireLocationOwner,
  BusinessProfileController.updateNotificationPreferences
);

// Palier 1 : photo de profil (logo) + couverture + Stories
router.put(
  '/locations/:locationId/cover',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro1'),
  uploadBusinessMedia.single('cover'),
  BusinessProfileController.updateCover
);
router.put(
  '/locations/:locationId/logo',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro1'),
  uploadBusinessMedia.single('logo'),
  BusinessProfileController.updateLogo
);
router.delete(
  '/locations/:locationId/cover',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro1'),
  BusinessProfileController.removeCover
);
router.delete(
  '/locations/:locationId/logo',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro1'),
  BusinessProfileController.removeLogo
);
router.post(
  '/locations/:locationId/stories',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro1'),
  uploadBusinessMedia.single('story'),
  BusinessProfileController.addStory
);
router.delete(
  '/locations/:locationId/stories/:storyId',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro1'),
  BusinessProfileController.removeStory
);

// Palier 2 : PDF avec libellé personnalisé
router.post(
  '/locations/:locationId/media',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro2'),
  uploadBusinessMedia.single('file'),
  BusinessProfileController.addMedia
);
router.delete(
  '/locations/:locationId/media/:mediaId',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro2'),
  BusinessProfileController.removeMedia
);

// Palier 2 : événements (création de contenu, indépendante de l'Event Boost
// qui reste réservé pro3 — cf. businessBoost.routes.js)
router.post(
  '/locations/:locationId/events',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro2'),
  uploadBusinessMedia.single('media'),
  BusinessProfileController.addEvent
);
router.delete(
  '/locations/:locationId/events/:eventId',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro2'),
  BusinessProfileController.removeEvent
);

// Palier 2 : statistiques de fréquentation
router.get(
  '/locations/:locationId/stats',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro2'),
  BusinessStatsController.get
);

// Palier 3 : export CSV des statistiques
router.get(
  '/locations/:locationId/stats/export.csv',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro3'),
  BusinessStatsController.exportCsv
);

export default router;
