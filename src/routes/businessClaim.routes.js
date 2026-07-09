import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { uploadBusinessDocs } from '../services/storage.service.js';
import { BusinessClaimController } from '../controllers/businessClaim.controller.js';

const router = Router();

const requireModerator = (req, res, next) => {
  const role = req.user?.role;
  if (role !== 'moderator' && role !== 'admin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès réservé aux modérateurs' });
  }
  next();
};

// Variante de requireAuth acceptant aussi le token en query (?token=...), pour
// permettre l'ouverture d'un document dans un visualiseur externe (WebView/
// navigateur système) depuis l'app mobile, qui ne peut pas y attacher un
// header Authorization. Utilisée uniquement sur cette route de preview.
async function requireAuthFromHeaderOrQuery(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
    if (!token) return res.status(401).json({ code: 'AUTH_MISSING', message: 'Missing access token' });
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = { id: payload.sub };
    const { User } = await import('../models/User.js');
    const user = await User.findById(req.user.id).select('role').lean();
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
    req.user.role = user.role;
    next();
  } catch (err) {
    return res.status(401).json({ code: 'AUTH_INVALID', message: 'Invalid or expired access token' });
  }
}

const claimDocsUpload = uploadBusinessDocs.fields([
  { name: 'kbis', maxCount: 1 },
  { name: 'id', maxCount: 1 },
  { name: 'leaseProof', maxCount: 1 },
]);

// Public : candidature (aucun compte requis) + suivi de statut
router.post('/', claimDocsUpload, BusinessClaimController.create);
router.get('/:id/status', BusinessClaimController.status);

// Modération (app mobile ModeratorScreen)
router.get('/', requireAuth, requireModerator, BusinessClaimController.list);
router.get('/:id/documents/:docIndex', requireAuthFromHeaderOrQuery, requireModerator, BusinessClaimController.document);
router.post('/:id/action', requireAuth, requireModerator, BusinessClaimController.action);

export default router;
