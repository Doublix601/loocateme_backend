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

export async function updateProfile(userId, { name, bio }) {
  const user = await User.findByIdAndUpdate(userId, { name, bio }, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
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
