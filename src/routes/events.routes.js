import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { EventsController } from '../controllers/events.controller.js';

const router = Router();

const eventValidators = {
  profileView: [
    validators && validators.custom ? validators.custom : (req, _res, next) => next(),
  ],
};

router.post('/profile-view', requireAuth, (req, res, next) => {
  if (!req.body?.targetUserId) return res.status(400).json({ code: 'TARGET_REQUIRED', message: 'targetUserId requis' });
  next();
}, EventsController.profileView);

router.post('/social-click', requireAuth, (req, res, next) => {
  const { targetUserId, socialNetwork } = req.body || {};
  if (!targetUserId || !socialNetwork) return res.status(400).json({ code: 'PARAMS_REQUIRED', message: 'targetUserId et socialNetwork requis' });
  next();
}, EventsController.socialClick);

router.post('/user-search', requireAuth, EventsController.userSearch);

export default router;
