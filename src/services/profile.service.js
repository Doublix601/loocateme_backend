import { User } from '../models/User.js';

export async function updateProfile(userId, { name, bio }) {
  const user = await User.findByIdAndUpdate(userId, { name, bio }, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
}

export async function updateProfileImage(userId, imageUrl) {
  const user = await User.findByIdAndUpdate(userId, { profileImageUrl: imageUrl }, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
}

export async function setVisibility(userId, isVisible) {
  const user = await User.findByIdAndUpdate(userId, { isVisible }, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
}
