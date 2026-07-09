import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { requireLocationOwner, requireBusinessTier } from '../middlewares/businessTier.js';
import { BusinessBoostController } from '../controllers/businessBoost.controller.js';

const router = Router();

router.get(
  '/locations/:locationId/boosts',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro3'),
  BusinessBoostController.getBoosts
);
router.post(
  '/locations/:locationId/ultra-boost/activate',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro3'),
  BusinessBoostController.activateUltraBoost
);
router.post(
  '/locations/:locationId/pro-boost/activate',
  requireAuth,
  requireLocationOwner,
  requireBusinessTier('pro3'),
  BusinessBoostController.activateProBoost
);

export default router;
