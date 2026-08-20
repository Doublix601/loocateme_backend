import jwt from 'jsonwebtoken';
import { getCachedAuthUser, setCachedAuthUser, invalidateAuthCache } from '../utils/authCache.js';

async function loadAuthUser(userId) {
  const cached = await getCachedAuthUser(userId);
  if (cached) return cached;
  const { User } = await import('../models/User.js');
  const fresh = await User.findById(userId).select('role moderation lastLoginAt invisibleMode').lean();
  if (fresh) await setCachedAuthUser(userId, fresh);
  return fresh;
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ code: 'AUTH_MISSING', message: 'Missing access token' });
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = { id: payload.sub };
    const user = await loadAuthUser(req.user.id);
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
    req.user.role = user.role;
    req.user.invisibleMode = !!user.invisibleMode;
    const mod = user.moderation || {};
    const now = new Date();
    if (mod.bannedPermanent) {
      return res.status(403).json({ code: 'BANNED', message: 'Account banned' });
    }
    if (mod.bannedUntil && new Date(mod.bannedUntil).getTime() > now.getTime()) {
      return res.status(403).json({ code: 'BANNED_TEMP', message: 'Account temporarily banned', until: mod.bannedUntil });
    }
    import('../services/streak.service.js')
      .then(async ({ recordDailyActivity }) => {
        const updated = await recordDailyActivity(req.user.id, user.lastLoginAt);
        // lastLoginAt vient d'être réécrit en base : le cache d'auth (qui
        // contient l'ancienne valeur) doit être invalidé, sinon les requêtes
        // suivantes dans la fenêtre de TTL rejoueraient le même gap de jour
        // civil et réincrémenteraient le streak plusieurs fois.
        if (updated) await invalidateAuthCache(req.user.id);
      })
      .catch((e) => console.error('[streak] recordDailyActivity error:', e));
    next();
  } catch (err) {
    return res.status(401).json({ code: 'AUTH_INVALID', message: 'Invalid or expired access token' });
  }
}

export async function requireActiveUser(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ code: 'AUTH_MISSING', message: 'Missing access token' });
    const user = await loadAuthUser(req.user.id);
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
    req.user.role = user.role;
    const mod = user.moderation || {};
    const now = new Date();
    if (mod.bannedPermanent) {
      return res.status(403).json({ code: 'BANNED', message: 'Account banned' });
    }
    if (mod.bannedUntil && new Date(mod.bannedUntil).getTime() > now.getTime()) {
      return res.status(403).json({ code: 'BANNED_TEMP', message: 'Account temporarily banned', until: mod.bannedUntil });
    }
    next();
  } catch (err) {
    return res.status(401).json({ code: 'AUTH_INVALID', message: 'Invalid or expired access token' });
  }
}
