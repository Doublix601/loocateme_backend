import jwt from 'jsonwebtoken';
import { RefreshToken } from '../models/RefreshToken.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ code: 'AUTH_MISSING', message: 'Missing access token' });
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = { id: payload.sub };
    const { User } = await import('../models/User.js');
    const user = await User.findById(req.user.id).select('role moderation').lean();
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

export async function requireActiveUser(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ code: 'AUTH_MISSING', message: 'Missing access token' });
    const { User } = await import('../models/User.js');
    const user = await User.findById(req.user.id).select('role moderation').lean();
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

export async function rotateRefreshToken(req, res) {
  // Optional endpoint to rotate refresh token
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ code: 'REFRESH_MISSING', message: 'Missing refresh token' });
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const doc = await RefreshToken.findOne({ token, revoked: false });
    if (!doc || doc.expiresAt < new Date()) return res.status(401).json({ code: 'REFRESH_INVALID', message: 'Invalid refresh token' });
    const userId = payload.sub;
    const access = jwt.sign({}, process.env.JWT_ACCESS_SECRET, {
      expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
      subject: userId.toString(),
    });
    return res.json({ accessToken: access });
  } catch (err) {
    return res.status(401).json({ code: 'REFRESH_INVALID', message: 'Invalid or expired refresh token' });
  }
}
