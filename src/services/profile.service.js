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

  // Build prospective next values starting from current ones
  let nextUsername = user.username || '';
  let nextFirst = user.firstName || '';
  let nextLast = user.lastName || '';
  let nextCustom = user.customName || '';
  let nextBio = (typeof bio === 'string') ? bio : user.bio;

  // Username change with 15-day cooldown (and cannot be empty)
  if (typeof username === 'string') {
    const v = String(username).trim();
    if (v.length === 0) {
      const err = new Error("Le nom d'utilisateur est obligatoire et ne peut pas être vide.");
      err.status = 400;
      err.code = 'USERNAME_REQUIRED';
      throw err;
    }
    if (v !== user.username) {
      const last = user.lastUsernameChangeAt ? new Date(user.lastUsernameChangeAt).getTime() : 0;
      if (last && (now.getTime() - last) < FIFTEEN_DAYS_MS && user.username) {
        const err = new Error("Le nom d'utilisateur ne peut être modifié qu'une fois tous les 15 jours.");
        err.status = 429;
        err.code = 'USERNAME_CHANGE_RATE_LIMIT';
        throw err;
      }
      nextUsername = v;
    }
  }

  // First name change with 15-day cooldown (independent). Empty string allowed.
  if (typeof firstName === 'string') {
    const v = String(firstName).trim();
    if (v !== user.firstName) {
      const lastFirst = user.lastFirstNameChangeAt ? new Date(user.lastFirstNameChangeAt).getTime() : 0;
      if (lastFirst && (now.getTime() - lastFirst) < FIFTEEN_DAYS_MS && user.firstName) {
        const err = new Error('Le prénom ne peut être modifié qu’une fois tous les 15 jours.');
        err.status = 429;
        err.code = 'FIRSTNAME_CHANGE_RATE_LIMIT';
        throw err;
      }
      nextFirst = v;
    }
  }

  // Last name change with 15-day cooldown (independent). Empty string allowed.
  if (typeof lastName === 'string') {
    const v = String(lastName).trim();
    if (v !== user.lastName) {
      const lastLast = user.lastLastNameChangeAt ? new Date(user.lastLastNameChangeAt).getTime() : 0;
      if (lastLast && (now.getTime() - lastLast) < FIFTEEN_DAYS_MS && user.lastName) {
        const err = new Error('Le nom ne peut être modifié qu’une fois tous les 15 jours.');
        err.status = 429;
        err.code = 'LASTNAME_CHANGE_RATE_LIMIT';
        throw err;
      }
      nextLast = v;
    }
  }

  // Custom name: empty string allowed
  if (typeof customName === 'string') {
    nextCustom = String(customName).trim();
  }

  // Business constraints on identity fields
  const hasCustom = nextCustom.length > 0;
  const hasFirst = nextFirst.length > 0;
  const hasLast = nextLast.length > 0;
  if (!hasCustom && !(hasFirst && hasLast)) {
    const err = new Error('Renseigne un Nom personnalisé OU un Prénom ET un Nom.');
    err.status = 400;
    err.code = 'NAME_REQUIREMENTS';
    throw err;
  }

  // If we reached here, apply changes and timestamps
  if (nextUsername !== user.username) {
    user.username = nextUsername;
    user.lastUsernameChangeAt = now;
    user.name = nextUsername; // keep legacy in sync
  }
  if (nextFirst !== user.firstName) {
    user.firstName = nextFirst;
    user.lastFirstNameChangeAt = now;
  }
  if (nextLast !== user.lastName) {
    user.lastName = nextLast;
    user.lastLastNameChangeAt = now;
  }
  if (nextCustom !== user.customName) {
    user.customName = nextCustom;
  }
  if (typeof nextBio === 'string' && nextBio !== user.bio) {
    user.bio = nextBio;
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
