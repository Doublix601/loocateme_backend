import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { GdprController } from '../controllers/gdpr.controller.js';

const router = Router();

// requireAuth re-fetches the user's role from DB on every request, so
// req.user.role below is always fresh.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès réservé aux administrateurs' });
  }
  next();
}

router.get('/policy', GdprController.getPolicy);
router.put('/policy', requireAuth, requireAdmin, GdprController.updatePolicy);
router.get('/policy-status', requireAuth, GdprController.getPolicyStatus);
router.put('/policy/accept', requireAuth, GdprController.acceptPolicyVersion);
router.put('/policy/seen', requireAuth, GdprController.markPolicyVersionSeen);
router.put('/consent', requireAuth, validate(validators.gdprConsent), GdprController.updateConsent);
router.post('/export', requireAuth, GdprController.exportData);
router.delete('/account', requireAuth, validate(validators.gdprDelete), GdprController.deleteAccount);

export default router;
