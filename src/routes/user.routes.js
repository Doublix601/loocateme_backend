import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { UserController } from '../controllers/user.controller.js';

const router = Router();

router.get('/me', requireAuth, UserController.me);
router.post('/location', requireAuth, validate(validators.updateLocation), UserController.updateLocation);
router.get('/nearby', requireAuth, validate(validators.nearby), UserController.nearby);
router.get('/by-email', requireAuth, validate(validators.getUserByEmail), UserController.getByEmail);

export default router;
