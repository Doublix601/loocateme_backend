import { Router } from 'express';
import { ProxyController } from '../controllers/proxy.controller.js';

const router = Router();

// GET /api/proxy/image?u=<encoded external image URL>
router.get('/image', ProxyController.image);

export default router;
