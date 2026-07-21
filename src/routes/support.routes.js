import { Router } from 'express';
import { validate, validators } from '../middlewares/validators.js';
import { supportContactLimiter } from '../middlewares/rateLimit.js';
import { SupportController } from '../controllers/support.controller.js';

const router = Router();

// Public : formulaire de contact/support du site loocate.me (aucun compte requis)
router.post('/contact', supportContactLimiter, validate(validators.supportContact), SupportController.contact);

export default router;
