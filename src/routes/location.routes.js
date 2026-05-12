import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { LocationController } from '../controllers/location.controller.js';

const router = Router();

router.get('/', requireAuth, LocationController.getLocations);
router.get('/:id', requireAuth, LocationController.getLocationById);
router.post('/sync-osm', requireAuth, LocationController.syncOsmLocations);
router.post('/osm-seed', requireAuth, LocationController.osmSeedOne);

export default router;
