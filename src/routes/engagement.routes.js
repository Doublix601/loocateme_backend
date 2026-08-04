import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { EngagementTrackingController } from '../controllers/engagementTracking.controller.js';

const router = Router();

router.put('/permissions', requireAuth, EngagementTrackingController.reportPermissions);
router.post('/churn-survey', requireAuth, EngagementTrackingController.submitChurnSurvey);

export default router;
