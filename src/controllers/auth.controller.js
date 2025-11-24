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
    const appUrl = process.env.APP_PUBLIC_URL || process.env.CORS_ORIGIN || '';
    if (!token) return res.status(400).send(renderHtmlPage({
      title: 'Vérification email',
      heading: 'Lien invalide',
      content: '<p>Le lien de vérification est invalide (token manquant).</p>',
      primaryCta: appUrl ? { href: appUrl, label: 'Ouvrir l’application' } : null,
    }));
    try {
      await verifyEmailByToken(token);
      const extra = appUrl ? `<p>Vous pouvez maintenant retourner sur l’application.</p>` : '';
      return res.send(renderHtmlPage({
        title: 'Email vérifié',
        heading: 'Votre adresse email a été vérifiée ✅',
        content: `<p>Merci d’avoir confirmé votre adresse email.</p>${extra}`,
        primaryCta: appUrl ? { href: appendQuery(appUrl, 'emailVerified=1'), label: 'Retourner à l’application' } : null,
      }));
    } catch (e) {
      return res.status(400).send(renderHtmlPage({
        title: 'Vérification email',
        heading: 'Lien invalide ou expiré',
        content: `<p>Le lien de vérification a expiré ou n’est pas valide.</p>`,
        secondary: '<p>Vous pouvez demander un nouveau lien depuis l’application.</p>',
        primaryCta: appUrl ? { href: appUrl, label: 'Ouvrir l’application' } : null,
      }));
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
    if (!token) return res.status(400).send(renderHtmlPage({
      title: 'Réinitialisation du mot de passe',
      heading: 'Lien invalide',
      content: '<p>Le lien est invalide (token manquant).</p>'
    }));
    // Page HTML avec support du dark mode
    return res.send(renderHtmlPage({
      title: 'Définir un nouveau mot de passe',
      heading: 'Définir un nouveau mot de passe',
      content: `
        <form method="POST" action="/api/auth/reset-password">
          <input type="hidden" name="token" value="${token}"/>
          <label>Nouveau mot de passe</label>
          <input type="password" name="password" required minlength="6" autocomplete="new-password"/>
          <label>Confirmer le mot de passe</label>
          <input type="password" name="confirm" required minlength="6" autocomplete="new-password"/>
          <button type="submit">Enregistrer</button>
          <p class="hint">Votre mot de passe doit comporter au moins 6 caractères.</p>
        </form>
      `,
    }));
  },
  resetPasswordPost: async (req, res) => {
    const token = String(req.body.token || req.query.token || '');
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    if (!token) return res.status(400).send(renderHtmlPage({
      title: 'Réinitialisation du mot de passe',
      heading: 'Token manquant',
      content: '<p>Veuillez réessayer à partir de l’email de réinitialisation.</p>'
    }));
    if (!password || password.length < 6) return res.status(400).send(renderHtmlPage({
      title: 'Réinitialisation du mot de passe',
      heading: 'Mot de passe trop court',
      content: '<p>Le mot de passe doit contenir au moins 6 caractères.</p>'
    }));
    if (password !== confirm) return res.status(400).send(renderHtmlPage({
      title: 'Réinitialisation du mot de passe',
      heading: 'Les mots de passe ne correspondent pas',
      content: '<p>Veuillez vérifier et réessayer.</p>'
    }));
    try {
      await resetPasswordByToken(token, password);
      return res.send(renderHtmlPage({
        title: 'Mot de passe mis à jour',
        heading: 'Votre mot de passe a été mis à jour ✅',
        content: '<p>Vous pouvez maintenant ouvrir l’application et vous reconnecter.</p>',
      }));
    } catch (e) {
      return res.status(400).send(renderHtmlPage({
        title: 'Réinitialisation du mot de passe',
        heading: 'Lien invalide ou expiré',
        content: '<p>Le lien de réinitialisation n’est plus valide. Veuillez refaire une demande depuis l’application.</p>'
      }));
    }
  },
};

// --- Helpers for simple HTML pages with light/dark mode ---
function renderHtmlPage({ title, heading, content, secondary = '', primaryCta = null }) {
  const cta = primaryCta ? `<a class="btn" href="${escapeHtml(primaryCta.href)}">${escapeHtml(primaryCta.label)}</a>` : '';
  return `<!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${escapeHtml(title || 'LoocateMe')}</title>
    <style>
      :root {
        --bg: #f6f7f9; --fg: #111; --muted: #666; --card: #fff; --border: #cfd8dc; --primary: #00c2cb; --btn-fg: #fff;
      }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #0f1115; --fg: #e6e6e6; --muted: #a3a3a3; --card: #161a22; --border: #2a2f3a; --primary: #00c2cb; --btn-fg: #0b0d10; }
      }
      *{box-sizing:border-box}
      body{font-family: system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif; background:var(--bg); color:var(--fg); margin:0;}
      .wrap{padding:24px}
      .card{max-width: 520px; margin: 8vh auto; background: var(--card); border:1px solid var(--border); border-radius: 14px; padding: 24px 22px; box-shadow: 0 10px 30px rgba(0,0,0,.06)}
      h1{font-size: 22px; margin: 0 0 12px}
      p{line-height:1.5; margin: 8px 0}
      form label{display:block;margin:12px 0 6px; font-weight:600}
      input{width:100%; padding:12px; border:1px solid var(--border); border-radius: 10px; background: transparent; color: var(--fg); font-size:16px}
      input:focus{outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 20%, transparent)}
      .btn, button{display:inline-block; margin-top: 14px; width: 100%; text-align:center; padding:12px 16px; border:none; border-radius: 999px; background: var(--primary); color: var(--btn-fg); font-weight:700; font-size:16px; text-decoration:none}
      .hint{font-size:12px;color:var(--muted);margin-top:8px;text-align:center}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${escapeHtml(heading || '')}</h1>
        <div class="content">${content || ''}</div>
        ${secondary || ''}
        ${cta}
      </div>
    </div>
  </body>
  </html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function appendQuery(url, query) {
  if (!url) return '';
  if (url.includes('#')) {
    const [base, hash] = url.split('#');
    return `${base}${base.includes('?') ? '&' : '?'}${query}#${hash}`;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}
