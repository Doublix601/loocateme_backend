import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { PushController } from '../controllers/push.controller.js';

const router = Router();

router.post('/register-token', requireAuth, (req, res, next) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ code: 'TOKEN_REQUIRED', message: 'token requis' });
  next();
}, PushController.registerToken);

export default router;
