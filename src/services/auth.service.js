import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendMail } from './email.service.js';

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
  // Normaliser le username (aligné sur les règles Instagram): tout en minuscules
  let normalizedUsername = String(username || '').trim().toLowerCase();
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
    lastFirstNameChangeAt: now,
    lastLastNameChangeAt: now,
  });
  await user.save();
  // Create and send email verification token
  await createAndSendEmailVerification(user);
  // Do NOT issue tokens until email is verified
  return { user: sanitize(user), accessToken: null, refreshToken: null };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+password');
  if (!user) throw Object.assign(new Error('Authentification échouée'), { status: 401, code: 'INVALID_CREDENTIALS' });
  const ok = await user.comparePassword(password);
  if (!ok) throw Object.assign(new Error('Authentification échouée'), { status: 401, code: 'INVALID_CREDENTIALS' });
  // Block login if email is not verified
  if (!user.emailVerified) {
    // Try to (re)send a verification email to help the user complete verification
    try {
      await createAndSendEmailVerification(user);
    } catch (e) {
      // log and continue to return the error below
      console.warn('Could not send verification email on login:', e?.message || e);
    }
    const err = new Error("Votre email n'est pas encore vérifié. Vérifiez votre boîte de réception pour le lien de confirmation.");
    err.status = 403;
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }
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
  const user = await User.findOne({ email });
  if (user) {
    const { token, hash, expiresAt } = generateOpaqueToken(process.env.PWD_RESET_TOKEN_TTL || '1h');
    user.pwdResetTokenHash = hash;
    user.pwdResetExpiresAt = expiresAt;
    await user.save();
    const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
    const resetUrl = `${baseUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await sendMail({
        to: user.email,
        subject: 'Réinitialisation de votre mot de passe',
        text: `Bonjour,
Vous avez demandé à réinitialiser votre mot de passe.
Cliquez sur ce lien pour définir un nouveau mot de passe (valide 1h): ${resetUrl}`,
        html: `<p>Bonjour,</p><p>Vous avez demandé à réinitialiser votre mot de passe.</p><p><a href="${resetUrl}">Cliquez ici pour définir un nouveau mot de passe</a> (valide 1h).</p><p>Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p>`,
      });
    } catch (e) {
      // Log but do not reveal; continue to avoid user enumeration
      console.error('Failed to send reset email:', e?.message || e);
    }
  }
  // Always return success to avoid leaking whether the email exists
  return { success: true };
}

export function sanitize(userDoc) {
  const user = userDoc.toObject ? userDoc.toObject() : userDoc;
  delete user.password;
  return user;
}

// Helpers
function generateOpaqueToken(ttl = '1h') {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = sha256(token);
  const now = Date.now();
  const expiresAt = new Date(now + parseExpiry(ttl));
  return { token, hash, expiresAt };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function createAndSendEmailVerification(user) {
  const { token, hash, expiresAt } = generateOpaqueToken(process.env.EMAIL_VERIF_TOKEN_TTL || '24h');
  user.emailVerifyTokenHash = hash;
  user.emailVerifyExpiresAt = expiresAt;
  await user.save();
  const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  try {
    await sendMail({
      to: user.email,
      subject: 'Vérifiez votre adresse email',
      text: `Bienvenue sur LoocateMe !
Merci de confirmer votre adresse en cliquant sur ce lien: ${verifyUrl}`,
      html: `<p>Bienvenue sur <strong>LoocateMe</strong> !</p><p>Merci de confirmer votre adresse email en cliquant ici: <a href="${verifyUrl}">Vérifier mon email</a></p>`,
    });
  } catch (e) {
    console.error('Failed to send verification email:', e?.message || e);
  }
}

export async function verifyEmailByToken(token) {
  const hash = sha256(token);
  const now = new Date();
  const user = await User.findOne({ emailVerifyTokenHash: hash, emailVerifyExpiresAt: { $gt: now } });
  if (!user) {
    const err = new Error('Token invalide ou expiré');
    err.status = 400;
    err.code = 'VERIFY_TOKEN_INVALID';
    throw err;
  }
  user.emailVerified = true;
  user.emailVerifyTokenHash = undefined;
  user.emailVerifyExpiresAt = undefined;
  await user.save();
  return sanitize(user);
}

export async function resetPasswordByToken(token, newPassword) {
  const hash = sha256(token);
  const now = new Date();
  const user = await User.findOne({ pwdResetTokenHash: hash, pwdResetExpiresAt: { $gt: now } }).select('+password');
  if (!user) {
    const err = new Error('Token invalide ou expiré');
    err.status = 400;
    err.code = 'RESET_TOKEN_INVALID';
    throw err;
  }
  user.password = newPassword; // will be hashed by pre-save hook
  user.pwdResetTokenHash = undefined;
  user.pwdResetExpiresAt = undefined;
  await user.save();
  return sanitize(user);
}
