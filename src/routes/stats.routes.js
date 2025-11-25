import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { StatsController } from '../controllers/stats.controller.js';

const router = Router();

router.get('/overview', requireAuth, StatsController.overview);
router.get('/profile-views/detailed', requireAuth, StatsController.detailedProfileViews);

export default router;
