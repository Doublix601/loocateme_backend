import { User } from '../models/User.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');

function localPathFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url, 'http://placeholder');
    const pathname = u.pathname || '';
    const idx = pathname.indexOf('/uploads/');
    if (idx === -1) return null;
    const filename = pathname.substring(idx + '/uploads/'.length);
    if (!filename) return null;
    const p = path.join(uploadsDir, filename);
    // prevent path traversal
    if (!p.startsWith(uploadsDir)) return null;
    return p;
  } catch {
    return null;
  }
}

export async function updateProfile(userId, { username, firstName, lastName, customName, bio }) {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const now = new Date();
  const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

  // Username change with 15-day cooldown
  if (typeof username === 'string') {
    const v = String(username).trim();
    if (v !== user.username) {
      const last = user.lastUsernameChangeAt ? new Date(user.lastUsernameChangeAt).getTime() : 0;
      if (last && (now.getTime() - last) < FIFTEEN_DAYS_MS && user.username) {
        const err = new Error("Le nom d'utilisateur ne peut être modifié qu'une fois tous les 15 jours.");
        err.status = 429;
        err.code = 'USERNAME_CHANGE_RATE_LIMIT';
        throw err;
      }
      user.username = v;
      user.lastUsernameChangeAt = now;
      // Keep legacy name in sync for backward compatibility
      user.name = v;
    }
  }

  // First name change with 15-day cooldown (independent)
  if (typeof firstName === 'string') {
    const nextFirst = String(firstName).trim();
    if (nextFirst !== user.firstName) {
      const lastFirst = user.lastFirstNameChangeAt ? new Date(user.lastFirstNameChangeAt).getTime() : 0;
      if (lastFirst && (now.getTime() - lastFirst) < FIFTEEN_DAYS_MS && user.firstName) {
        const err = new Error('Le prénom ne peut être modifié qu’une fois tous les 15 jours.');
        err.status = 429;
        err.code = 'FIRSTNAME_CHANGE_RATE_LIMIT';
        throw err;
      }
      user.firstName = nextFirst;
      user.lastFirstNameChangeAt = now;
    }
  }

  // Last name change with 15-day cooldown (independent)
  if (typeof lastName === 'string') {
    const nextLast = String(lastName).trim();
    if (nextLast !== user.lastName) {
      const lastLast = user.lastLastNameChangeAt ? new Date(user.lastLastNameChangeAt).getTime() : 0;
      if (lastLast && (now.getTime() - lastLast) < FIFTEEN_DAYS_MS && user.lastName) {
        const err = new Error('Le nom ne peut être modifié qu’une fois tous les 15 jours.');
        err.status = 429;
        err.code = 'LASTNAME_CHANGE_RATE_LIMIT';
        throw err;
      }
      user.lastName = nextLast;
      user.lastLastNameChangeAt = now;
    }
  }

  if (typeof customName === 'string') {
    user.customName = String(customName).trim();
  }
  if (typeof bio === 'string') {
    user.bio = bio;
  }

  await user.save();
  return user;
}

export async function updateProfileImage(userId, imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    throw Object.assign(new Error('Invalid image URL'), { status: 400 });
  }
  // Get current user to know old image
  const current = await User.findById(userId).select('profileImageUrl');
  if (!current) throw Object.assign(new Error('User not found'), { status: 404 });

  const user = await User.findByIdAndUpdate(userId, { profileImageUrl: imageUrl }, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  // Delete old local file if exists and different
  try {
    const oldUrl = current.profileImageUrl;
    if (oldUrl && oldUrl !== imageUrl) {
      const p = localPathFromUrl(oldUrl);
      if (p && fs.existsSync(p)) fs.unlink(p, () => {});
    }
  } catch {}

  return user;
}

export async function setVisibility(userId, isVisible) {
  const user = await User.findByIdAndUpdate(userId, { isVisible }, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
}

export async function removeProfileImage(userId) {
  // Get current user to know old image
  const current = await User.findById(userId).select('profileImageUrl');
  if (!current) throw Object.assign(new Error('User not found'), { status: 404 });

  // Clear the profileImageUrl
  const user = await User.findByIdAndUpdate(userId, { profileImageUrl: '' }, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  // Delete old local file if exists
  try {
    const oldUrl = current.profileImageUrl;
    const p = localPathFromUrl(oldUrl);
    if (p && fs.existsSync(p)) fs.unlink(p, () => {});
  } catch {}

  return user;
}
