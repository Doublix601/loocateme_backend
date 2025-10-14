import { getNearbyUsers, updateLocation, getUsersByEmails } from '../services/user.service.js';

export const UserController = {
  me: async (req, res, next) => {
    try {
      // Return full user profile (sans password)
      const { User } = await import('../models/User.js');
      const user = await User.findById(req.user.id).select('-password');
      if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  updateLocation: async (req, res, next) => {
    try {
      const { lat, lon } = req.body;
      const user = await updateLocation(req.user.id, { lat, lon });
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  nearby: async (req, res, next) => {
    try {
      const { lat, lon, radius } = req.query;
      const users = await getNearbyUsers({
        userId: req.user.id,
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        radiusMeters: radius ? parseInt(radius, 10) : 300,
      });
      return res.json({ users });
    } catch (err) {
      next(err);
    }
  },
  getByEmail: async (req, res, next) => {
    try {
      const emails = req.query.email; // after validator, this is an array of normalized emails
      const users = await getUsersByEmails(emails);
      return res.json({ users });
    } catch (err) {
      next(err);
    }
  },
};
