import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { User } from '../models/User.js';
import { sendMail, verifyMailTransport } from '../services/email.service.js';

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

// Lightweight diagnostics endpoint to test email delivery
// Usage: GET /api/admin/test-email?to=you@example.com&secret=... (requires EMAIL_TEST_SECRET to be set)
router.get('/test-email', async (req, res, next) => {
  try {
    const to = String(req.query.to || '');
    const secret = String(req.query.secret || '');
    const expected = process.env.EMAIL_TEST_SECRET || '';
    if (!expected) return res.status(403).json({ code: 'EMAIL_TEST_DISABLED', message: 'EMAIL_TEST_SECRET non configuré' });
    if (secret !== expected) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Secret invalide' });
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ code: 'INVALID_TO', message: 'Paramètre to invalide' });

    await sendMail({
      to,
      subject: 'Test de délivrabilité LoocateMe',
      text: 'Ceci est un email de test envoyé par le backend LoocateMe. Si vous le recevez, la configuration SMTP fonctionne.',
      html: '<p>Ceci est un <strong>email de test</strong> envoyé par le backend LoocateMe. Si vous le recevez, la configuration SMTP fonctionne.</p>',
    });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// SMTP status check: runs verify() and returns the selected transport info
router.get('/smtp-status', async (req, res) => {
  const secret = String(req.query.secret || '');
  const expected = process.env.EMAIL_TEST_SECRET || '';
  if (!expected) return res.status(403).json({ code: 'EMAIL_TEST_DISABLED', message: 'EMAIL_TEST_SECRET non configuré' });
  if (secret !== expected) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Secret invalide' });
  const status = await verifyMailTransport();
  return res.json(status);
});
