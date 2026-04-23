import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { SettingsController } from '../controllers/settings.controller.js';

const router = Router();

// Public endpoint to get feature flags (no auth required)
router.get('/flags', SettingsController.getFlags);

export default router;
