import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { referralRedeemLimiter } from '../middlewares/rateLimit.js';
import { ReferralController } from '../controllers/referral.controller.js';

const router = Router();

router.get('/me', requireAuth, ReferralController.me);
router.post('/redeem', requireAuth, referralRedeemLimiter, ReferralController.redeem);
router.get('/history', requireAuth, ReferralController.history);

export default router;
