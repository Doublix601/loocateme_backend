import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { User } from '../models/User.js';

const router = Router();

// GET /api/admin/users
// Returns all users (regardless of isVisible), paginated, without password field
router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      User.find({}, { password: 0 }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.estimatedDocumentCount(),
    ]);

    return res.json({ page, limit, total, items });
  } catch (err) {
    next(err);
  }
});

export default router;
