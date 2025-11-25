import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { PremiumController } from '../controllers/premium.controller.js';

const router = Router();

router.post('/trial/start', requireAuth, PremiumController.startTrial);

export default router;
