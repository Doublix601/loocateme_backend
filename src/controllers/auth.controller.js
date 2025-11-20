import { login, signup, logout, requestPasswordReset, verifyEmailByToken, resetPasswordByToken } from '../services/auth.service.js';
import jwt from 'jsonwebtoken';
import { RefreshToken } from '../models/RefreshToken.js';

function setRefreshCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

export const AuthController = {
  signup: async (req, res, next) => {
    try {
      const { email, password, username, firstName, lastName, customName } = req.body;
      const data = await signup({ email, password, username, firstName, lastName, customName });
      // Only set cookie if a refresh token was issued (i.e., for verified accounts)
      if (data.refreshToken) setRefreshCookie(res, data.refreshToken);
      return res.status(201).json({ user: data.user, accessToken: data.accessToken });
    } catch (err) {
      next(err);
    }
  },
  login: async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const data = await login({ email, password });
      setRefreshCookie(res, data.refreshToken);
      return res.json({ user: data.user, accessToken: data.accessToken });
    } catch (err) {
      next(err);
    }
  },
  refresh: async (req, res) => {
    try {
      const token = req.cookies?.refreshToken;
      if (!token) return res.status(401).json({ code: 'REFRESH_MISSING', message: 'Missing refresh token' });
      const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
      const doc = await RefreshToken.findOne({ token, revoked: false });
      if (!doc || doc.expiresAt < new Date()) return res.status(401).json({ code: 'REFRESH_INVALID', message: 'Invalid refresh token' });
      const accessToken = jwt.sign({}, process.env.JWT_ACCESS_SECRET, {
        subject: payload.sub,
      });
      return res.json({ accessToken });
    } catch (err) {
      return res.status(401).json({ code: 'REFRESH_INVALID', message: 'Invalid or expired refresh token' });
    }
  },
  logout: async (req, res, next) => {
    try {
      const token = req.cookies?.refreshToken;
      await logout(req.user?.id, token);
      res.clearCookie('refreshToken', { path: '/api/auth' });
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
  forgotPassword: async (req, res, next) => {
    try {
      const { email } = req.body;
      const result = await requestPasswordReset(email);
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },
  verifyEmailGet: async (req, res) => {
    const token = String(req.query.token || '');
    const appUrl = process.env.APP_PUBLIC_URL || process.env.CORS_ORIGIN || '/';
    if (!token) return res.status(400).send('Lien invalide (token manquant).');
    try {
      await verifyEmailByToken(token);
      // Redirect to app/site with success flag
      const redirectUrl = `${appUrl}${appUrl.includes('?') ? '&' : (appUrl.includes('#') ? '' : '?')}emailVerified=1`;
      return res.redirect(302, redirectUrl);
    } catch (e) {
      return res.status(400).send('Lien invalide ou expiré.');
    }
  },
  verifyEmailPost: async (req, res, next) => {
    try {
      const token = String(req.body.token || req.query.token || '');
      if (!token) return res.status(400).json({ code: 'TOKEN_REQUIRED', message: 'Token requis' });
      const user = await verifyEmailByToken(token);
      return res.json({ success: true, user });
    } catch (err) {
      next(err);
    }
  },
  resetPasswordGet: async (req, res) => {
    const token = String(req.query.token || '');
    if (!token) return res.status(400).send('Lien invalide (token manquant).');
    // Simple HTML form
    return res.send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Définir un nouveau mot de passe</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#f6f7f9;margin:0;padding:0} .card{max-width:420px;margin:5vh auto;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.08);padding:24px} h1{font-size:20px;margin:0 0 16px;color:#111} label{display:block;margin:12px 0 6px;color:#333;font-weight:600} input{width:100%;padding:12px;border:1px solid #cfd8dc;border-radius:8px;font-size:16px;box-sizing:border-box} button{margin-top:16px;width:100%;padding:12px 16px;border:none;border-radius:999px;background:#00c2cb;color:white;font-weight:700;font-size:16px;cursor:pointer} .hint{font-size:12px;color:#666;margin-top:8px;text-align:center}</style>
</head><body><div class="card">
<h1>Définir un nouveau mot de passe</h1>
<form method="POST" action="/api/auth/reset-password">
  <input type="hidden" name="token" value="${token}"/>
  <label>Nouveau mot de passe</label>
  <input type="password" name="password" required minlength="6" autocomplete="new-password"/>
  <label>Confirmer le mot de passe</label>
  <input type="password" name="confirm" required minlength="6" autocomplete="new-password"/>
  <button type="submit">Enregistrer</button>
  <p class="hint">Votre mot de passe doit comporter au moins 6 caractères.</p>
</form>
</div></body></html>`);
  },
  resetPasswordPost: async (req, res) => {
    const token = String(req.body.token || req.query.token || '');
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    if (!token) return res.status(400).send('Token manquant.');
    if (!password || password.length < 6) return res.status(400).send('Le mot de passe doit contenir au moins 6 caractères.');
    if (password !== confirm) return res.status(400).send('Les mots de passe ne correspondent pas.');
    try {
      await resetPasswordByToken(token, password);
      return res.send('<p>Votre mot de passe a été mis à jour. Vous pouvez fermer cette page et vous reconnecter.</p>');
    } catch (e) {
      return res.status(400).send('Lien invalide ou expiré.');
    }
  },
};
