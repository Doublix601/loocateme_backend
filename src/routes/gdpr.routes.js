import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { GdprController } from '../controllers/gdpr.controller.js';

const router = Router();

router.get('/policy', GdprController.getPolicy);
router.put('/consent', requireAuth, validate(validators.gdprConsent), GdprController.updateConsent);
router.post('/export', requireAuth, GdprController.exportData);
router.delete('/account', requireAuth, validate(validators.gdprDelete), GdprController.deleteAccount);

export default router;
