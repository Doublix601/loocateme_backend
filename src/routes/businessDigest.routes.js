import { Router } from 'express';
import { BusinessDigestController } from '../controllers/businessDigest.controller.js';

const router = Router();

// Public : aucun requireAuth, le token porte sa propre preuve d'autorisation.
router.get('/unsubscribe', BusinessDigestController.unsubscribe);

export default router;
