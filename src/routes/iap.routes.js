import express from 'express';
import * as IapController from '../controllers/iap.controller.js';

const router = express.Router();

/**
 * @route POST /api/iap/webhook
 * @desc RevenueCat Webhook Listener
 * Access: Public (RevenueCat Webhook)
 */
router.post('/webhook', IapController.handleWebhook);

export default router;
