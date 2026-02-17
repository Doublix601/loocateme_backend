import { User } from '../models/User.js';

// Middleware global: exige la présence du paramètre shouldReload (query ou header)
// Exceptions: /auth/login et /auth/signup
export function requireShouldReload(req, res, next) {
  try {
    // Laisser passer les preflight et uploads statiques
    if (req.method === 'OPTIONS') return next();
    const p = req.path || '';
    if (p.startsWith('/auth/login') || p.startsWith('/auth/signup')) return next();
    // Autoriser les proxys internes
    if (p.startsWith('/proxy/')) return next();
    const raw = req.query.shouldReload ?? req.headers['x-should-reload'];
    if (raw === undefined) {
      return res.status(400).json({ code: 'SHOULD_RELOAD_REQUIRED', message: 'Paramètre shouldReload requis' });
    }
    const v = String(raw).toLowerCase();
    req.shouldReload = v === '1' || v === 'true' || v === 'yes';
    next();
  } catch (e) {
    next(e);
  }
}

// Utilitaire: compare la date iat du token à planChangedAt / updatedAt pour décider d’un reload UI
export async function maybeSetUiReloadHeader({ userId, tokenIat, res }) {
  try {
    if (!userId || !res) return;
    const u = await User.findById(userId).select('isPremium updatedAt planChangedAt');
    if (!u) return;
    const iatDate = tokenIat ? new Date(tokenIat * 1000) : null;
    const marker = u.planChangedAt || u.updatedAt;
    if (iatDate && marker && marker > iatDate) {
      res.setHeader('X-UI-Reload', '1');
    }
  } catch (_) {
    // silencieux
  }
}
