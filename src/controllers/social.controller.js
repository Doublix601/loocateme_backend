import { addOrUpdateSocial, removeSocial } from '../services/social.service.js';

export const SocialController = {
  upsert: async (req, res, next) => {
    try {
      const { type, handle } = req.body;
      const user = await addOrUpdateSocial(req.user.id, { type, handle });
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  remove: async (req, res, next) => {
    try {
      const { type } = req.params;
      const user = await removeSocial(req.user.id, type);
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
};
