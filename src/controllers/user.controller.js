import { getNearbyUsers, updateLocation, getUserByEmail } from '../services/user.service.js';

export const UserController = {
  me: async (req, res, next) => {
    try {
      // In a real app, return detailed me; here we just confirm auth
      return res.json({ userId: req.user.id });
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
      const { email } = req.query;
      const user = await getUserByEmail(email);
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
};
