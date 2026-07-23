import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { PremiumController } from '../controllers/premium.controller.js';

const router = Router();

router.post('/trial/start', requireAuth, PremiumController.startTrial);
router.post('/verify', requireAuth, PremiumController.verifyPurchase);
router.get('/allowance', requireAuth, PremiumController.getWeeklyAllowance);
router.post('/boost/activate', requireAuth, PremiumController.activateBoost);
router.post('/superlike', requireAuth, PremiumController.sendSuperlike);
router.get('/superlikes/received', requireAuth, PremiumController.getReceivedSuperlikes);
router.get('/superlikes/sent', requireAuth, PremiumController.getSentSuperlikes);
router.post('/superlikes/:id/accept', requireAuth, PremiumController.acceptSuperlike);

export default router;
