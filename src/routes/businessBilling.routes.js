import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { BusinessBillingController } from '../controllers/businessBilling.controller.js';

const router = Router();

router.post('/checkout-session', requireAuth, BusinessBillingController.checkoutSession);
router.post('/portal-session', requireAuth, BusinessBillingController.portalSession);
router.post('/cancel-subscription', requireAuth, BusinessBillingController.cancelSubscription);
router.post('/reactivate-subscription', requireAuth, BusinessBillingController.reactivateSubscription);
router.delete('/account', requireAuth, BusinessBillingController.deleteAccount);

export default router;
