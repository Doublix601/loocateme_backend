import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { ReportController } from '../controllers/report.controller.js';

const router = Router();

const requireModerator = (req, res, next) => {
  const role = req.user?.role;
  if (role !== 'moderator' && role !== 'admin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès réservé aux modérateurs' });
  }
  next();
};

router.post('/', requireAuth, validate(validators.reportCreate), ReportController.create);
router.get('/', requireAuth, requireModerator, ReportController.list);
router.post('/:id/action', requireAuth, requireModerator, validate(validators.reportAction), ReportController.action);
router.get('/users/search', requireAuth, requireModerator, validate(validators.moderationUserSearch), ReportController.searchUsers);
router.post('/users/:id/moderate', requireAuth, requireModerator, validate(validators.moderationUserAction), ReportController.moderateUser);

export default router;
