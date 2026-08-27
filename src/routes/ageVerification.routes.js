import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { AgeVerificationController } from '../controllers/ageVerification.controller.js';

// NB : POST /api/age-verification/webhook est monte en top-level dans server.js
// (avant express.json(), corps brut requis pour la signature Didit).
const router = Router();

router.get('/status', requireAuth, AgeVerificationController.status);
router.post('/session', requireAuth, AgeVerificationController.session);

export default router;
