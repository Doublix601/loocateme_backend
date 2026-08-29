import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { User } from '../models/User.js';
import { FeatureFlag, DEFAULT_FLAGS } from '../models/FeatureFlag.js';
import { CronService } from '../services/cron.service.js';
import { sendMail, verifyMailTransport } from '../services/email.service.js';
import { sendUnifiedNotification } from '../services/fcm.service.js';
import { filterOptedOutUsers } from '../services/push.service.js';
import { sanitize } from '../services/auth.service.js';
import { getUninstallCorrelationReport } from '../services/churnRisk.service.js';
import { invalidateAuthCache } from '../utils/authCache.js';
import { Location } from '../models/Location.js';
import { BOOST_CAPS, BOOST_BALANCE_FIELD } from '../constants/boosts.js';
import { adminSearchUsers } from '../services/user.service.js';

const router = Router();

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentification requise' });
    }
    const user = await User.findById(req.user.id).lean();
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès réservé aux administrateurs' });
    }
    next();
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/uninstall-correlation?windowDays=30
// Corrèle chaque type de notification au nombre de désinstallations qui l'ont
// suivi (best-effort, cf. push.service.js). Sert à calibrer les plafonds de
// fréquence de nudge avec de la donnée réelle plutôt qu'une estimation.
router.get('/uninstall-correlation', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const windowDays = Number(req.query.windowDays) || 30;
    const report = await getUninstallCorrelationReport(windowDays);
    return res.json({ windowDays, report });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users
// Returns all users, paginated, without password field
router.get('/users', requireAuth, requireAdmin, async (req, res, next) => {
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
router.post('/push/send', requireAuth, requireAdmin, async (req, res, next) => {
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

    // Respecte l'opt-out utilisateur (notificationPreferences) quand un kind
    // reconnu est fourni — comme sendPushUnified côté envois applicatifs.
    // Cette route appelle sendUnifiedNotification directement (et non
    // sendPushUnified) pour garder le support des champs FCM avancés
    // (imageUrl, priority, mutableContent, contentAvailable) que
    // sendPushUnified n'expose pas.
    const filteredUserIds = await filterOptedOutUsers(userIds, data?.kind);

    const options = { userIds: filteredUserIds, tokens, title, body, data, imageUrl, sound, badge, androidChannelId, priority, collapseKey, mutableContent, contentAvailable };
    const result = await sendUnifiedNotification(options);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/role
// Body: { role: 'Premium'|'Free' } OR { isPremium: boolean }
router.put('/users/:id/role', requireAuth, requireAdmin, async (req, res, next) => {
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
    return res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/flags - Get all feature flags (admin only)
router.get('/flags', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const flags = await FeatureFlag.find({}).lean();
    return res.json({ flags });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/flags/:key - Update a feature flag (admin only)
// Body: { enabled: boolean, confirm: true }
// Ces flags sont GLOBAUX (tout utilisateur en production) : on exige `confirm`
// explicite, on whiteliste les clés connues, et on trace l'auteur du changement.
router.put('/flags/:key', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ code: 'KEY_REQUIRED', message: 'Clé du flag requise' });
    }
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_FLAGS, key)) {
      return res.status(400).json({ code: 'UNKNOWN_FLAG', message: `Flag inconnu: ${key}` });
    }
    const { enabled, confirm } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ code: 'ENABLED_REQUIRED', message: 'Le champ enabled (boolean) est requis' });
    }
    if (confirm !== true) {
      return res.status(409).json({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Ce flag affecte tous les utilisateurs en production. Renvoyez { confirm: true } pour valider.',
      });
    }
    const flag = await FeatureFlag.findOneAndUpdate(
      { key },
      { enabled, lastChangedBy: req.user.id, lastChangedAt: new Date() },
      { new: true, upsert: true }
    );
    console.warn('[FeatureFlag] %s -> %s by user %s', key, enabled, req.user.id);
    return res.json({ success: true, flag });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/user-role - Update user role (admin only)
// Body: { role: 'user' | 'moderator' | 'admin' }
router.put('/users/:id/user-role', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ code: 'ID_REQUIRED', message: 'ID utilisateur requis' });
    }
    const { role } = req.body;
    if (!role || !['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ code: 'ROLE_INVALID', message: 'Role invalide. Valeurs acceptées: user, moderator, admin' });
    }
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' });
    }
    user.role = role;
    await user.save();
    // requireAuth/requireActiveUser lisent req.user.role depuis un cache Redis
    // court (20s, cf. utils/authCache.js) : sans invalidation explicite ici,
    // un modérateur/admin qui vient d'être rétrogradé garderait ses accès
    // (bannir/débannir, lire les signalements, gérer les codes promo, éditer
    // la politique GDPR...) jusqu'à expiration du cache.
    await invalidateAuthCache(user._id);
    return res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/unban - Remove any active bans (admin only)
router.put('/users/:id/unban', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ code: 'ID_REQUIRED', message: 'ID utilisateur requis' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' });
    user.moderation = user.moderation || {};
    user.moderation.bannedUntil = null;
    user.moderation.bannedPermanent = false;
    user.moderation.bannedAt = null;
    user.moderation.bannedBy = null;
    user.moderation.banReason = '';
    await user.save();
    return res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/cleanup-presence
// Sets all expired users (last_seen_at < 15min) to status: 'inactive' (currentLocation: null)
router.post('/cleanup-presence', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const threshold = new Date(Date.now() - 15 * 60 * 1000);
    
    // In MongoDB, we clear the currentLocation field to mark as "inactive/left"
    const result = await User.updateMany(
      {
        currentLocation: { $ne: null },
        $or: [
          { 'location.updatedAt': { $lt: threshold } },
          { 'location.updatedAt': { $exists: false } }
        ]
      },
      {
        $set: { currentLocation: null }
      }
    );

    console.log(`[AdminCleanup] Reset presence for ${result.modifiedCount} orphan users.`);
    
    return res.json({
      success: true,
      message: `Presence reset for ${result.modifiedCount} users.`,
      modifiedCount: result.modifiedCount,
      threshold: threshold.toISOString()
    });
  } catch (err) {
    console.error('[AdminCleanup] Error:', err);
    next(err);
  }
});

// POST /api/admin/sync-locations
// Déclenche manuellement le recalcul des stats (popularity + stars) de tous les lieux.
router.post('/sync-locations', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await CronService.updateLocationStats();
    return res.json({ success: true, message: 'Recalcul des stats lieux terminé.' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Debug / QA — gestion fine d'un compte utilisateur et de son compte pro.
// Toutes ces routes sont réservées aux admins et pilotées depuis le DebugScreen
// de l'app. Les overrides "compte pro" écrivent directement en base (businessTier,
// subscription, proOffers) SANS toucher à Stripe : pour un compte pro avec un
// abonnement Stripe réellement actif, le prochain webhook Stripe réécrasera la
// valeur — d'où le garde-fou `force` sur le changement de palier.
// ---------------------------------------------------------------------------

const ISO_OR_NULL = (v) => {
  if (v === null || v === '') return null;
  if (v === undefined) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
};

// GET /api/admin/users/search?q=...&limit=20
// Recherche de modération : AUCUN filtre de visibilité / ban / blocage —
// contrairement à /api/users/search, un admin doit pouvoir retrouver un compte
// en mode invisible ou banni pour le gérer. Accepte aussi un ObjectId exact.
router.get('/users/search', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ code: 'QUERY_TOO_SHORT', message: 'Au moins 2 caractères requis' });
    }
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const users = await adminSearchUsers({ q, limit });
    return res.json({ users });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id/premium
// Body: { isPremium?, premiumSource?, premiumExpiresAt?, premiumTrialStart?, premiumTrialEnd? }
// Ne modifie que les champs fournis. Dates: ISO string, ou null pour effacer.
router.patch('/users/:id/premium', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const user = await User.findById(String(req.params.id || '').trim());
    if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' });

    const b = req.body || {};
    if (typeof b.isPremium === 'boolean') user.isPremium = b.isPremium;
    if (b.premiumSource !== undefined) {
      const allowed = ['paid', 'trial', 'referral_reward', 'promo', null];
      if (!allowed.includes(b.premiumSource)) {
        return res.status(400).json({ code: 'SOURCE_INVALID', message: 'premiumSource invalide' });
      }
      user.premiumSource = b.premiumSource;
    }
    for (const field of ['premiumExpiresAt', 'premiumTrialStart', 'premiumTrialEnd']) {
      if (field in b) {
        const parsed = ISO_OR_NULL(b[field]);
        if (parsed === undefined) return res.status(400).json({ code: 'DATE_INVALID', message: `${field} invalide` });
        user[field] = parsed;
      }
    }
    await user.save();
    return res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/consumables
// Body: { mode: 'add' | 'set', boost?, superlike?, boostUntil? }
// 'add' → incrémente (peut être négatif, plancher 0) ; 'set' → valeur absolue.
router.post('/users/:id/consumables', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const user = await User.findById(String(req.params.id || '').trim());
    if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' });

    const b = req.body || {};
    const mode = b.mode === 'set' ? 'set' : 'add';
    const applyNum = (current, delta) => {
      if (delta === undefined || delta === null || delta === '') return current;
      const n = Number(delta);
      if (!Number.isFinite(n)) return current;
      return Math.max(0, mode === 'set' ? n : current + n);
    };
    user.boostBalance = applyNum(user.boostBalance || 0, b.boost);
    user.superlikeBalance = applyNum(user.superlikeBalance || 0, b.superlike);
    if ('boostUntil' in b) {
      const parsed = ISO_OR_NULL(b.boostUntil);
      if (parsed === undefined) return res.status(400).json({ code: 'DATE_INVALID', message: 'boostUntil invalide' });
      user.boostUntil = parsed;
    }
    await user.save();
    return res.json({
      success: true,
      boostBalance: user.boostBalance,
      superlikeBalance: user.superlikeBalance,
      boostUntil: user.boostUntil,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id/account-flags
// Body: { invisibleMode?, checkInMode? }
router.patch('/users/:id/account-flags', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const user = await User.findById(String(req.params.id || '').trim());
    if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' });

    const b = req.body || {};
    if (typeof b.invisibleMode === 'boolean') user.invisibleMode = b.invisibleMode;
    if (b.checkInMode !== undefined) {
      if (!['auto', 'manual'].includes(b.checkInMode)) {
        return res.status(400).json({ code: 'MODE_INVALID', message: 'checkInMode invalide (auto|manual)' });
      }
      user.checkInMode = b.checkInMode;
    }
    await user.save();
    return res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users/:id/business
// Renvoie le lieu possédé par l'utilisateur (relation 1:1 ownerId) et l'état de
// son abonnement pro, ou { location: null } s'il n'en gère aucun.
router.get('/users/:id/business', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    const location = await Location.findOne({ ownerId: id })
      .select('name businessTier subscription proOffers sponsorship ultraBoost ownerId')
      .lean();
    if (!location) return res.json({ location: null });
    return res.json({ location });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/business/:locationId/tier
// Body: { businessTier: 'none'|'pro1'|'pro2'|'pro3', periodDays?=30, grantProOffers?=false, force?=false }
// Override DB uniquement. Refuse si un abonnement Stripe est actif, sauf force:true.
router.patch('/business/:locationId/tier', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const location = await Location.findById(String(req.params.locationId || '').trim());
    if (!location) return res.status(404).json({ code: 'LOCATION_NOT_FOUND', message: 'Lieu introuvable' });

    const b = req.body || {};
    const tier = b.businessTier;
    if (!['none', 'pro1', 'pro2', 'pro3'].includes(tier)) {
      return res.status(400).json({ code: 'TIER_INVALID', message: 'businessTier invalide' });
    }

    const sub = location.subscription || {};
    const stripeActive = !!sub.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(sub.status);
    if (stripeActive && b.force !== true) {
      return res.status(409).json({
        code: 'STRIPE_SUBSCRIPTION_ACTIVE',
        message:
          "Un abonnement Stripe est actif sur ce lieu : l'override sera écrasé au prochain webhook. Renvoyez { force: true } pour forcer.",
        subscription: { status: sub.status, stripeSubscriptionId: sub.stripeSubscriptionId },
      });
    }

    location.businessTier = tier;
    location.subscription = location.subscription || {};
    if (tier === 'none') {
      location.subscription.status = 'canceled';
    } else {
      const periodDays = Number.isFinite(Number(b.periodDays)) ? Math.max(1, Number(b.periodDays)) : 30;
      location.subscription.status = 'active';
      location.subscription.currentPeriodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000);
      location.subscription.cancelAtPeriodEnd = false;
      if (b.grantProOffers === true) {
        location.proOffers = location.proOffers || {};
        location.proOffers.ultraBoostBalance = BOOST_CAPS.ultra;
        location.proOffers.proBoostBalance = BOOST_CAPS.pro;
        location.proOffers.eventBoostBalance = BOOST_CAPS.event;
      }
    }
    await location.save();
    console.warn('[admin] businessTier override %s -> %s by %s', location._id, tier, req.user.id);
    return res.json({
      success: true,
      location: {
        _id: location._id,
        name: location.name,
        businessTier: location.businessTier,
        subscription: location.subscription,
        proOffers: location.proOffers,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/business/:locationId/boosts
// Body: { mode: 'add'|'set', ultra?, pro?, event? } — clampé à BOOST_CAPS.
router.post('/business/:locationId/boosts', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const location = await Location.findById(String(req.params.locationId || '').trim());
    if (!location) return res.status(404).json({ code: 'LOCATION_NOT_FOUND', message: 'Lieu introuvable' });

    const b = req.body || {};
    const mode = b.mode === 'set' ? 'set' : 'add';
    location.proOffers = location.proOffers || {};
    for (const type of ['ultra', 'pro', 'event']) {
      const raw = b[type];
      if (raw === undefined || raw === null || raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const field = BOOST_BALANCE_FIELD[type];
      const current = location.proOffers[field] || 0;
      const next = mode === 'set' ? n : current + n;
      location.proOffers[field] = Math.max(0, Math.min(next, BOOST_CAPS[type]));
    }
    await location.save();
    return res.json({
      success: true,
      proOffers: {
        ultraBoostBalance: location.proOffers.ultraBoostBalance || 0,
        proBoostBalance: location.proOffers.proBoostBalance || 0,
        eventBoostBalance: location.proOffers.eventBoostBalance || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
