import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { User } from '../models/User.js';
import { sendMail, verifyMailTransport } from '../services/email.service.js';
import { sendUnifiedNotification } from '../services/fcm.service.js';

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

// POST /api/admin/push/send
// Envoie une notification configurable via FCM aux userIds ou tokens fournis
// Body: { userIds?: string[]|string(csv), tokens?: string[]|string(csv), title?, body?, data?, imageUrl?, sound?, badge?, androidChannelId?, priority?, collapseKey?, mutableContent?, contentAvailable? }
router.post('/push/send', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const toArray = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    };

    const userIds = toArray(b.userIds);
    const tokens = toArray(b.tokens);
    const title = b.title ? String(b.title) : undefined;
    const body = b.body ? String(b.body) : undefined;
    const imageUrl = b.imageUrl ? String(b.imageUrl) : undefined;
    const sound = b.sound ? String(b.sound) : 'default';
    const badge = typeof b.badge === 'number' ? b.badge : (b.badge ? Number(b.badge) : undefined);
    const androidChannelId = b.androidChannelId ? String(b.androidChannelId) : undefined;
    const priority = b.priority === 'normal' ? 'normal' : 'high';
    const collapseKey = b.collapseKey ? String(b.collapseKey) : undefined;
    const mutableContent = !!b.mutableContent;
    const contentAvailable = !!b.contentAvailable;

    // data peut être un objet ou un JSON string
    let data = {};
    if (b.data && typeof b.data === 'object') data = b.data;
    else if (typeof b.data === 'string') {
      try { data = JSON.parse(b.data); } catch (_) { data = {}; }
    }

    const options = { userIds, tokens, title, body, data, imageUrl, sound, badge, androidChannelId, priority, collapseKey, mutableContent, contentAvailable };
    const result = await sendUnifiedNotification(options);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/role
// Body: { role: 'Premium'|'Free' } OR { isPremium: boolean }
router.put('/users/:id/role', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ code: 'ID_REQUIRED', message: 'ID utilisateur requis' });
    const role = typeof req.body?.role === 'string' ? req.body.role : null;
    let isPremium;
    if (role) {
      if (role !== 'Premium' && role !== 'Free') {
        return res.status(400).json({ code: 'ROLE_INVALID', message: 'Role invalide' });
      }
      isPremium = role === 'Premium';
    } else if (typeof req.body?.isPremium === 'boolean') {
      isPremium = !!req.body.isPremium;
    } else {
      return res.status(400).json({ code: 'BODY_INVALID', message: 'Spécifiez role ou isPremium' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' });
    user.isPremium = isPremium;
    await user.save();
    const safe = user.toObject();
    delete safe.password;
    return res.json({ success: true, user: safe });
  } catch (err) {
    next(err);
  }
});
