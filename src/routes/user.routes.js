import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { UserController } from '../controllers/user.controller.js';
import { heartbeatLimiter } from '../middlewares/rateLimit.js';

const router = Router();

router.get('/me', requireAuth, UserController.me);
router.post('/location', requireAuth, heartbeatLimiter, validate(validators.updateLocation), UserController.updateLocation);
router.post('/location/force', requireAuth, heartbeatLimiter, validate(validators.forceCheckIn), UserController.forceCheckIn);
router.post('/location/force-checkout', requireAuth, heartbeatLimiter, UserController.forceCheckOut);
router.post('/heartbeat', requireAuth, heartbeatLimiter, validate(validators.updateLocation), UserController.heartbeat);
router.get('/nearby', requireAuth, validate(validators.nearby), UserController.nearby);
router.get('/popular', requireAuth, validate(validators.popular), UserController.popular);
router.get('/by-email', requireAuth, validate(validators.getUsersByEmail), UserController.getByEmail);
router.get('/search', requireAuth, validate(validators.searchUsers), UserController.search);
router.post('/me/email', requireAuth, validate(validators.changeEmail), UserController.requestEmailChange);
// No requireAuth: the opaque token itself is the credential, same pattern as
// /api/auth/verify-email and /api/auth/reset-password (token-based, not session-based).
router.post('/me/email/confirm', validate(validators.confirmEmailChange), UserController.confirmEmailChange);
router.patch('/me/invisible-mode', requireAuth, UserController.updateInvisibleMode);
router.patch('/me/share-current-location', requireAuth, UserController.updateShareCurrentLocation);
router.patch('/me/notification-preferences', requireAuth, UserController.updateNotificationPreferences);
router.patch('/me/check-in-mode', requireAuth, UserController.updateCheckInMode);
router.post('/streak/claim-supervise', requireAuth, UserController.claimSupervise);
router.post('/streak/claim-boost', requireAuth, UserController.claimBoost);
router.get('/:id', requireAuth, validate(validators.userById), UserController.getById);

export default router;
