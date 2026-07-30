import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { PromoCodeController } from '../controllers/promoCode.controller.js';

const router = Router();

const requireModerator = (req, res, next) => {
  const role = req.user?.role;
  if (role !== 'moderator' && role !== 'admin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès réservé aux modérateurs' });
  }
  next();
};

// Gestion des codes promo (app mobile ModeratorScreen)
router.get('/', requireAuth, requireModerator, PromoCodeController.list);
router.post('/', requireAuth, requireModerator, PromoCodeController.create);
router.delete('/:id', requireAuth, requireModerator, PromoCodeController.remove);

export default router;
