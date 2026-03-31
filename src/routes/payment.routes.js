import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';

const router = Router();

// Webhook RevenueCat - Ne nécessite pas d'authentification par token JWT (sécurisé par IP ou secret optionnel)
router.post('/revenuecat-webhook', PaymentController.revenueCatWebhook);

export default router;
