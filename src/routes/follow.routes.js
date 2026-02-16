import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { FollowController } from '../controllers/follow.controller.js';

const router = Router();

router.get('/status/:id', requireAuth, FollowController.status);
router.get('/requests', requireAuth, FollowController.list);
router.post('/request', requireAuth, FollowController.request);
router.post('/requests/:id/accept', requireAuth, FollowController.accept);
router.post('/requests/:id/decline', requireAuth, FollowController.decline);

export default router;
