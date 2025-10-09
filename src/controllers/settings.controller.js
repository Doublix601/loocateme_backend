import { setVisibility } from '../services/profile.service.js';

export const SettingsController = {
  setVisible: async (req, res, next) => {
    try {
      const { isVisible } = req.body;
      const user = await setVisibility(req.user.id, Boolean(isVisible));
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
};
