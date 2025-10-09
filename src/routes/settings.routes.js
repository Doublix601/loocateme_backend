import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { SettingsController } from '../controllers/settings.controller.js';

const router = Router();

router.put('/visibility', requireAuth, validate(validators.visibility), SettingsController.setVisible);

export default router;
