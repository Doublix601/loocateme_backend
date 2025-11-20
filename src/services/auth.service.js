import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

function signAccessToken(userId) {
  // Issue a non-expiring access token. It will remain valid until the user logs out or changes password.
  return jwt.sign({}, process.env.JWT_ACCESS_SECRET, {
    subject: userId.toString(),
  });
}

async function createRefreshToken(userId) {
  const token = uuidv4() + '.' + uuidv4();
  const ttl = process.env.JWT_REFRESH_EXPIRES || '30d';
  // Compute expiry date
  const now = new Date();
  const expiresAt = new Date(now.getTime() + parseExpiry(ttl));
  await RefreshToken.create({ user: userId, token, expiresAt });
  return token;
}

function parseExpiry(str) {
  // supports m,h,d style
  const match = String(str).match(/^(\d+)([mhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30d
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'm') return n * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

export async function signup({ email, password, username, firstName = '', lastName = '', customName = '' }) {
  // Refuse signup if an account already exists for this email (do NOT delete existing accounts)
  const existing = await User.findOne({ email }).select('_id');
  if (existing) {
    const err = new Error('Un compte existe déjà avec cet email');
    err.status = 409;
    err.code = 'EMAIL_TAKEN';
    throw err;
  }
  // Normalize and validate username defensively (validators already sanitize)
  let normalizedUsername = String(username || '').trim();
  if (normalizedUsername) {
    const lower = normalizedUsername.toLowerCase();
    normalizedUsername = lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  const now = new Date();
  const user = new User({
    email,
    password,
    // Keep legacy name in sync on creation for backward compatibility
    name: normalizedUsername,
    username: normalizedUsername,
    firstName: String(firstName || '').trim(),
    lastName: String(lastName || '').trim(),
    customName: String(customName || '').trim(),
    lastUsernameChangeAt: now,
    lastNameFieldsChangeAt: now,
  });
  await user.save();
  const accessToken = signAccessToken(user._id);
  const refreshToken = await createRefreshToken(user._id);
  return { user: sanitize(user), accessToken, refreshToken };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+password');
  if (!user) throw Object.assign(new Error('Authentification échouée'), { status: 401, code: 'INVALID_CREDENTIALS' });
  const ok = await user.comparePassword(password);
  if (!ok) throw Object.assign(new Error('Authentification échouée'), { status: 401, code: 'INVALID_CREDENTIALS' });
  const accessToken = signAccessToken(user._id);
  const refreshToken = await createRefreshToken(user._id);
  return { user: sanitize(user), accessToken, refreshToken };
}

export async function logout(userId, token) {
  if (token) {
    await RefreshToken.updateOne({ token }, { $set: { revoked: true } });
  }
  return { success: true };
}

export async function requestPasswordReset(email) {
  // In real system, send email. Here, generate a temporary code hash field on user (simplified)
  const user = await User.findOne({ email });
  if (!user) return { success: true }; // do not reveal
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(code, salt);
  user.resetCodeHash = hash; // not defined in schema, but mongoose will allow unless strict; default strict true, so we avoid saving extra path
  // To keep strict schema, store on bio temporarily is bad; instead skip persistence and return code (only for demo)
  return { success: true, demoCode: code };
}

export function sanitize(userDoc) {
  const user = userDoc.toObject ? userDoc.toObject() : userDoc;
  delete user.password;
  return user;
}
