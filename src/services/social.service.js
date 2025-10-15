import { User } from '../models/User.js';

export async function addOrUpdateSocial(userId, { type, handle }) {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  const cleanType = String(type || '').toLowerCase();
  let cleanHandle = String(handle || '').trim();
  if (cleanType === 'instagram') {
    // Sanitize and validate Instagram handle server-side for safety
    try {
      if (/^https?:\/\//i.test(cleanHandle)) {
        const u = new URL(cleanHandle);
        const path = (u.pathname || '').replace(/^\/+|\/+$/g, '');
        cleanHandle = (path.split('/')[0] || '').trim();
      }
    } catch (_e) { /* ignore */ }
    if (cleanHandle.startsWith('@')) cleanHandle = cleanHandle.slice(1);
    const re = /^(?!.*\.\.)(?!.*\.$)[A-Za-z0-9](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9])?$/;
    if (!re.test(cleanHandle)) {
      const err = new Error('Invalid Instagram username');
      err.status = 400;
      err.code = 'INVALID_INSTAGRAM_HANDLE';
      throw err;
    }
  } else if (cleanType === 'tiktok') {
    // Sanitize tiktok handle from URLs like https://www.tiktok.com/@username or /@username/video/...
    try {
      if (/^https?:\/\//i.test(cleanHandle)) {
        const u = new URL(cleanHandle);
        const path = (u.pathname || '').replace(/^\/+|\/+$/g, '');
        const firstSeg = (path.split('/')[0] || '').trim();
        cleanHandle = firstSeg.startsWith('@') ? firstSeg.slice(1) : firstSeg;
      }
    } catch (_e) { /* ignore */ }
    if (cleanHandle.startsWith('@')) cleanHandle = cleanHandle.slice(1);
    const re = /^[A-Za-z0-9._]{2,24}$/;
    if (!re.test(cleanHandle)) {
      const err = new Error('Invalid TikTok username');
      err.status = 400;
      err.code = 'INVALID_TIKTOK_HANDLE';
      throw err;
    }
  }
  const idx = user.socialNetworks.findIndex((s) => s.type === cleanType);
  if (idx >= 0) user.socialNetworks[idx].handle = cleanHandle;
  else user.socialNetworks.push({ type: cleanType, handle: cleanHandle });
  await user.save();
  return user;
}

export async function removeSocial(userId, type) {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  user.socialNetworks = user.socialNetworks.filter((s) => s.type !== type);
  await user.save();
  return user;
}
