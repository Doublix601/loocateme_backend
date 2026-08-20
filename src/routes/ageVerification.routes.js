import { Router } from 'express';
import { AgeVerificationController } from '../controllers/ageVerification.controller.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

router.post('/session', requireAuth, AgeVerificationController.startSession);
router.get('/status', requireAuth, AgeVerificationController.getStatus);
router.get('/callback', AgeVerificationController.callback);
// Le webhook Didit lui-même est monté séparément dans server.js (POST /api/webhooks/didit),
// avant express.json(), pour disposer du corps brut nécessaire à la vérification de signature.

export default router;
