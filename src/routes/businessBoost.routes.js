import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { requireLocationOwner } from '../middlewares/businessTier.js';
import { BusinessBoostController } from '../controllers/businessBoost.controller.js';

const router = Router();

router.get(
  '/locations/:locationId/boosts',
  requireAuth,
  requireLocationOwner,
  BusinessBoostController.getBoosts
);
router.post(
  '/locations/:locationId/boosts/checkout',
  requireAuth,
  requireLocationOwner,
  BusinessBoostController.purchaseCheckout
);
router.post(
  '/locations/:locationId/ultra-boost/activate',
  requireAuth,
  requireLocationOwner,
  BusinessBoostController.activateUltraBoost
);
router.post(
  '/locations/:locationId/pro-boost/activate',
  requireAuth,
  requireLocationOwner,
  BusinessBoostController.activateProBoost
);

export default router;
