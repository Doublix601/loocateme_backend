import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { requireLocationOwner, requireBusinessTier } from '../middlewares/businessTier.js';
import { uploadBusinessMedia } from '../services/storage.service.js';
import { BusinessProfileController } from '../controllers/businessProfile.controller.js';
import { BusinessStatsController } from '../controllers/businessStats.controller.js';

const router = Router();

router.get('/my-location', requireAuth, BusinessProfileController.getMyLocation);

router.get('/locations/:locationId', requireAuth, requireLocationOwner, BusinessProfileController.getById);

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

// Palier 2 : statistiques de fréquentation
router.get(
  '/locations/:locationId/stats',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro2'),
  BusinessStatsController.get
);

export default router;
