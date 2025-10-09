import { login, signup, logout, requestPasswordReset } from '../services/auth.service.js';
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
      const { email, password, name } = req.body;
      const data = await signup({ email, password, name });
      setRefreshCookie(res, data.refreshToken);
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
};
