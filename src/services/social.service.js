import { User } from '../models/User.js';

export async function addOrUpdateSocial(userId, { type, handle }) {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  const idx = user.socialNetworks.findIndex((s) => s.type === type);
  if (idx >= 0) user.socialNetworks[idx].handle = handle;
  else user.socialNetworks.push({ type, handle });
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
