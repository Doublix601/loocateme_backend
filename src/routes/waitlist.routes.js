import { Router } from 'express';
import { validate, validators } from '../middlewares/validators.js';
import { waitlistSignupLimiter, waitlistCountLimiter } from '../middlewares/rateLimit.js';
import { WaitlistController } from '../controllers/waitlist.controller.js';

const router = Router();

// Public : liste d'attente pré-lancement du site loocate.me (aucun compte requis)
router.post('/', waitlistSignupLimiter, validate(validators.waitlistSignup), WaitlistController.subscribe);
router.get('/count', waitlistCountLimiter, WaitlistController.getCount);

export default router;
