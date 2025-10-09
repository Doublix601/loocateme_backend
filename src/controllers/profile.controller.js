import { updateProfile, updateProfileImage } from '../services/profile.service.js';

export const ProfileController = {
  update: async (req, res, next) => {
    try {
      const { name, bio } = req.body;
      const user = await updateProfile(req.user.id, { name, bio });
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  uploadPhoto: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const url = `${baseUrl}/uploads/${req.file.filename}`;
      const user = await updateProfileImage(req.user.id, url);
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
};
