import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { LocationController } from '../controllers/location.controller.js';
import { locationsListLimiter } from '../middlewares/rateLimit.js';

const router = Router();

router.get('/', requireAuth, locationsListLimiter, LocationController.getLocations);
// Public : recherche par nom pour le flux de candidature "compte pro" (avant tout compte)
router.get('/search', LocationController.searchByName);
router.get('/:id', requireAuth, LocationController.getLocationById);
router.post('/sync-osm', requireAuth, LocationController.syncOsmLocations);
router.post('/osm-seed', requireAuth, LocationController.osmSeedOne);

export default router;
