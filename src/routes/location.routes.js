import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { LocationController } from '../controllers/location.controller.js';
import { locationsListLimiter } from '../middlewares/rateLimit.js';
import { validate, validators } from '../middlewares/validators.js';

const requireModerator = (req, res, next) => {
  const role = req.user?.role;
  if (role !== 'moderator' && role !== 'admin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès réservé aux modérateurs' });
  }
  next();
};

const router = Router();

router.get('/', requireAuth, locationsListLimiter, LocationController.getLocations);
// Public : recherche par nom pour le flux de candidature "compte pro" (avant tout compte)
router.get('/search', LocationController.searchByName);
router.get('/:id', requireAuth, LocationController.getLocationById);
router.get('/:id/crossed-paths', requireAuth, locationsListLimiter, LocationController.getCrossedPaths);
router.post('/:id/correction', requireAuth, locationsListLimiter, validate(validators.locationCorrection), LocationController.submitCorrection);
router.get('/corrections/pending', requireAuth, requireModerator, LocationController.listPendingCorrections);
router.post('/corrections/:crId/review', requireAuth, requireModerator, validate(validators.locationCorrectionReview), LocationController.reviewCorrection);
router.post('/sync-osm', requireAuth, LocationController.syncOsmLocations);
router.post('/osm-seed', requireAuth, LocationController.osmSeedOne);

export default router;
