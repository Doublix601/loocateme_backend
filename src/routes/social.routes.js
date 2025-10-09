import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { SocialController } from '../controllers/social.controller.js';

const router = Router();

router.put('/', requireAuth, validate(validators.socialUpsert), SocialController.upsert);
router.delete('/:type', requireAuth, validate(validators.socialRemove), SocialController.remove);

export default router;
