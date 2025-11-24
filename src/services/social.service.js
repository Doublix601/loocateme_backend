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
  } else if (cleanType === 'youtube') {
    // Support various YouTube profile URL formats and sanitize to a handle value
    // Accepted inputs examples:
    //  - @myhandle
    //  - myhandle
    //  - https://www.youtube.com/@myhandle
    //  - https://youtube.com/user/MyChannel
    //  - https://youtube.com/c/MyCustom
    //  - https://youtube.com/channel/UCxxxxxxxxxxxx (channel ID)
    try {
      if (/^https?:\/\//i.test(cleanHandle)) {
        const u = new URL(cleanHandle);
        const path = (u.pathname || '').replace(/^\/+|\/+$/g, '');
        const [seg1, seg2] = path.split('/');
        if (seg1?.startsWith('@')) {
          cleanHandle = seg1.slice(1);
        } else if (seg1 === 'user' || seg1 === 'c') {
          cleanHandle = (seg2 || '').trim();
        } else if (seg1 === 'channel') {
          // Keep full channel ID (e.g., UCabc...) as handle
          cleanHandle = (seg2 || '').trim();
        } else if (seg1) {
          // Fallback: first segment is the identifier
          cleanHandle = seg1.trim();
        }
      }
    } catch (_e) { /* ignore */ }
    if (cleanHandle.startsWith('@')) cleanHandle = cleanHandle.slice(1);
    // Basic validation: allow typical YouTube handle charset or channel IDs
    const re = /^[A-Za-z0-9._\-]{2,100}$/;
    if (!re.test(cleanHandle)) {
      const err = new Error('Invalid YouTube handle');
      err.status = 400;
      err.code = 'INVALID_YOUTUBE_HANDLE';
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
